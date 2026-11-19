import { afterEach, expect, test } from "vitest";
import { Api, ApiError, parseEvents, Unanswered, type StreamEvent } from "./api.ts";
import { FakeRuntime } from "./fake-runtime.ts";

let runtime: FakeRuntime;
let api: Api;
async function serve() {
  runtime = new FakeRuntime();
  api = new Api(`http://127.0.0.1:${await runtime.listen()}`, runtime.token);
}
afterEach(() => runtime?.close());

const user = (text: string) => ({ type: "message" as const, role: "user" as const, from: "owner", text });
const assistant = (text: string) => ({ type: "message" as const, role: "assistant" as const, text });

test("spawns a named root, lists, gets, stops and starts it as the owner", async () => {
  await serve();
  const root = await api.spawn("home", { spawn: true, workspace: true });
  expect(root).toMatchObject({ parent: null, name: "home", grant: { spawn: true, workspace: true }, state: "running" });
  expect(await api.list()).toEqual([root]);
  expect((await api.stop(root.id)).state).toBe("stopped");
  expect((await api.get(root.id)).state).toBe("stopped");
  expect((await api.start(root.id)).state).toBe("running");
  expect(runtime.requests).toEqual(["POST /agents", "GET /agents", `POST /agents/${root.id}/stop`, `GET /agents/${root.id}`, `POST /agents/${root.id}/start`]);
});

test("the runtime's refusal is shown as it words it, with its status", async () => {
  await serve();
  await api.spawn("home", {});
  const error = await api.spawn("home", {}).catch((e) => e);
  expect(error).toBeInstanceOf(ApiError);
  expect(error).toMatchObject({ status: 409, message: "a root agent is already named home" });
});

test("a wrong token is refused", async () => {
  await serve();
  await expect(new Api(api.base, "wrong").list()).rejects.toMatchObject({ status: 401 });
});

test("a runtime that isn't there is unanswered", async () => {
  await expect(new Api("http://127.0.0.1:1", "t").list()).rejects.toBeInstanceOf(Unanswered);
});

test("posts a message", async () => {
  await serve();
  const root = runtime.add({ name: "home" });
  await api.post(root.id, "hello there");
  expect(runtime.messages).toEqual([{ id: root.id, text: "hello there" }]);
});

test("opens the event stream, resuming after Last-Event-ID", async () => {
  await serve();
  const root = runtime.add({ name: "home" });
  runtime.save(root.id, [user("a"), assistant("b")]);
  const read = async (lastEventId?: number) => {
    const out: StreamEvent[] = [];
    for await (const event of await api.events(root.id, { lastEventId })) {
      out.push(event);
      if (event.type === "synced") break;
    }
    return out;
  };
  expect(await read()).toEqual([
    { type: "item", seq: 1, item: user("a") },
    { type: "item", seq: 2, item: assistant("b") },
    { type: "synced", seq: 2 },
  ]);
  expect(await read(1)).toEqual([{ type: "item", seq: 2, item: assistant("b") }, { type: "synced", seq: 2 }]);
  expect(runtime.opened).toEqual([undefined, "1"]);
});

test("a stopped agent's stream is refused with 409", async () => {
  await serve();
  const root = runtime.add({ name: "home", state: "stopped" });
  await expect(api.events(root.id)).rejects.toMatchObject({ status: 409 });
});

test("events are parsed across chunks, with comments, errors and unknown types, and a cut-off event is dropped", async () => {
  const chunks = [": keepalive\n\nid: 1\nevent: it", 'em\ndata: {"type":"message","role":"assistant","text":"hi"}\n\n', 'event: error\ndata: {"message":"boom"}\n\n', "event: new\ndata: {}\n\n", "id: 2\nevent: item\ndata: {"];
  const body = new ReadableStream<Uint8Array<ArrayBuffer>>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
      controller.close();
    },
  });
  const out: StreamEvent[] = [];
  for await (const event of parseEvents(body)) out.push(event);
  expect(out).toEqual([{ type: "item", seq: 1, item: assistant("hi") }, { type: "error", message: "boom" }, { type: "other", event: "new" }]);
});
