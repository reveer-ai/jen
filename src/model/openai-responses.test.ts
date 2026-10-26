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
  { type: "message", role: "user", text: "what is a?" },
  { type: "tool_call", id: "c1", name: "lookup", input: { key: "a" } },
  { type: "tool_result", callId: "c1", output: "42" },
  { type: "message", role: "assistant", text: "a is 42" },
  { type: "message", role: "user", text: "thanks" },
];

test("defaults to OpenAI's endpoint, with the key and the model", async () => {
  const { fetch, sent } = stubFetch(200, response([outputMessage("hi")]));
  await new OpenAIResponsesModel({ model: "gpt-x", apiKey: "sk-test", fetch }).next(exchange, []);
  expect(sent[0]!.url).toBe("https://api.openai.com/v1/responses");
  expect(sent[0]!.headers.get("authorization")).toBe("Bearer sk-test");
  expect(sent[0]!.body.model).toBe("gpt-x");
});

test("sends every request to a configured base URL", async () => {
  const { fetch, sent } = stubFetch(200, response([outputMessage("hi")]));
  const baseURL = "https://openrouter.ai/api/v1";
  await new OpenAIResponsesModel({ model: "openai/gpt-x", apiKey: "sk-or", baseURL, fetch }).next(exchange, []);
  expect(sent[0]!.url).toBe("https://openrouter.ai/api/v1/responses");
});

test("sends the whole conversation with storage off and no stored references", async () => {
  const { fetch, sent } = stubFetch(200, response([outputMessage("hi")]));
  await new OpenAIResponsesModel({ model: "m", apiKey: "k", fetch }).next(exchange, [lookup]);
  const body = sent[0]!.body;
  expect(body.store).toBe(false);
  expect(body).not.toHaveProperty("previous_response_id");
  expect(body).not.toHaveProperty("conversation");
  expect(body.input).toEqual([
    { role: "user", content: "what is a?" },
    { type: "function_call", call_id: "c1", name: "lookup", arguments: JSON.stringify({ key: "a" }) },
    { type: "function_call_output", call_id: "c1", output: "42" },
    { role: "assistant", content: "a is 42" },
    { role: "user", content: "thanks" },
  ]);
  for (const item of body.input as Record<string, unknown>[]) expect(item).not.toHaveProperty("id");
});

test("offers each tool as a non-strict function tool", async () => {
  const { fetch, sent } = stubFetch(200, response([outputMessage("hi")]));
  await new OpenAIResponsesModel({ model: "m", apiKey: "k", fetch }).next(exchange, [lookup]);
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
  const items = await new OpenAIResponsesModel({ model: "m", apiKey: "k", fetch }).next(exchange, [lookup]);
  expect(items).toEqual([
    { type: "message", role: "assistant", text: "checking" },
    { type: "tool_call", id: "c1", name: "lookup", input: { key: "a" } },
  ]);
});

test("fails on an output type it doesn't map, naming the type", async () => {
  const { fetch } = stubFetch(200, response([{ type: "web_search_call", id: "ws_1", status: "completed" }]));
  await expect(new OpenAIResponsesModel({ model: "m", apiKey: "k", fetch }).next(exchange, [])).rejects.toThrow(
    /web_search_call/,
  );
});

test("fails on arguments that aren't valid JSON, naming the tool", async () => {
  const { fetch } = stubFetch(
    200,
    response([{ type: "function_call", id: "fc_1", call_id: "c1", name: "lookup", arguments: "{key:", status: "completed" }]),
  );
  await expect(new OpenAIResponsesModel({ model: "m", apiKey: "k", fetch }).next(exchange, [lookup])).rejects.toThrow(
    /lookup/,
  );
});

test("wraps provider failures in a plain Error with the provider's message and error as cause", async () => {
  const { fetch } = stubFetch(401, { error: { message: "Incorrect API key provided", type: "invalid_request_error" } });
  const error = await new OpenAIResponsesModel({ model: "m", apiKey: "bad", fetch }).next(exchange, []).catch((e) => e);
  expect(error.constructor).toBe(Error);
  expect(error.message).toMatch(/Incorrect API key provided/);
  expect(error.cause).toBeInstanceOf(Error);
  expect(error.cause.constructor.name).toBe("AuthenticationError");
});
