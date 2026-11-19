import { afterEach, expect, test } from "vitest";
import type { Item } from "../agent/model/port.ts";
import { Api } from "./api.ts";
import { FakeRuntime } from "./fake-runtime.ts";
import { cut, follow, summary, type FollowOptions } from "./follow.ts";

const owner = (text: string): Item => ({ type: "message", role: "user", from: "owner", text });
const from = (sender: string, text: string): Item => ({ type: "message", role: "user", from: sender, text });
const assistant = (text: string): Item => ({ type: "message", role: "assistant", text });
const call = (id: string, name: string, input: any = {}): Item => ({ type: "tool_call", id, name, input });
const result = (callId: string, output: string): Item => ({ type: "tool_result", callId, output });

let runtime: FakeRuntime;
afterEach(() => runtime?.close());

// A root named home, and a follow of query to it, with everything it wrote in
// order. turn is what the root does once the query arrives.
async function setup(query: string, turn: (id: string) => void | Promise<void>, { state = "running" as "running" | "stopped", history = [] as Item[][] } = {}) {
  runtime = new FakeRuntime();
  const port = await runtime.listen();
  const root = runtime.add({ name: "home", state });
  for (const step of history) runtime.save(root.id, step);
  runtime.onMessage = (id, text) => {
    runtime.save(id, [owner(text)]);
    setTimeout(() => void turn(id), 5);
  };
  const log: string[] = [];
  const interrupt = new AbortController();
  const options: FollowOptions = {
    api: new Api(`http://127.0.0.1:${port}`, runtime.token),
    root: { ...root, name: "home" },
    query,
    say: (line) => log.push(`err ${line}`),
    write: (text) => log.push(`out ${text}`),
    columns: 40,
    interrupt: interrupt.signal,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, Math.min(ms, 20))),
    now: Date.now,
  };
  return { root, log, options, interrupt, port, run: () => follow(options) };
}

test("the reply is written to stdout, and it exits 0", async () => {
  const { root, log, run } = await setup("Reply with just the word heron.", (id) => runtime.save(id, [assistant("heron")]));
  expect(await run()).toBe(0);
  expect(log).toEqual(["out heron\n"]);
  expect(runtime.messages).toEqual([{ id: root.id, text: "Reply with just the word heron." }]);
});

test("a tool call's line is on stderr before the reply", async () => {
  const { log, run } = await setup("list files", (id) => {
    runtime.save(id, [call("c1", "run_command", { command: "ls -la", timeout: 30 })]);
    runtime.save(id, [result("c1", "a b")]);
    runtime.save(id, [assistant("a and b")]);
  });
  expect(await run()).toBe(0);
  expect(log).toEqual(["err → run_command ls -la 30", "out a and b\n"]);
});

test("a stopped root is started, and its reply still arrives", async () => {
  const { root, log, run } = await setup("hi", (id) => runtime.save(id, [assistant("hello")]), { state: "stopped" });
  expect(await run()).toBe(0);
  expect(runtime.requests[0]).toBe(`POST /agents/${root.id}/start`);
  expect(log).toEqual(["out hello\n"]);
});

test("nothing from history is written, even a query with the same text", async () => {
  const { log, run } = await setup("again", (id) => runtime.save(id, [assistant("second")]), {
    history: [[owner("again")], [call("c0", "run_command", { command: "old" })], [result("c0", "x")], [assistant("first")]],
  });
  expect(await run()).toBe(0);
  expect(log).toEqual(["out second\n"]);
});

test("text before a tool call isn't the reply; a later response with only text is", async () => {
  const { log, run } = await setup("check", (id) => {
    runtime.save(id, [assistant("Let me check."), call("c1", "read_file", { path: "notes.md" })]);
    runtime.save(id, [result("c1", "x")]);
    runtime.save(id, [assistant("It says x.")]);
  });
  expect(await run()).toBe(0);
  expect(log).toEqual(["err → read_file notes.md", "out It says x.\n"]);
});

test("a response is read only once its step has fully arrived, even across a cut stream", async () => {
  let rootId = "";
  const { log, run } = await setup("check", (id) => {
    rootId = id;
    // The text arrives, the stream is cut before its tool call, and the call
    // arrives on the resumed stream.
    runtime.save(id, [assistant("Let me check."), call("c1", "run_command", { command: "date" })], { partly: 1 });
    runtime.cut(id);
    setTimeout(() => {
      runtime.save(id, [result("c1", "today")]);
      runtime.save(id, [assistant("Today.")]);
    }, 50);
  });
  expect(await run()).toBe(0);
  expect(log).toEqual(["err → run_command date", "out Today.\n"]);
  expect(runtime.opened).toEqual([undefined, "2"]);
  expect(rootId).not.toBe("");
});

test("a sub-agent's message and an error event each get a line, cut to the terminal's width", async () => {
  const { log, run } = await setup("delegate", (id) => {
    runtime.save(id, [call("c1", "spawn_agent", { grant: { spawn: false } })]);
    runtime.save(id, [result("c1", "3fa2b1c0d9e8")]);
    runtime.error(id, "the model provider could not be reached");
    runtime.save(id, [from("3fa2b1c0d9e8", "Here is what I found\nover several lines of text")]);
    runtime.save(id, [assistant("Done.")]);
  });
  expect(await run()).toBe(0);
  expect(log).toEqual([
    'err → spawn_agent {"grant":{"spawn":false}}',
    "err ! the model provider could not be reach…",
    "err ← 3fa2b1c0d9e8: Here is what I found ov…",
    "out Done.\n",
  ]);
  for (const line of log) expect([...line.slice(4)].length).toBeLessThanOrEqual(40);
});

