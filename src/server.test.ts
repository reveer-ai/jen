import { mkdtempSync, rmSync } from "node:fs";
import type http from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { openStore, type Store } from "./agent/store.ts";
import type { Item, Model } from "./model/port.ts";
import { ScriptedModel } from "./model/scripted.ts";
import { createServer } from "./server.ts";

const user = (text: string): Item => ({ type: "message", role: "user", text });
const assistant = (text: string): Item => ({ type: "message", role: "assistant", text });

const token = "secret";
const auth = { Authorization: `Bearer ${token}` };

let dir: string;
let store: Store;
let server: http.Server | undefined;
let base: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "jen-server-"));
  store = openStore(join(dir, "agent.db"));
});
afterEach(async () => {
  vi.useRealTimers();
  if (server) {
    server.closeAllConnections();
    await new Promise((resolve) => server!.close(resolve));
    server = undefined;
  }
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

async function serve(model: Model) {
  server = createServer({ store, model, token });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

function post(text: unknown, init: RequestInit = {}) {
  return fetch(`${base}/messages`, { method: "POST", headers: auth, body: JSON.stringify({ text }), ...init });
}

// A model whose next call waits until the test releases it.
function heldModel(reply: Item[]) {
  let started!: () => void;
  let release!: () => void;
  const startedP = new Promise<void>((resolve) => (started = resolve));
  const releaseP = new Promise<void>((resolve) => (release = resolve));
  const model: Model = {
    async next() {
      started();
      await releaseP;
      return structuredClone(reply);
    },
  };
  return { model, started: startedP, release };
}

type Event = { id?: string; event?: string; data?: string; comment?: string };

// Reads one SSE stream event by event.
async function openEvents(headers: Record<string, string> = {}) {
  const res = await fetch(`${base}/events`, { headers: { ...auth, ...headers } });
  const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  async function next(): Promise<Event> {
    while (!buffer.includes("\n\n")) {
      const { value, done } = await reader.read();
      if (done) throw new Error("stream ended");
      buffer += value;
    }
    const end = buffer.indexOf("\n\n");
    const block = buffer.slice(0, end);
    buffer = buffer.slice(end + 2);
    const event: Event = {};
    for (const line of block.split("\n")) {
      if (line.startsWith(":")) event.comment = line.slice(1).trim();
      else {
        const i = line.indexOf(": ");
        event[line.slice(0, i) as "id" | "event" | "data"] = line.slice(i + 2);
      }
    }
    return event;
  }
  async function items(n: number) {
    const out: { id: number; item: Item }[] = [];
    while (out.length < n) {
      const event = await next();
      if (event.event === "item") out.push({ id: Number(event.id), item: JSON.parse(event.data!) });
    }
    return out;
  }
  return { res, next, items };
}

describe("every request carries the agent's token", () => {
  test("a message without a token gets 401 and changes nothing", async () => {
    await serve(new ScriptedModel([[assistant("hi")]]));
    const res = await fetch(`${base}/messages`, { method: "POST", body: JSON.stringify({ text: "hello" }) });
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe("Bearer");
    expect(store.load()).toEqual([]);
  });

  test("the event stream with a wrong token gets 401 and no events", async () => {
    store.append([user("hello"), assistant("hi")]);
    await serve(new ScriptedModel([]));
    const res = await fetch(`${base}/events`, { headers: { Authorization: "Bearer wrong" } });
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe("Bearer");
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(await res.json()).toHaveProperty("error");
  });
});

describe("sending a message runs a turn and returns its reply", () => {
  test("one message gets the assistant's reply and is saved", async () => {
    await serve(new ScriptedModel([[assistant("hi")]]));
    const res = await post("hello");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ reply: "hi" });
    expect(store.load()).toEqual([user("hello"), assistant("hi")]);
  });

  test("the second message's turn runs on the conversation that includes the first", async () => {
    const model = new ScriptedModel([[assistant("hi")], [assistant("fine")]]);
    await serve(model);
    await post("hello");
    expect(await (await post("how are you?")).json()).toEqual({ reply: "fine" });
    expect(model.calls[1]!.items).toEqual([user("hello"), assistant("hi"), user("how are you?")]);
  });
});

describe("an invalid message is rejected", () => {
  test("empty text gets 400 and changes nothing", async () => {
    await serve(new ScriptedModel([[assistant("hi")]]));
    const res = await post("");
    expect(res.status).toBe(400);
    expect(await res.json()).toHaveProperty("error");
    expect(store.load()).toEqual([]);
  });

  test("a body that isn't JSON gets 400 and changes nothing", async () => {
    await serve(new ScriptedModel([[assistant("hi")]]));
    const res = await fetch(`${base}/messages`, { method: "POST", headers: auth, body: "hello" });
    expect(res.status).toBe(400);
    expect(await res.json()).toHaveProperty("error");
    expect(store.load()).toEqual([]);
  });
});

describe("the agent runs one turn at a time", () => {
  test("a message during a turn gets 409, and only the first turn is saved", async () => {
    const held = heldModel([assistant("hi")]);
    await serve(held.model);
    const first = post("hello");
    await held.started;
    const second = await post("again");
    expect(second.status).toBe(409);
    expect(await second.json()).toHaveProperty("error");
    held.release();
    expect((await first).status).toBe(200);
    expect(store.load()).toEqual([user("hello"), assistant("hi")]);
  });

  test("a message after a turn has ended is run", async () => {
    await serve(new ScriptedModel([[assistant("hi")], [assistant("again")]]));
    await post("hello");
    expect(await (await post("more")).json()).toEqual({ reply: "again" });
  });
});

describe("a failed turn is reported to its sender", () => {
  test("a model failure gets 500, saves nothing, and the next message is handled", async () => {
    let fail = true;
    const scripted = new ScriptedModel([[assistant("hi")]]);
    await serve({
      next: (items, tools) => (fail ? Promise.reject(new Error("model unreachable")) : scripted.next(items, tools)),
    });
    const res = await post("hello");
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "model unreachable" });
    expect(store.load()).toEqual([]);
    fail = false;
    expect(await (await post("hello")).json()).toEqual({ reply: "hi" });
  });
});

