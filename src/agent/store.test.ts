import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { Item } from "./model/port.ts";
import { openStore } from "./store.ts";

const user = (text: string, from = "owner"): Item => ({ type: "message", role: "user", from, text });
const assistant = (text: string): Item => ({ type: "message", role: "assistant", text });

let dir: string;
let path: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "jen-store-"));
  path = join(dir, "agent.db");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("a new store starts empty", () => {
  test("first open loads no items and has an empty inbox", () => {
    const store = openStore(path);
    expect(store.load()).toEqual([]);
    expect(store.inbox()).toEqual([]);
    store.close();
  });
});

describe("a loaded conversation holds every saved item in order", () => {
  test("reload after reopening returns both turns in order", () => {
    const first = [user("hello"), assistant("hi")];
    const second = [user("how are you?"), assistant("fine")];
    const store = openStore(path);
    for (const item of [...first, ...second]) store.save([item]);
    store.close();

    const reopened = openStore(path);
    expect(reopened.load()).toEqual([...first, ...second]);
    reopened.close();
  });

  test("every item type survives", () => {
    const items: Item[] = [
      user("look up a", "a1b2c3d4e5f6"),
      { type: "tool_call", id: "c1", name: "lookup", input: { key: "a", options: { depth: 2, tags: ["x", null, true] } } },
      { type: "tool_result", callId: "c1", output: "42" },
      assistant("a is 42"),
    ];
    const store = openStore(path);
    store.save(items.slice(0, 1));
    store.save(items.slice(1, 2));
    store.save(items.slice(2, 3));
    store.save(items.slice(3));
    store.close();

    const reopened = openStore(path);
    expect(reopened.load()).toEqual(items);
    reopened.close();
  });
});

describe("each step is saved on its own", () => {
  test("a saved response is in the store as soon as the save returns", () => {
    const store = openStore(path);
    const response = [assistant("checking"), { type: "tool_call", id: "c1", name: "lookup", input: {} } satisfies Item];
    store.save(response);
    // A second connection sees it, as a new process would.
    const other = openStore(path);
    expect(other.load()).toEqual(response);
    other.close();
    store.close();
  });

  test("a failure while saving a step keeps only the earlier steps", () => {
    const first = [user("hello"), assistant("hi")];
    const store = openStore(path);
    store.save(first);
    // The second item can't be serialized, so saving fails after the first was written.
    const broken = { type: "tool_call", id: "c1", name: "lookup", input: { n: 1n } } as unknown as Item;
    expect(() => store.save([assistant("checking"), broken])).toThrow();
    expect(store.load()).toEqual(first);
    store.close();

    const reopened = openStore(path);
    expect(reopened.load()).toEqual(first);
    reopened.close();
  });
});

describe("the inbox holds messages until they're delivered", () => {
  test("the inbox survives reopening, with sender and urgency", () => {
    const store = openStore(path);
    store.accept({ from: "owner", text: "hello", urgent: false });
    store.accept({ from: "a1b2c3d4e5f6", text: "stop", urgent: true });
    store.close();

    const reopened = openStore(path);
    expect(reopened.inbox()).toEqual([
      { from: "owner", text: "hello", urgent: false },
      { from: "a1b2c3d4e5f6", text: "stop", urgent: true },
    ]);
    expect(reopened.load()).toEqual([]);
    reopened.close();
  });

  test("delivery moves every message into the conversation in arrival order", () => {
    const store = openStore(path);
    store.save([user("earlier"), assistant("ok")]);
    store.accept({ from: "owner", text: "one", urgent: false });
    store.accept({ from: "runtime", text: "two", urgent: true });
    expect(store.deliver()).toBe(2);
    expect(store.inbox()).toEqual([]);
    expect(store.load()).toEqual([user("earlier"), assistant("ok"), user("one"), user("two", "runtime")]);
    expect(store.deliver()).toBe(0);
    store.close();
  });

  test("a delivery that fails leaves every message in the inbox and none in the conversation", () => {
    const store = openStore(path);
    store.accept({ from: "owner", text: "one", urgent: false });
    store.accept({ from: "owner", text: "two", urgent: false });
    // A second connection holds the write lock, so the delivery can't write.
    const lock = new DatabaseSync(path);
    lock.exec("BEGIN IMMEDIATE");
    expect(() => store.deliver()).toThrow();
    lock.exec("ROLLBACK");
    lock.close();
    expect(store.inbox()).toHaveLength(2);
    expect(store.load()).toEqual([]);
    store.close();
  });
});

