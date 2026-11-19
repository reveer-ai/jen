import { mkdtempSync, rmSync } from "node:fs";
import http from "node:http";
import { connect, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { openStore, type Store } from "./store.ts";
import type { Item, Json, Model } from "./model/port.ts";
import { ScriptedModel } from "./model/scripted.ts";
import { Agent, type AgentOptions, type Tool } from "./loop.ts";
import { createServer, MAX_MESSAGE, PAGE_POLICY } from "./server.ts";
import { PAGE, TEXTBOX } from "./ui.ts";

const user = (text: string, from = "owner"): Item => ({ type: "message", role: "user", from, text });
const assistant = (text: string): Item => ({ type: "message", role: "assistant", text });
const call = (id: string, name: string, input: Json = {}): Item => ({ type: "tool_call", id, name, input });
const result = (callId: string, output: string): Item => ({ type: "tool_result", callId, output });

const token = "secret";
const auth = { Authorization: `Bearer ${token}` };
const sender = { ...auth, "Jen-From": "owner" };

let dir: string;
let store: Store;
let agent: Agent;
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

async function serve(model: Model, options: Partial<AgentOptions> = {}) {
  agent = new Agent({ store, model, tools: [], instructions: "", delays: [0, 0, 0], ...options });
  agent.start();
  server = createServer({ store, agent, token });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

function post(text: unknown, init: RequestInit = {}) {
  return fetch(`${base}/messages`, { method: "POST", headers: sender, body: JSON.stringify({ text }), ...init });
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

// A model that fails while fail is true, then plays back the script.
function flaky(turns: Item[][]) {
  const scripted = new ScriptedModel(turns);
  const model = {
    fail: true,
    next: (...args: Parameters<Model["next"]>) => (model.fail ? Promise.reject(new Error("model unreachable")) : scripted.next(...args)),
  };
  return model;
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
    const res = await fetch(`${base}/messages`, { method: "POST", headers: { "Jen-From": "owner" }, body: JSON.stringify({ text: "hello" }) });
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe("Bearer");
    expect(store.inbox()).toEqual([]);
    expect(store.load()).toEqual([]);
  });

  test("the event stream with a wrong token gets 401 and no events", async () => {
    store.save([user("hello"), assistant("hi")]);
    await serve(new ScriptedModel([]));
    const res = await fetch(`${base}/events`, { headers: { Authorization: "Bearer wrong" } });
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe("Bearer");
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(await res.json()).toHaveProperty("error");
  });
});

describe("sending a message puts it in the inbox", () => {
  test("a message to an idle agent gets 202 with no reply, and the agent works on it", async () => {
    await serve(new ScriptedModel([[assistant("hi")]]));
    const stream = await openEvents();
    const res = await post("hello");
    expect(res.status).toBe(202);
    expect(await res.text()).toBe("");
    expect(await stream.items(2)).toEqual([
      { id: 1, item: user("hello") },
      { id: 2, item: assistant("hi") },
    ]);
  });

  test("an acknowledged message is in the store if the agent is killed straight after", async () => {
    // A model that never answers, as if the process died mid-call.
    await serve({ next: () => new Promise(() => {}) });
    expect((await post("hello")).status).toBe(202);
    store.close();

    store = openStore(join(dir, "agent.db"));
    expect([...store.load(), ...store.inbox().map((m) => user(m.text, m.from))]).toEqual([user("hello")]);
    const model = new ScriptedModel([[assistant("hi")]]);
    const restarted = new Agent({ store, model, tools: [], instructions: "" });
    restarted.start();
    await restarted.idle();
    expect(model.calls[0]!.items).toEqual([user("hello")]);
  });
});

describe("a message during work is accepted", () => {
  test("a message while the agent waits on a model call gets 202, and reaches the model next", async () => {
    const held = heldModel([assistant("hi")]);
    const later = new ScriptedModel([[assistant("and again")]]);
    let calls = 0;
    await serve({ next: (...args) => (++calls === 1 ? held.model.next(...args) : later.next(...args)) });
    expect((await post("hello")).status).toBe(202);
    await held.started;
    expect((await post("again")).status).toBe(202);
    held.release();
    await vi.waitFor(() => expect(later.calls).toHaveLength(1));
    await agent.idle();
    expect(later.calls[0]!.items).toEqual([user("hello"), assistant("hi"), user("again")]);
  });
});

