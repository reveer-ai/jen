import { expect, test } from "vitest";
import type { Item, ToolSpec } from "./port.ts";
import { ScriptedModel } from "./scripted.ts";

const user = (text: string): Item => ({ type: "message", role: "user", from: "owner", text });
const assistant = (text: string): Item => ({ type: "message", role: "assistant", text });
const tool: ToolSpec = { name: "lookup", description: "Look up a key.", inputSchema: { type: "object" } };

test("plays back turns in order and records each call's inputs", async () => {
  const t1 = [assistant("one")];
  const t2 = [assistant("two")];
  const model = new ScriptedModel([t1, t2]);

  expect(await model.next([user("a")], [tool], "You are agent a1.")).toEqual(t1);
  expect(await model.next([user("a"), assistant("one"), user("b")], [], "")).toEqual(t2);
  expect(model.calls).toEqual([
    { items: [user("a")], tools: [tool], instructions: "You are agent a1." },
    { items: [user("a"), assistant("one"), user("b")], tools: [], instructions: "" },
  ]);
});

test("records snapshots, not references to the caller's data", async () => {
  const model = new ScriptedModel([[assistant("one")]]);
  const message = { type: "message", role: "user", from: "owner", text: "a" } satisfies Item;
  const items: Item[] = [message];
  const tools = [{ ...tool }];

  await model.next(items, tools, "");
  items.push(user("b"));
  message.text = "changed";
  tools[0]!.name = "changed";

  expect(model.calls[0]).toEqual({ items: [user("a")], tools: [tool], instructions: "" });
});

test("fails once the script runs out", async () => {
  const model = new ScriptedModel([[assistant("one")]]);
  await model.next([user("a")], [], "");
  await expect(model.next([user("a")], [], "")).rejects.toThrow(/script exhausted/);
});

test("a cancelled call fails with a cancellation error, returns nothing and uses no turn", async () => {
  const model = new ScriptedModel([[assistant("one")]]);
  const abort = new AbortController();
  abort.abort();
  await expect(model.next([user("a")], [], "", abort.signal)).rejects.toMatchObject({ name: "AbortError" });
  expect(model.calls).toEqual([]);
  expect(await model.next([user("a")], [], "")).toEqual([assistant("one")]);
});