describe("a turn outlives its sender's connection", () => {
  test("a sender that hangs up mid-turn still has its turn saved and streamed", async () => {
    const held = heldModel([assistant("hi")]);
    await serve(held.model);
    const stream = await openEvents();
    const abort = new AbortController();
    const sent = post("hello", { signal: abort.signal });
    await held.started;
    abort.abort();
    await expect(sent).rejects.toThrow();
    held.release();
    expect(await stream.items(2)).toEqual([
      { id: 1, item: user("hello") },
      { id: 2, item: assistant("hi") },
    ]);
    expect(store.load()).toEqual([user("hello"), assistant("hi")]);
  });
});

describe("the event stream sends the conversation", () => {
  test("a new client gets every item of both turns in order, with positions as IDs", async () => {
    store.append([user("hello"), assistant("hi")]);
    store.append([user("how are you?"), assistant("fine")]);
    await serve(new ScriptedModel([]));
    const stream = await openEvents();
    expect(stream.res.status).toBe(200);
    expect(stream.res.headers.get("content-type")).toBe("text/event-stream");
    expect(await stream.items(4)).toEqual([
      { id: 1, item: user("hello") },
      { id: 2, item: assistant("hi") },
      { id: 3, item: user("how are you?") },
      { id: 4, item: assistant("fine") },
    ]);
  });

  test("an empty conversation sends no items until a turn is saved", async () => {
    await serve(new ScriptedModel([[assistant("hi")]]));
    const stream = await openEvents();
    await post("hello");
    // The first event is the new turn's, so nothing came before it.
    expect(await stream.next()).toEqual({ id: "1", event: "item", data: JSON.stringify(user("hello")) });
  });
});

describe("the event stream resumes after the last event seen", () => {
  test("Last-Event-ID: 2 on four items sends items 3 and 4 only", async () => {
    store.append([user("hello"), assistant("hi")]);
    store.append([user("how are you?"), assistant("fine")]);
    await serve(new ScriptedModel([[assistant("ok")]]));
    const stream = await openEvents({ "Last-Event-ID": "2" });
    expect(await stream.items(2)).toEqual([
      { id: 3, item: user("how are you?") },
      { id: 4, item: assistant("fine") },
    ]);
    await post("bye");
    expect((await stream.items(1))[0]!.id).toBe(5);
  });
});

describe("the event stream sends only saved items", () => {
  test("an open stream gets a live turn's items after the ones it had", async () => {
    store.append([user("hello"), assistant("hi")]);
    await serve(new ScriptedModel([[assistant("fine")]]));
    const stream = await openEvents();
    expect(await stream.items(2)).toHaveLength(2);
    await post("how are you?");
    expect(await stream.items(2)).toEqual([
      { id: 3, item: user("how are you?") },
      { id: 4, item: assistant("fine") },
    ]);
  });

  test("two watchers each get a turn's items once", async () => {
    await serve(new ScriptedModel([[assistant("hi")], [assistant("again")]]));
    const a = await openEvents();
    const b = await openEvents();
    await post("hello");
    await post("more");
    const expected = [
      { id: 1, item: user("hello") },
      { id: 2, item: assistant("hi") },
      { id: 3, item: user("more") },
      { id: 4, item: assistant("again") },
    ];
    expect(await a.items(4)).toEqual(expected);
    expect(await b.items(4)).toEqual(expected);
  });

  test("a failed turn sends nothing", async () => {
    let fail = true;
    const scripted = new ScriptedModel([[assistant("hi")]]);
    await serve({
      next: (items, tools) => (fail ? Promise.reject(new Error("model unreachable")) : scripted.next(items, tools)),
    });
    const stream = await openEvents();
    expect((await post("lost")).status).toBe(500);
    fail = false;
    await post("hello");
    expect(await stream.items(2)).toEqual([
      { id: 1, item: user("hello") },
      { id: 2, item: assistant("hi") },
    ]);
  });
});

describe("a quiet event stream is kept alive", () => {
  test("an idle stream gets a comment line within 15 seconds", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    await serve(new ScriptedModel([]));
    const stream = await openEvents();
    vi.advanceTimersByTime(15_000);
    expect(await stream.next()).toEqual({ comment: "keepalive" });
  });
});

describe("unknown routes are not found", () => {
  test("GET /status with the token gets 404", async () => {
    await serve(new ScriptedModel([]));
    const res = await fetch(`${base}/status`, { headers: auth });
    expect(res.status).toBe(404);
    expect(await res.json()).toHaveProperty("error");
  });
});