describe("every message carries its sender", () => {
  test("a message without Jen-From gets 400 and the inbox is unchanged", async () => {
    await serve({ next: () => new Promise(() => {}) });
    for (const headers of [auth, { ...auth, "Jen-From": "" }]) {
      const res = await fetch(`${base}/messages`, { method: "POST", headers, body: JSON.stringify({ text: "hello" }) });
      expect(res.status).toBe(400);
      expect(await res.json()).toHaveProperty("error");
    }
    expect(store.inbox()).toEqual([]);
    expect(store.load()).toEqual([]);
  });

  test("the sender is shown on the event stream once the message is delivered", async () => {
    await serve(new ScriptedModel([[assistant("hi")]]));
    const stream = await openEvents();
    await post("hello", { headers: { ...auth, "Jen-From": "a1b2c3d4e5f6" } });
    expect((await stream.items(1))[0]!.item).toEqual({ type: "message", role: "user", from: "a1b2c3d4e5f6", text: "hello" });
  });

  test("an urgent message is saved as urgent", async () => {
    await serve({ next: () => new Promise(() => {}) }, { wake: "w1" });
    await fetch(`${base}/messages`, { method: "POST", headers: sender, body: JSON.stringify({ text: "stop", urgent: true }) });
    await fetch(`${base}/messages`, { method: "POST", headers: sender, body: JSON.stringify({ text: "later" }) });
    // The first message ended the hold and was delivered; the second waits.
    expect(store.load()).toEqual([user("stop")]);
    expect(store.inbox()).toEqual([{ from: "owner", text: "later", urgent: false }]);
  });
});

describe("an invalid message is rejected", () => {
  // Held, so a message that's wrongly accepted stays visible in the inbox.
  const stalled = { next: () => new Promise<Item[]>(() => {}) };
  const unchanged = () => expect([store.inbox(), store.load()]).toEqual([[], []]);

  test("text that isn't a string gets 400 and changes nothing", async () => {
    await serve(stalled);
    const res = await fetch(`${base}/messages`, { method: "POST", headers: sender, body: JSON.stringify({ text: 5 }) });
    expect(res.status).toBe(400);
    expect(await res.json()).toHaveProperty("error");
    unchanged();
  });

  test("empty text is accepted as an empty reply", async () => {
    await serve(stalled);
    expect((await post("")).status).toBe(202);
    // It reaches no model: the agent has no turn under way, so it's dropped.
    expect(store.load()).toEqual([]);
  });

  test("a body that isn't JSON gets 400 and changes nothing", async () => {
    await serve(stalled);
    const res = await fetch(`${base}/messages`, { method: "POST", headers: sender, body: "hello" });
    expect(res.status).toBe(400);
    expect(await res.json()).toHaveProperty("error");
    unchanged();
  });

  test("an urgent that isn't a boolean gets 400 and changes nothing", async () => {
    await serve(stalled);
    const res = await fetch(`${base}/messages`, { method: "POST", headers: sender, body: JSON.stringify({ text: "stop", urgent: "yes" }) });
    expect(res.status).toBe(400);
    unchanged();
  });

  test("a body over 1 MiB gets 413, declared or chunked, and changes nothing", async () => {
    await serve(stalled);
    const declared = await fetch(`${base}/messages`, { method: "POST", headers: sender, body: JSON.stringify({ text: "x".repeat(MAX_MESSAGE) }) });
    expect(declared.status).toBe(413);
    expect(declared.headers.get("connection")).toBe("close");

    // A chunked body is answered once it crosses the bound, before it ends.
    const { port } = server!.address() as AddressInfo;
    const status = await new Promise<number | undefined>((resolve) => {
      const req = http.request({ host: "127.0.0.1", port, method: "POST", path: "/messages", headers: sender });
      let answered: number | undefined;
      req.on("error", () => {});
      req.on("response", (res) => ((answered = res.statusCode), res.resume()));
      req.on("close", () => resolve(answered));
      req.write(Buffer.alloc(MAX_MESSAGE + 1, 32));
    });
    expect(status).toBe(413);
    unchanged();
  });
});