describe("delivery leaves empty messages", () => {
  test("a message with text is delivered, and the empty one stays until dropped", () => {
    const store = openStore(path);
    store.accept({ from: "a1", text: "", urgent: false });
    store.accept({ from: "owner", text: "one", urgent: false });
    expect(store.deliver()).toBe(1);
    expect(store.load()).toEqual([user("one")]);
    expect(store.inbox()).toEqual([{ from: "a1", text: "", urgent: false }]);
    store.dropEmpty();
    expect(store.inbox()).toEqual([]);
    store.close();
  });
});

describe("the inbox can be delivered as a wait's result", () => {
  test("the result shows every message, and the inbox is empty", () => {
    const store = openStore(path);
    store.save([{ type: "tool_call", id: "w1", name: "wait", input: {} }]);
    store.accept({ from: "a1", text: "first", urgent: false });
    store.accept({ from: "a2", text: "", urgent: false });
    store.answerWait("w1", undefined, (messages) => messages.map((m) => `${m.from}:${m.text}`).join("|"));
    expect(store.load().at(-1)).toEqual({ type: "tool_result", callId: "w1", output: "a1:first|a2:" });
    expect(store.inbox()).toEqual([]);
    store.close();
  });

  test("a failure while answering leaves the inbox and gives the call no result", () => {
    const store = openStore(path);
    store.save([{ type: "tool_call", id: "w1", name: "wait", input: {} }]);
    store.accept({ from: "a1", text: "first", urgent: false });
    expect(() =>
      store.answerWait("w1", undefined, () => {
        throw new Error("render failed");
      }),
    ).toThrow("render failed");
    expect(store.inbox()).toHaveLength(1);
    expect(store.load()).toHaveLength(1);
    store.close();
  });
});

describe("the store records whether a reply to the parent is owed", () => {
  test("a delivered message from the parent owes a reply, across reopening", () => {
    const store = openStore(path);
    store.accept({ from: "runtime", text: "a notice", urgent: false });
    store.deliver("p1");
    expect(store.replyOwed()).toBe(false);
    store.accept({ from: "p1", text: "write a haiku", urgent: false });
    store.deliver("p1");
    store.close();
    const reopened = openStore(path);
    expect(reopened.replyOwed()).toBe(true);
    reopened.close();
  });

  test("a message from the parent in a wait result owes a reply", () => {
    const store = openStore(path);
    store.save([{ type: "tool_call", id: "w1", name: "wait", input: {} }]);
    store.accept({ from: "p1", text: "stop and report", urgent: false });
    store.answerWait("w1", "p1", () => "x");
    expect(store.replyOwed()).toBe(true);
    store.close();
  });

  test("ending the turn clears it", () => {
    const store = openStore(path);
    store.accept({ from: "p1", text: "thanks", urgent: false });
    store.deliver("p1");
    store.endTurn([assistant("")], "");
    expect(store.replyOwed()).toBe(false);
    store.close();
  });
});

describe("the outbox holds replies until the parent has them", () => {
  test("a reply is saved with its response, and survives reopening in order", () => {
    const store = openStore(path);
    store.endTurn([assistant("done")], "done");
    store.queue("second");
    expect(store.load()).toEqual([assistant("done")]);
    store.close();
    const reopened = openStore(path);
    expect(reopened.outbox().map((o) => o.text)).toEqual(["done", "second"]);
    reopened.sent(reopened.outbox()[0]!.seq);
    expect(reopened.outbox().map((o) => o.text)).toEqual(["second"]);
    reopened.close();
  });

  test("an empty reply goes in only when a reply is owed", () => {
    const store = openStore(path);
    store.endTurn([assistant("")], "");
    expect(store.outbox()).toEqual([]);
    store.accept({ from: "p1", text: "thanks", urgent: false });
    store.deliver("p1");
    store.endTurn([assistant("")], "");
    expect(store.outbox().map((o) => o.text)).toEqual([""]);
    store.close();
  });

  test("a root gives no reply, and ending the turn drops empty messages", () => {
    const store = openStore(path);
    store.accept({ from: "a1", text: "", urgent: false });
    store.endTurn([assistant("Canberra")]);
    expect(store.outbox()).toEqual([]);
    expect(store.inbox()).toEqual([]);
    store.close();
  });
});