test("a stream cut mid-turn resumes after the last item, repeating no line", async () => {
  const { log, run } = await setup("work", (id) => {
    runtime.save(id, [call("c1", "run_command", { command: "make" })]);
    runtime.cut(id);
    setTimeout(() => {
      runtime.save(id, [result("c1", "ok")]);
      runtime.save(id, [assistant("Built.")]);
    }, 50);
  });
  expect(await run()).toBe(0);
  expect(log).toEqual(["err → run_command make", "out Built.\n"]);
  expect(runtime.opened).toEqual([undefined, "2"]);
});

test("a runtime that's unreachable for a while is waited for, and the query carries on", async () => {
  let resolveDown!: () => void;
  const down = new Promise<void>((resolve) => (resolveDown = resolve));
  const { log, run, port } = await setup("work", async (id) => {
    runtime.save(id, [call("c1", "run_command", { command: "make" })]);
    await runtime.close();
    resolveDown();
  });
  const done = run();
  await down;
  await new Promise((resolve) => setTimeout(resolve, 200));
  const root = [...runtime.agents.keys()][0]!;
  runtime.save(root, [result("c1", "ok")]);
  runtime.save(root, [assistant("Built.")]);
  await runtime.listen(port);
  expect(await done).toBe(0);
  expect(log).toEqual(["err → run_command make", "out Built.\n"]);
});

test("a root that stops before replying exits 1 saying so", async () => {
  const { log, run } = await setup("work", (id) => {
    runtime.save(id, [call("c1", "run_command", { command: "make" })]);
    runtime.agents.get(id)!.state = "stopped";
    runtime.cut(id);
  });
  expect(await run()).toBe(1);
  expect(log).toEqual(["err → run_command make", "err @home stopped before it replied. Its conversation is kept: send it another query to start it again."]);
});

test("Ctrl-C exits 130 saying the root is still working, and neither stops nor messages it", async () => {
  const { log, run, interrupt } = await setup("work", (id) => runtime.save(id, [call("c1", "run_command", { command: "sleep 100" })]));
  const done = run();
  await new Promise((resolve) => setTimeout(resolve, 100));
  interrupt.abort();
  expect(await done).toBe(130);
  expect(log.at(-1)).toBe("err @home is still working. To see it, run: jen @home open");
  expect(runtime.requests.filter((r) => r.startsWith("POST"))).toHaveLength(1);
  expect(runtime.messages).toHaveLength(1);
});

test("a root that gives up on its model ends the wait with its notice, whole, and exits 1", async () => {
  const notice = "My model is failing, so I've stopped working. Error: 401 Incorrect API key provided. Message me to try again.";
  const { log, run } = await setup("hello", (id) => {
    runtime.error(id, "401 Incorrect API key provided");
    runtime.error(id, notice, { gaveUp: true });
  });
  expect(await run()).toBe(1);
  expect(log).toEqual(["err ! 401 Incorrect API key provided", `err ! ${notice}`]);
});

test("a notice that the root gave up before the query is history, and the reply to the query still arrives", async () => {
  const { root, log, options } = await setup("try again", (id) => runtime.save(id, [assistant("Working now.")]), { history: [[owner("hello")]] });
  runtime.gaveUp.set(root.id, "My model is failing, so I've stopped working. Error: timeout. Message me to try again.");
  runtime.onMessage = (id, text) => {
    runtime.gaveUp.delete(id);
    runtime.save(id, [owner(text)]);
    setTimeout(() => runtime.save(id, [assistant("Working now.")]), 5);
  };
  expect(await follow(options)).toBe(0);
  expect(log).toEqual(["out Working now.\n"]);
});

test("Ctrl-C before the query is sent says nothing was sent, and neither starts nor messages the root", async () => {
  const { log, run, interrupt } = await setup("work", () => {}, { state: "stopped" });
  interrupt.abort();
  expect(await run()).toBe(130);
  expect(log).toEqual(["err Nothing was sent to @home."]);
  expect(runtime.requests).toEqual([]);
});

test("Ctrl-C while the stream won't open says nothing was sent", async () => {
  const { log, run, interrupt } = await setup("work", () => {});
  runtime.intercept = (method, path) => (method === "GET" && path.endsWith("/events") ? 503 : undefined);
  const done = run();
  await new Promise((resolve) => setTimeout(resolve, 100));
  interrupt.abort();
  expect(await done).toBe(130);
  expect(log).toEqual(["err Nothing was sent to @home."]);
  expect(runtime.messages).toEqual([]);
});

test("a tool call's input is summarized by its values", () => {
  expect(summary({ command: "ls", timeout: 5 })).toBe("ls 5");
  expect(summary({})).toBe("");
  expect(summary({ grant: { spawn: true } })).toBe('{"grant":{"spawn":true}}');
  expect(cut("a\n  b", 10)).toBe("a b");
  expect(cut("abcdef", 4)).toBe("abc…");
});
