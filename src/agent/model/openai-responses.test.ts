import { expect, test } from "vitest";
import { OpenAIResponsesModel } from "./openai-responses.ts";
import type { Item, ToolSpec } from "./port.ts";

interface Sent {
  url: string;
  headers: Headers;
  body: Record<string, unknown>;
}

// A fetch that records each request and answers with the given status and body.
function stubFetch(status: number, body: unknown) {
  const sent: Sent[] = [];
  const fetch = async (url: string | URL | Request, init?: RequestInit) => {
    sent.push({ url: String(url), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  };
  return { fetch: fetch as typeof globalThis.fetch, sent };
}

function response(output: unknown[]) {
  return { id: "resp_1", object: "response", created_at: 0, model: "m", status: "completed", output };
}

const outputMessage = (text: string) => ({
  type: "message",
  id: "msg_1",
  role: "assistant",
  status: "completed",
  content: [{ type: "output_text", text, annotations: [] }],
});

const lookup: ToolSpec = {
  name: "lookup",
  description: "Look up a key.",
  inputSchema: { type: "object", properties: { key: { type: "string" } }, required: ["key"] },
};

const exchange: Item[] = [
  { type: "message", role: "user", from: "owner", text: "what is a?" },
  { type: "tool_call", id: "c1", name: "lookup", input: { key: "a" } },
  { type: "tool_result", callId: "c1", output: "42" },
  { type: "message", role: "assistant", text: "a is 42" },
  { type: "message", role: "user", from: "a1b2c3d4e5f6", text: "thanks" },
];

test("defaults to OpenAI's endpoint, with the key and the model", async () => {
  const { fetch, sent } = stubFetch(200, response([outputMessage("hi")]));
  await new OpenAIResponsesModel({ model: "gpt-x", apiKey: "sk-test", fetch }).next(exchange, [], "");
  expect(sent[0]!.url).toBe("https://api.openai.com/v1/responses");
  expect(sent[0]!.headers.get("authorization")).toBe("Bearer sk-test");
  expect(sent[0]!.body.model).toBe("gpt-x");
});

test("sends every request to a configured base URL", async () => {
  const { fetch, sent } = stubFetch(200, response([outputMessage("hi")]));
  const baseURL = "https://openrouter.ai/api/v1";
  await new OpenAIResponsesModel({ model: "openai/gpt-x", apiKey: "sk-or", baseURL, fetch }).next(exchange, [], "");
  expect(sent[0]!.url).toBe("https://openrouter.ai/api/v1/responses");
});

test("sends the whole conversation with storage off and no stored references", async () => {
  const { fetch, sent } = stubFetch(200, response([outputMessage("hi")]));
  await new OpenAIResponsesModel({ model: "m", apiKey: "k", fetch }).next(exchange, [lookup], "");
  const body = sent[0]!.body;
  expect(body.store).toBe(false);
  expect(body).not.toHaveProperty("previous_response_id");
  expect(body).not.toHaveProperty("conversation");
  expect(body.input).toEqual([
    { role: "user", content: "From: owner\n\nwhat is a?" },
    { type: "function_call", call_id: "c1", name: "lookup", arguments: JSON.stringify({ key: "a" }) },
    { type: "function_call_output", call_id: "c1", output: "42" },
    { role: "assistant", content: "a is 42" },
    { role: "user", content: "From: a1b2c3d4e5f6\n\nthanks" },
  ]);
  for (const item of body.input as Record<string, unknown>[]) expect(item).not.toHaveProperty("id");
});

test("offers each tool as a non-strict function tool", async () => {
  const { fetch, sent } = stubFetch(200, response([outputMessage("hi")]));
  await new OpenAIResponsesModel({ model: "m", apiKey: "k", fetch }).next(exchange, [lookup], "");
  expect(sent[0]!.body.tools).toEqual([
    { type: "function", name: "lookup", description: "Look up a key.", parameters: lookup.inputSchema, strict: false },
  ]);
});

test("maps output messages and function calls in order, and drops reasoning", async () => {
  const { fetch } = stubFetch(
    200,
    response([
      { type: "reasoning", id: "rs_1", summary: [] },
      {
        ...outputMessage("check"),
        content: [
          { type: "output_text", text: "check", annotations: [] },
          { type: "output_text", text: "ing", annotations: [] },
        ],
      },
      { type: "function_call", id: "fc_1", call_id: "c1", name: "lookup", arguments: '{"key":"a"}', status: "completed" },
    ]),
  );
  const items = await new OpenAIResponsesModel({ model: "m", apiKey: "k", fetch }).next(exchange, [lookup], "");
  expect(items).toEqual([
    { type: "message", role: "assistant", text: "checking" },
    { type: "tool_call", id: "c1", name: "lookup", input: { key: "a" } },
  ]);
});

test("keeps a refusal's explanation as the assistant's text", async () => {
  const { fetch } = stubFetch(
    200,
    response([{ ...outputMessage(""), content: [{ type: "refusal", refusal: "I can't help with that." }] }]),
  );
  const items = await new OpenAIResponsesModel({ model: "m", apiKey: "k", fetch }).next(exchange, [], "");
  expect(items).toEqual([{ type: "message", role: "assistant", text: "I can't help with that." }]);
});

test("fails on an output type it doesn't map, naming the type", async () => {
  const { fetch } = stubFetch(200, response([{ type: "web_search_call", id: "ws_1", status: "completed" }]));
  await expect(new OpenAIResponsesModel({ model: "m", apiKey: "k", fetch }).next(exchange, [], "")).rejects.toThrow(
    /web_search_call/,
  );
});

test("fails on arguments that aren't valid JSON, naming the tool", async () => {
  const { fetch } = stubFetch(
    200,
    response([{ type: "function_call", id: "fc_1", call_id: "c1", name: "lookup", arguments: "{key:", status: "completed" }]),
  );
  await expect(new OpenAIResponsesModel({ model: "m", apiKey: "k", fetch }).next(exchange, [lookup], "")).rejects.toThrow(
    /lookup/,
  );
});

test("wraps provider failures in a plain Error with the provider's message and error as cause", async () => {
  const { fetch } = stubFetch(401, { error: { message: "Incorrect API key provided", type: "invalid_request_error" } });
  const error = await new OpenAIResponsesModel({ model: "m", apiKey: "bad", fetch }).next(exchange, [], "").catch((e) => e);
  expect(error.constructor).toBe(Error);
  expect(error.message).toMatch(/Incorrect API key provided/);
  expect(error.cause).toBeInstanceOf(Error);
  expect(error.cause.constructor.name).toBe("AuthenticationError");
});

test("fails when the provider reports a failed generation in a successful response", async () => {
  const providerError = { code: "server_error", message: "Generation failed" };
  const { fetch } = stubFetch(200, { ...response([]), status: "failed", error: providerError });
  const error = await new OpenAIResponsesModel({ model: "m", apiKey: "k", fetch }).next(exchange, [], "").catch((e) => e);
  expect(error.constructor).toBe(Error);
  expect(error.message).toMatch(/Generation failed/);
  expect(error.cause).toEqual(providerError);
});

test("a received message is sent as a user message naming its sender", async () => {
  const { fetch, sent } = stubFetch(200, response([outputMessage("hello")]));
  await new OpenAIResponsesModel({ model: "m", apiKey: "k", fetch }).next(
    [{ type: "message", role: "user", from: "a1b2c3d4e5f6", text: "hi" }],
    [],
    "",
  );
  expect(sent[0]!.body.input).toEqual([{ role: "user", content: "From: a1b2c3d4e5f6\n\nhi" }]);
});

test("a received message with an empty sender is sent as its text alone", async () => {
  const { fetch, sent } = stubFetch(200, response([outputMessage("hello")]));
  await new OpenAIResponsesModel({ model: "m", apiKey: "k", fetch }).next([{ type: "message", role: "user", from: "", text: "hi" }], [], "");
  expect(sent[0]!.body.input).toEqual([{ role: "user", content: "hi" }]);
});

test("sends the system instructions as the request's instructions", async () => {
  const { fetch, sent } = stubFetch(200, response([outputMessage("hi")]));
  await new OpenAIResponsesModel({ model: "m", apiKey: "k", fetch }).next(exchange, [], "You are agent a1.");
  expect(sent[0]!.body.instructions).toBe("You are agent a1.");
});

test("a cancelled call aborts its request and fails with a cancellation error", async () => {
  let aborted = false;
  let started!: () => void;
  const waiting = new Promise<void>((resolve) => (started = resolve));
  // A provider that never answers, until its request is aborted.
  const fetch = ((_url: string | URL | Request, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      started();
      init?.signal?.addEventListener("abort", () => {
        aborted = true;
        reject(init.signal!.reason);
      });
    })) as typeof globalThis.fetch;
  const abort = new AbortController();
  const call = new OpenAIResponsesModel({ model: "m", apiKey: "k", fetch }).next(exchange, [], "", abort.signal);
  await waiting;
  abort.abort();
  await expect(call).rejects.toMatchObject({ name: "AbortError" });
  expect(aborted).toBe(true);
});