describe("the store records which sub-agents owe a reply", () => {
  test("accepting a message clears its sender, and the record survives reopening", () => {
    const store = openStore(path);
    expect(store.owe("a1")).toBe(true);
    expect(store.owe("a2")).toBe(true);
    expect(store.owe("a1")).toBe(false);
    store.accept({ from: "a1", text: "", urgent: false });
    expect(store.owed()).toEqual(["a2"]);
    store.close();
    const reopened = openStore(path);
    expect(reopened.owed()).toEqual(["a2"]);
    reopened.clear("a2");
    expect(reopened.owed()).toEqual([]);
    reopened.close();
  });

  test("a discarded message clears its sender's debt and isn't saved", () => {
    const store = openStore(path);
    store.owe("a1");
    store.accept({ from: "a1", text: "", urgent: false }, "w1", true);
    expect(store.owed()).toEqual([]);
    expect(store.inbox()).toEqual([]);
    expect(store.woken("w1")).toBe(true);
    store.close();
  });
});

describe("the store keeps the wake ID that ended a hold", () => {
  test("a wake ID saved with its message survives reopening", () => {
    const store = openStore(path);
    expect(store.woken("w1")).toBe(false);
    store.accept({ from: "owner", text: "wake up", urgent: false }, "w1");
    store.close();

    const reopened = openStore(path);
    expect(reopened.woken("w1")).toBe(true);
    expect(reopened.woken("w2")).toBe(false);
    expect(reopened.inbox()).toEqual([{ from: "owner", text: "wake up", urgent: false }]);
    reopened.close();
  });
});

describe("each saved item has a stable position", () => {
  test("the items after a position are the later ones, in order, with their positions", () => {
    const store = openStore(path);
    store.save([user("hello"), assistant("hi")]);
    store.save([user("how are you?"), assistant("fine")]);
    const [, second] = store.after(0);
    expect(store.after(second!.seq)).toEqual([
      { seq: second!.seq + 1, item: user("how are you?") },
      { seq: second!.seq + 2, item: assistant("fine") },
    ]);
    store.close();
  });

  test("positions survive reopening, and new items come after all of them", () => {
    const store = openStore(path);
    store.save([user("hello"), assistant("hi")]);
    const before = store.after(0);
    store.close();

    const reopened = openStore(path);
    reopened.save([user("again"), assistant("hi again")]);
    const after = reopened.after(0);
    expect(after.slice(0, 2)).toEqual(before);
    const last = Math.max(...before.map((entry) => entry.seq));
    expect(after.slice(2).every((entry) => entry.seq > last)).toBe(true);
    expect(after.slice(2).map((entry) => entry.item)).toEqual([user("again"), assistant("hi again")]);
    reopened.close();
  });

  test("a limit returns only the first items after the position", () => {
    const store = openStore(path);
    store.save([user("hello"), assistant("hi"), user("again"), assistant("hi again")]);
    const all = store.after(0);
    expect(store.after(all[0]!.seq, 2)).toEqual(all.slice(1, 3));
    store.close();
  });

  test("nothing comes after the last item", () => {
    const store = openStore(path);
    store.save([user("hello"), assistant("hi")]);
    expect(store.after(store.after(0).at(-1)!.seq)).toEqual([]);
    store.close();
  });
});

describe("the store keeps the latest UI version", () => {
  test("none before a publish, and two publishes and a reopen give version 2 and the second document", () => {
    const store = openStore(path);
    expect(store.latestUi()).toBeUndefined();
    expect(store.publish("<p>one</p>")).toBe(1);
    expect(store.publish("<p>two</p>")).toBe(2);
    store.close();

    const reopened = openStore(path);
    expect(reopened.latestUi()).toEqual({ version: 2, document: "<p>two</p>" });
    reopened.close();
  });
});
