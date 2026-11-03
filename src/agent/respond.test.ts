import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { Item, Json } from "./model/port.ts";
import { ScriptedModel } from "./model/scripted.ts";
import { respond } from "./respond.ts";
import { openStore, type Store } from "./store.ts";

const user = (text: string): Item => ({ type: "message", role: "user", text });
const assistant = (text: string): Item => ({ type: "message", role: "assistant", text });
const call = (id: string, name: string, input: Json): Item => ({ type: "tool_call", id, name, input });

let dir: string;
let store: Store;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "jen-respond-"));
  store = openStore(join(dir, "agent.db"));
});
afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("a completed turn is saved and the next turn sees it", () => {
  test("the second message is sent the first turn, then itself", async () => {
    await respond(store, new ScriptedModel([[assistant("hi")]]), "hello");
    const model = new ScriptedModel([[assistant("fine")]]);
    await respond(store, model, "how are you?");
    expect(model.calls[0]!.items).toEqual([user("hello"), assistant("hi"), user("how are you?")]);
    expect(store.load()).toEqual([user("hello"), assistant("hi"), user("how are you?"), assistant("fine")]);
  });
});

describe("a failed turn saves nothing", () => {
  test("a model failure leaves the stored conversation unchanged", async () => {
    await respond(store, new ScriptedModel([[assistant("hi")]]), "hello");
    await expect(respond(store, new ScriptedModel([]), "again")).rejects.toThrow(/script exhausted/);
    expect(store.load()).toEqual([user("hello"), assistant("hi")]);
  });
});

describe("the reply is the assistant messages that end the turn", () => {
  test("one message is the reply", async () => {
    expect(await respond(store, new ScriptedModel([[assistant("hi")]]), "hello")).toBe("hi");
  });

  test("several ending messages are joined by blank lines, and earlier ones are left out", async () => {
    // The unknown tool's error result lets the turn continue to its answer.
    const model = new ScriptedModel([[assistant("checking"), call("c1", "lookup", {})], [assistant("first"), assistant("second")]]);
    expect(await respond(store, model, "go")).toBe("first\n\nsecond");
  });

  test("no text is an empty reply, and the turn is still saved", async () => {
    expect(await respond(store, new ScriptedModel([[]]), "hello")).toBe("");
    expect(store.load()).toEqual([user("hello")]);
  });
});
