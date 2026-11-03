import { describe, expect, test } from "vitest";
import type { Item, Json } from "./model/port.ts";
import { ScriptedModel } from "./model/scripted.ts";
import { runTurn, type Tool } from "./loop.ts";

const user = (text: string): Item => ({ type: "message", role: "user", text });
const assistant = (text: string): Item => ({ type: "message", role: "assistant", text });
const call = (id: string, name: string, input: Json): Item => ({ type: "tool_call", id, name, input });
const result = (callId: string, output: string): Item => ({ type: "tool_result", callId, output });

function tool(name: string, run: (input: Json) => Promise<string>): Tool {
  return { name, description: `The ${name} tool.`, inputSchema: { type: "object" }, run };
}

describe("a turn starts from a user message and the existing conversation", () => {
  test("first turn sends only the user message", async () => {
    const model = new ScriptedModel([[assistant("hi")]]);
    await runTurn(model, [], [], "hello");
    expect(model.calls[0]!.items).toEqual([user("hello")]);
  });

  test("later turn sends the conversation, then the new message", async () => {
    const model = new ScriptedModel([[assistant("fine")]]);
    await runTurn(model, [], [user("hello"), assistant("hi")], "how are you?");
    expect(model.calls[0]!.items).toEqual([user("hello"), assistant("hi"), user("how are you?")]);
  });

  test("every model call is sent every tool's description", async () => {
    const lookup = { ...tool("lookup", async () => "42"), inputSchema: { type: "object", properties: { key: { type: "string" } } } };
    const other = tool("other", async () => "");
    const model = new ScriptedModel([[call("c1", "lookup", {})], [assistant("done")]]);
    await runTurn(model, [lookup, other], [], "go");
    const specs = [
      { name: "lookup", description: "The lookup tool.", inputSchema: lookup.inputSchema },
      { name: "other", description: "The other tool.", inputSchema: { type: "object" } },
    ];
    expect(model.calls.map((c) => c.tools)).toEqual([specs, specs]);
  });
});

describe("tool calls are run and their results returned to the model", () => {
  test("one tool call", async () => {
    const inputs: Json[] = [];
    const lookup = tool("lookup", async (input) => (inputs.push(input), "42"));
    const model = new ScriptedModel([[call("c1", "lookup", { key: "a" })], [assistant("a is 42")]]);
    await runTurn(model, [lookup], [], "what is a?");
    expect(inputs).toEqual([{ key: "a" }]);
    expect(model.calls[1]!.items).toEqual([user("what is a?"), call("c1", "lookup", { key: "a" }), result("c1", "42")]);
  });

  test("several tool calls run in order, and their results follow in order", async () => {
    const ran: string[] = [];
    const a = tool("a", async () => (ran.push("a"), "A"));
    const b = tool("b", async () => (ran.push("b"), "B"));
    const model = new ScriptedModel([[call("c1", "a", {}), call("c2", "b", {})], [assistant("done")]]);
    await runTurn(model, [a, b], [], "go");
    expect(ran).toEqual(["a", "b"]);
    expect(model.calls[1]!.items.slice(-2)).toEqual([result("c1", "A"), result("c2", "B")]);
  });
});

describe("the turn ends when the model answers without calling a tool", () => {
  test("direct answer ends after one model call", async () => {
    const model = new ScriptedModel([[assistant("hi")], [assistant("unused")]]);
    await runTurn(model, [], [], "hello");
    expect(model.calls).toHaveLength(1);
  });

  test("answer after tool use ends after the second model call", async () => {
    const model = new ScriptedModel([[call("c1", "lookup", {})], [assistant("done")], [assistant("unused")]]);
    await runTurn(model, [tool("lookup", async () => "42")], [], "go");
    expect(model.calls).toHaveLength(2);
  });
});

describe("a turn reports every item it added", () => {
  test("returns the user message, tool call, tool result and answer, in order", async () => {
    const model = new ScriptedModel([[call("c1", "lookup", { key: "a" })], [assistant("a is 42")]]);
    const items = await runTurn(model, [tool("lookup", async () => "42")], [], "what is a?");
    expect(items).toEqual([user("what is a?"), call("c1", "lookup", { key: "a" }), result("c1", "42"), assistant("a is 42")]);
  });

  test("leaves the caller's conversation untouched", async () => {
    const conversation = [user("hello"), assistant("hi")];
    const before = structuredClone(conversation);
    const model = new ScriptedModel([[call("c1", "lookup", {})], [assistant("done")]]);
    await runTurn(model, [tool("lookup", async () => "42")], conversation, "go");
    expect(conversation).toEqual(before);
  });
});

describe("tool failures are reported to the model", () => {
  test("a thrown error becomes an Error: result", async () => {
    const failing = tool("lookup", async () => {
      throw new Error("not found");
    });
    const model = new ScriptedModel([[call("c1", "lookup", {})], [assistant("sorry")]]);
    await runTurn(model, [failing], [], "go");
    expect(model.calls).toHaveLength(2);
    expect(model.calls[1]!.items.at(-1)).toEqual(result("c1", "Error: not found"));
  });

  test("an unknown tool becomes an Error: result naming it", async () => {
    const model = new ScriptedModel([[call("c1", "missing", {})], [assistant("sorry")]]);
    await runTurn(model, [], [], "go");
    expect(model.calls).toHaveLength(2);
    const last = model.calls[1]!.items.at(-1)!;
    expect(last.type === "tool_result" && last.output).toMatch(/^Error:.*missing/);
  });
});

describe("model failures end the turn", () => {
  test("a failure on the second model call fails the turn", async () => {
    // The script holds one turn, so the second call throws.
    const model = new ScriptedModel([[call("c1", "lookup", {})]]);
    await expect(runTurn(model, [tool("lookup", async () => "42")], [], "go")).rejects.toThrow(/script exhausted/);
  });
});