describe("the event stream sends the conversation", () => {
  test("a new client gets every item of both turns in order, with positions as IDs", async () => {
    store.save([user("hello"), assistant("hi")]);
    store.save([user("how are you?"), assistant("fine")]);
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

  test("an empty conversation sends no items until a message is delivered", async () => {
    await serve(new ScriptedModel([[assistant("hi")]]));
    const stream = await openEvents();
    expect(await stream.next()).toEqual({ event: "synced", data: JSON.stringify({ seq: 0 }) });
    await post("hello");
    // The next event is the message's, so no item came before it.
    expect(await stream.next()).toEqual({ id: "1", event: "item", data: JSON.stringify(user("hello")) });
  });
});

describe("the event stream resumes after the last event seen", () => {
  test("Last-Event-ID: 2 on four items sends items 3 and 4 only", async () => {
    store.save([user("hello"), assistant("hi")]);
    store.save([user("how are you?"), assistant("fine")]);
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

describe("the event stream sends only saved items, each as it's saved", () => {
  test("a live turn: the tool call before the tool runs, its result once it finishes, then the answer", async () => {
    let release!: () => void;
    const running = new Promise<void>((resolve) => (release = resolve));
    let finish!: (output: string) => void;
    const lookup: Tool = {
      name: "lookup",
      description: "Look up a key.",
      inputSchema: { type: "object" },
      run: () => (release(), new Promise((resolve) => (finish = resolve))),
    };
    await serve(new ScriptedModel([[call("c1", "lookup")], [assistant("42")]]), { tools: [lookup] });
    const stream = await openEvents();
    await post("what is a?");
    expect(await stream.items(2)).toEqual([
      { id: 1, item: user("what is a?") },
      { id: 2, item: call("c1", "lookup") },
    ]);
    await running;
    finish("42");
    expect(await stream.items(2)).toEqual([
      { id: 3, item: result("c1", "42") },
      { id: 4, item: assistant("42") },
    ]);
  });

  test("two watchers each get every item once", async () => {
    await serve(new ScriptedModel([[assistant("hi")], [assistant("again")]]));
    const a = await openEvents();
    const b = await openEvents();
    await post("hello");
    await agent.idle();
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

  test("a failed turn keeps the items it already sent, and sends none for the failed call", async () => {
    const lookup: Tool = { name: "lookup", description: "", inputSchema: { type: "object" }, run: async () => "42" };
    const model = flaky([]);
    let calls = 0;
    const first = new ScriptedModel([[call("c1", "lookup")]]);
    await serve({ next: (...args) => (++calls === 1 ? first.next(...args) : model.next(...args)) }, { tools: [lookup], post: async () => "delivered" });
    const stream = await openEvents();
    await post("go");
    await agent.idle();
    expect(await stream.items(3)).toEqual([
      { id: 1, item: user("go") },
      { id: 2, item: call("c1", "lookup") },
      { id: 3, item: result("c1", "42") },
    ]);
    expect(store.load()).toHaveLength(3);
  });
});

describe("the event stream says when it has caught up", () => {
  const synced = (seq: number) => ({ event: "synced", data: JSON.stringify({ seq }) });
  const item = (seq: number, value: Item) => ({ id: String(seq), event: "item", data: JSON.stringify(value) });

  test("on history of four items: the four, then synced with seq 4", async () => {
    store.save([user("hello"), assistant("hi")]);
    store.save([user("how are you?"), assistant("fine")]);
    await serve(new ScriptedModel([]));
    const stream = await openEvents();
    const events = [await stream.next(), await stream.next(), await stream.next(), await stream.next(), await stream.next()];
    expect(events).toEqual([item(1, user("hello")), item(2, assistant("hi")), item(3, user("how are you?")), item(4, assistant("fine")), synced(4)]);
  });

  test("on an empty conversation: synced with seq 0 and no item", async () => {
    await serve(new ScriptedModel([]));
    expect(await (await openEvents()).next()).toEqual(synced(0));
  });

  test("an assistant message and a tool call saved together arrive before one synced", async () => {
    let finish!: (output: string) => void;
    const lookup: Tool = { name: "lookup", description: "", inputSchema: { type: "object" }, run: () => new Promise((resolve) => (finish = resolve)) };
    await serve(new ScriptedModel([[assistant("checking"), call("c1", "lookup")], [assistant("42")]]), { tools: [lookup] });
    const stream = await openEvents();
    expect(await stream.next()).toEqual(synced(0));
    await post("what is a?");
    expect(await stream.next()).toEqual(item(1, user("what is a?")));
    expect(await stream.next()).toEqual(synced(1));
    expect(await stream.next()).toEqual(item(2, assistant("checking")));
    expect(await stream.next()).toEqual(item(3, call("c1", "lookup")));
    expect(await stream.next()).toEqual(synced(3));
    await vi.waitFor(() => expect(finish).toBeDefined());
    finish("42");
    expect(await stream.next()).toEqual(item(4, result("c1", "42")));
    expect(await stream.next()).toEqual(synced(4));
    expect(await stream.next()).toEqual(item(5, assistant("42")));
    expect(await stream.next()).toEqual(synced(5));
  });

  test("resuming with Last-Event-ID: 2 on four items: items 3 and 4, then synced with seq 4", async () => {
    store.save([user("hello"), assistant("hi")]);
    store.save([user("how are you?"), assistant("fine")]);
    await serve(new ScriptedModel([]));
    const stream = await openEvents({ "Last-Event-ID": "2" });
    expect([await stream.next(), await stream.next(), await stream.next()]).toEqual([item(3, user("how are you?")), item(4, assistant("fine")), synced(4)]);
  });
});

describe("model failures are sent as error events", () => {
  test("each failed call sends an error event with its message and no id, and saves nothing", async () => {
    const model = flaky([[assistant("hi")]]);
    await serve(model, { delays: [0] });
    const stream = await openEvents();
    expect(await stream.next()).toEqual({ event: "synced", data: JSON.stringify({ seq: 0 }) });
    await post("hello");
    expect(await stream.next()).toEqual({ id: "1", event: "item", data: JSON.stringify(user("hello")) });
    expect(await stream.next()).toEqual({ event: "synced", data: JSON.stringify({ seq: 1 }) });
    expect(await stream.next()).toEqual({ event: "error", data: JSON.stringify({ message: "model unreachable" }) });
    expect(await stream.next()).toEqual({ event: "error", data: JSON.stringify({ message: "model unreachable" }) });
    await agent.idle();
    expect(store.load()).toEqual([user("hello")]);
  });
});

describe("a root agent that gave up tells every watcher", () => {
  const notice = "My model is failing, so I've stopped working. Error: model unreachable. Message me to try again.";

  test("an open stream gets the notice, and so does one that connects later, after the saved items", async () => {
    const model = flaky([[assistant("back")]]);
    await serve(model, { delays: [] });
    const open = await openEvents();
    await post("hello");
    await agent.idle();
    await open.items(1);
    expect(await open.next()).toEqual({ event: "synced", data: JSON.stringify({ seq: 1 }) });
    expect(await open.next()).toEqual({ event: "error", data: JSON.stringify({ message: "model unreachable" }) });
    expect(await open.next()).toEqual({ event: "error", data: JSON.stringify({ message: notice }) });

    const late = await openEvents();
    expect(await late.next()).toMatchObject({ id: "1", event: "item" });
    expect(await late.next()).toEqual({ event: "error", data: JSON.stringify({ message: notice }) });
    // The notice is part of what the stream had to send when it opened.
    expect(await late.next()).toEqual({ event: "synced", data: JSON.stringify({ seq: 1 }) });
  });

  test("after the agent recovers, a new stream gets no notice", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const model = flaky([[assistant("back")]]);
    await serve(model, { delays: [] });
    await post("hello");
    await agent.idle();
    expect(agent.notice).toBeDefined();
    model.fail = false;
    await post("try again");
    await agent.idle();

    const stream = await openEvents();
    expect((await stream.items(3)).map((e) => e.item)).toEqual([user("hello"), user("try again"), assistant("back")]);
    expect(await stream.next()).toEqual({ event: "synced", data: JSON.stringify({ seq: 3 }) });
    // Nothing else is waiting: the next event is the keepalive.
    vi.advanceTimersByTime(15_000);
    expect(await stream.next()).toEqual({ comment: "keepalive" });
  });
});

describe("a watcher that stops reading is sent no more than it can take", () => {
  test("its buffer stays bounded, others are served, and it gets everything once it reads", async () => {
    const big = (n: number) => `${n} ${"x".repeat(64 * 1024)}`;
    for (let n = 0; n < 64; n++) store.save([user(big(n)), assistant(big(n))]);
    await serve(new ScriptedModel(Array.from({ length: 16 }, (_, n) => [assistant(big(128 + 2 * n + 1))])));
    const streamsOpened: http.ServerResponse[] = [];
    server!.on("request", (req: http.IncomingMessage, res: http.ServerResponse) => req.url === "/events" && streamsOpened.push(res));

    // A watcher that reads nothing.
    const stalled = await new Promise<http.IncomingMessage>((resolve) => http.get(`${base}/events`, { headers: auth }, resolve));
    stalled.pause();
    for (let n = 0; n < 16; n++) {
      expect((await post(big(128 + 2 * n))).status).toBe(202);
      await agent.idle();
    }

    // Another watcher and the messages above were served all the same.
    expect(await (await openEvents({ "Last-Event-ID": "158" })).items(2)).toHaveLength(2);
    // One item and the socket's buffer at most; unbounded, this would be megabytes.
    expect(streamsOpened[0]!.writableLength).toBeLessThan(2 * 64 * 1024 + streamsOpened[0]!.writableHighWaterMark);

    const ids: number[] = [];
    let buffer = "";
    stalled.setEncoding("utf8");
    await new Promise<void>((resolve) => {
      stalled.on("data", (chunk: string) => {
        buffer += chunk;
        const lines = buffer.split("\n");
        buffer = lines.pop()!;
        for (const line of lines) if (line.startsWith("id: ")) ids.push(Number(line.slice(4)));
        if (ids.length >= 160) resolve();
      });
      stalled.resume();
    });
    expect(ids).toEqual(Array.from({ length: 160 }, (_, i) => i + 1));
    stalled.destroy();
  });
});

describe("a quiet event stream is kept alive", () => {
  test("an idle stream gets a comment line within 15 seconds", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    await serve(new ScriptedModel([]));
    const stream = await openEvents();
    expect(await stream.next()).toMatchObject({ event: "synced" });
    vi.advanceTimersByTime(15_000);
    expect(await stream.next()).toEqual({ comment: "keepalive" });
  });
});

describe("unknown routes are not found", () => {
  test("a request target of // gets 404, and the agent keeps serving", async () => {
    await serve(new ScriptedModel([[assistant("hi")]]));
    const { port } = server!.address() as AddressInfo;
    const raw = await new Promise<string>((resolve, reject) => {
      const socket = connect(port, "127.0.0.1", () => {
        socket.end(`GET // HTTP/1.1\r\nHost: agent\r\nAuthorization: Bearer ${token}\r\nConnection: close\r\n\r\n`);
      });
      let data = "";
      socket.setEncoding("utf8").on("data", (chunk) => (data += chunk)).on("end", () => resolve(data)).on("error", reject);
    });
    expect(raw).toMatch(/^HTTP\/1\.1 404 /);
    expect((await post("hello")).status).toBe(202);
  });

  test("GET /status with the token gets 404", async () => {
    await serve(new ScriptedModel([]));
    const res = await fetch(`${base}/status`, { headers: auth });
    expect(res.status).toBe(404);
    expect(await res.json()).toHaveProperty("error");
  });
});

describe("the agent serves its page and its UI", () => {
  test.each(["/page", "/ui"])("%s needs the token", async (path) => {
    await serve(new ScriptedModel([]));
    const answer = await fetch(`${base}${path}`);
    expect(answer.status).toBe(401);
    expect(answer.headers.get("www-authenticate")).toBe("Bearer");
    expect((await fetch(`${base}${path}`, { headers: { Authorization: "Bearer wrong" } })).status).toBe(401);
  });

  test("/ui gives version 0 and the textbox before a publish, and the latest after", async () => {
    await serve(new ScriptedModel([]));
    const before = await fetch(`${base}/ui`, { headers: auth });
    expect(before.status).toBe(200);
    expect(before.headers.get("content-type")).toBe("application/json");
    expect(await before.json()).toEqual({ version: 0, document: TEXTBOX });
    store.publish("<p>one</p>");
    store.publish("<p>two</p>");
    expect(await (await fetch(`${base}/ui`, { headers: auth })).json()).toEqual({ version: 2, document: "<p>two</p>" });
  });

  test("/page is jen's fixed page, with its policy and no caching", async () => {
    await serve(new ScriptedModel([]));
    const answer = await fetch(`${base}/page`, { headers: auth });
    expect(answer.status).toBe(200);
    expect(answer.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(answer.headers.get("cache-control")).toBe("no-store");
    const policy = answer.headers.get("content-security-policy");
    expect(policy).toBe(PAGE_POLICY);
    for (const directive of ["default-src 'none'", "connect-src 'self'", "frame-src 'none'", "frame-ancestors 'none'"]) expect(policy).toContain(directive);
    expect(await answer.text()).toBe(PAGE);
  });
});
