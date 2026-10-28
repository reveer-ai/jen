import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { Item } from "../model/port.ts";
import { openStore } from "./store.ts";

const user = (text: string): Item => ({ type: "message", role: "user", text });
const assistant = (text: string): Item => ({ type: "message", role: "assistant", text });

let dir: string;
let path: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "jen-store-"));
  path = join(dir, "agent.db");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("a new store starts with an empty conversation", () => {
  test("first open loads no items", () => {
    const store = openStore(path);
    expect(store.load()).toEqual([]);
    store.close();
  });
});

describe("a loaded conversation holds every saved item in order", () => {
  test("reload after reopening returns both turns in order", () => {
    const first = [user("hello"), assistant("hi")];
    const second = [user("how are you?"), assistant("fine")];
    const store = openStore(path);
    store.append(first);
    store.append(second);
    store.close();

    const reopened = openStore(path);
    expect(reopened.load()).toEqual([...first, ...second]);
    reopened.close();
  });

  test("every item type survives", () => {
    const items: Item[] = [
      user("look up a"),
      { type: "tool_call", id: "c1", name: "lookup", input: { key: "a", options: { depth: 2, tags: ["x", null, true] } } },
      { type: "tool_result", callId: "c1", output: "42" },
      assistant("a is 42"),
    ];
    const store = openStore(path);
    store.append(items);
    store.close();

    const reopened = openStore(path);
    expect(reopened.load()).toEqual(items);
    reopened.close();
  });
});

describe("a turn is saved whole or not at all", () => {
  test("a failure while saving keeps only the earlier turns", () => {
    const first = [user("hello"), assistant("hi")];
    const store = openStore(path);
    store.append(first);
    // The second item can't be serialized, so saving fails after the first was written.
    const broken = { type: "tool_call", id: "c1", name: "lookup", input: { n: 1n } } as unknown as Item;
    expect(() => store.append([user("go"), broken, assistant("done")])).toThrow();
    expect(store.load()).toEqual(first);
    store.close();

    const reopened = openStore(path);
    expect(reopened.load()).toEqual(first);
    reopened.close();
  });
});
