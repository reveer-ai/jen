import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, test } from "vitest";
import type { Item } from "../../src/agent/model/port.ts";
import { faults, measure, runTask, RuntimeApi, sumUsage, type Event, type Observed } from "./run.ts";
import { promptTask, TASKS } from "./tasks.ts";

// A recorded run: the root replies once, and a1, a sub-agent, replies to it.
const ids = ["root", "a1"];
let t = 0;
const item = (agent: string, item: Item): Event => ({ t: (t += 100), agent, kind: "item", item });
const user = (agent: string, from: string, text: string) => item(agent, { type: "message", role: "user", from, text });
const say = (agent: string, text: string) => item(agent, { type: "message", role: "assistant", text });
const callTool = (agent: string, id: string, name: string, input: any = {}) => item(agent, { type: "tool_call", id, name, input });
const result = (agent: string, callId: string, output: string) => item(agent, { type: "tool_result", callId, output });
const clean = (): Event[] => [
  user("root", "owner", "Spawn a sub-agent to write a haiku about herons, then send me its haiku."),
  callTool("root", "c1", "spawn_agent", { grant: { spawn: false } }),
  result("root", "c1", '{"id":"a1"}'),
  callTool("root", "c2", "message_sub_agent", { to: "a1", text: "Write a haiku about herons." }),
  result("root", "c2", "sent"),
  user("a1", "root", "Write a haiku about herons."),
  say("a1", "Grey heron waits / still water holds the morning / a flash, then the fish"),
  user("root", "a1", "Grey heron waits / still water holds the morning / a flash, then the fish"),
  say("root", "Here it is: Grey heron waits / still water holds the morning / a flash, then the fish"),
];
const observe = (events: Event[], changes: Partial<Observed> = {}): Observed => ({ task: { replies: 1 }, events, ids, limitMs: 360_000, checked: [], ...changes });
const kinds = (o: Observed) => faults(o).map((f) => f.kind);

describe("the fault rules", () => {
  test("a clean run has no faults", () => {
    expect(faults(observe(clean()))).toEqual([]);
  });

  test("settle: a run that never goes quiet", () => {
    expect(faults(observe(clean(), { unsettledAt: 1 }))).toEqual([{ kind: "settle", detail: "didn't settle within 6 minutes, at step 1" }]);
  });

  test("replies: the wrong number of owner replies", () => {
    expect(faults(observe(clean(), { task: { replies: 2 } }))).toEqual([{ kind: "replies", detail: "the owner got 1 replies, not 2" }]);
    expect(kinds(observe(clean().slice(0, -1)))).toEqual(["replies"]);
  });

  test("list_agents: any such call", () => {
    expect(faults(observe([...clean().slice(0, -1), callTool("root", "c9", "list_agents"), result("root", "c9", "[]"), clean().at(-1)!]))).toEqual([
      { kind: "list_agents", detail: "1 list_agents calls" },
    ]);
  });

  test("tool_error: a refused or failed call", () => {
    const events = clean();
    events.splice(2, 1, result("root", "c1", "Error: the runtime already holds 10 agents"));
    expect(faults(observe(events))).toEqual([{ kind: "tool_error", detail: "1 refused or failed tool calls" }]);
  });

  test("checking before creating: a read_file of a missing file isn't a fault", () => {
    const events = [
      ...clean().slice(0, -1),
      callTool("root", "r1", "read_file", { path: "notes.md" }),
      result("root", "r1", "Error: there's no file at notes.md."),
      callTool("root", "w1", "write_file", { path: "notes.md", content: "x" }),
      result("root", "w1", "Wrote 1 byte."),
      clean().at(-1)!,
    ];
    expect(faults(observe(events))).toEqual([]);
    // The same error from another tool is a fault.
    const edit = events.map((e) => (e.kind === "item" && e.item.type === "tool_call" && e.item.id === "r1" ? { ...e, item: { ...e.item, name: "edit_file" } } : e));
    expect(kinds(observe(edit))).toEqual(["tool_error"]);
  });

  test("an edit that doesn't match is a fault, even if a later call succeeds", () => {
    const events = [
      ...clean().slice(0, -1),
      callTool("root", "e1", "edit_file", { path: "settings.conf", old_string: "cache_ttl=300", new_string: "cache_ttl=900" }),
      result("root", "e1", "Error: old_string isn't in settings.conf."),
      callTool("root", "e2", "edit_file", { path: "settings.conf", old_string: "cache_ttl = 300", new_string: "cache_ttl = 900" }),
      result("root", "e2", "Edited settings.conf."),
      clean().at(-1)!,
    ];
    expect(faults(observe(events))).toEqual([{ kind: "tool_error", detail: "1 refused or failed tool calls" }]);
  });

  test("repeat_message: the same text sent twice to one receiver", () => {
    const events = clean();
    events.splice(5, 0, callTool("root", "c3", "message_sub_agent", { to: "a1", text: "Write a haiku about herons." }), result("root", "c3", "sent"));
    expect(faults(observe(events))).toEqual([{ kind: "repeat_message", detail: "1 messages sent twice" }]);
    // The same text to another receiver isn't a repeat.
    events.splice(5, 2, callTool("root", "c3", "message_sub_agent", { to: "a2", text: "Write a haiku about herons." }), result("root", "c3", "sent"));
    expect(faults(observe(events))).toEqual([]);
  });

  test("filler_reply: a sub-agent reply of 1 to 9 characters", () => {
    const events = clean();
    events.splice(6, 1, say("a1", "Done."));
    expect(faults(observe(events))).toEqual([{ kind: "filler_reply", detail: 'filler replies: "Done."' }]);
    // A root's short reply to the owner isn't filler.
    events.splice(6, 1, say("a1", "A haiku of some length"));
    events.splice(-1, 1, say("root", "Canberra."));
    expect(faults(observe(events))).toEqual([]);
  });

  test("model_error: a model error event", () => {
    const events: Event[] = [...clean(), { t: 1, agent: "a1", kind: "error", item: { message: "429 slow down" } }];
    expect(faults(observe(events))).toEqual([{ kind: "model_error", detail: "1 model error events" }]);
  });

  test("publish_ui: an unasked-for UI", () => {
    const events = [...clean().slice(0, -1), callTool("root", "u1", "publish_ui"), result("root", "u1", "Published version 1."), clean().at(-1)!];
    expect(faults(observe(events))).toEqual([{ kind: "publish_ui", detail: "1 publish_ui calls" }]);
  });

  test("check: the task's own check", () => {
    expect(faults(observe(clean(), { checked: ['the reply lacks "KEY: 1"', "the command ran 2 times"] }))).toEqual([
      { kind: "check", detail: 'the reply lacks "KEY: 1"' },
      { kind: "check", detail: "the command ran 2 times" },
    ]);
  });

  test("a run shows a fault of each kind it has", () => {
    const events: Event[] = [...clean().slice(0, -1), callTool("root", "c9", "list_agents"), result("root", "c9", "Error: no"), clean().at(-1)!, { t: 1, agent: "root", kind: "error", item: { message: "x" } }];
    expect(kinds(observe(events, { unsettledAt: 1, checked: ["wrong"] }))).toEqual(["settle", "list_agents", "tool_error", "model_error", "check"]);
  });
});

describe("a prompt run", () => {
  const prompt = promptTask("Tell me two things.");
  test("passes with two replies and no other fault", () => {
    const events = [...clean(), user("root", "a1", "more"), say("root", "And another thing, at some length.")];
    expect(faults(observe(events, { task: prompt }))).toEqual([]);
  });
  test("fails with replies when there's none", () => {
    expect(faults(observe(clean().slice(0, -1), { task: prompt }))).toEqual([{ kind: "replies", detail: "the owner got 0 replies, not one or more" }]);
  });
});

describe("a run's metrics", () => {
  test("time from the first message to the last event, its agents and its tool calls by name", () => {
    const events = clean();
    const first = events[0]!.t;
    expect(measure(events, ids, first)).toEqual({ durationMs: events.at(-1)!.t - first, agents: 2, tools: { spawn_agent: 1, message_sub_agent: 1 } });
  });

  test("usage summed over the root's entries, deleted agents included, and none without a usage route", () => {
    const entry = (id: string, root: string, n: number, cost?: number) => ({ id, root, calls: n, inputTokens: 10 * n, cachedTokens: n, outputTokens: 2 * n, reasoningTokens: n, ...(cost === undefined ? {} : { cost }) });
    expect(sumUsage([entry("r", "r", 1), entry("c", "r", 2), entry("x", "x", 5)], "r")).toEqual({ calls: 3, inputTokens: 30, cachedTokens: 3, outputTokens: 6, reasoningTokens: 3 });
    expect(sumUsage([entry("r", "r", 1, 0.01), entry("c", "r", 1, 0.02)], "r")!.cost).toBeCloseTo(0.03);
    expect(sumUsage([], "r")).toEqual({ calls: 0, inputTokens: 0, cachedTokens: 0, outputTokens: 0, reasoningTokens: 0 });
    expect(sumUsage(null, "r")).toBeNull();
  });
});

describe("running a task against a runtime", () => {
  const servers: http.Server[] = [];
  afterEach(() => servers.splice(0).forEach((s) => (s.closeAllConnections(), s.close())));
  async function stub(handle: (req: http.IncomingMessage, res: http.ServerResponse) => void) {
    const server = http.createServer(handle);
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    return new RuntimeApi(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, "owner");
  }
  const direct = TASKS.find((t) => t.name === "direct")!;

  test("a spawn the runtime refuses errors the run with the runtime's error", async () => {
    const api = await stub((req, res) => res.writeHead(403, { "content-type": "application/json" }).end('{"error":"the runtime already holds 10 agents"}'));
    const run = await runTask({ api, runtime: "jen-eval-x-a", task: direct, name: "run-1", signal: new AbortController().signal });
    expect(run).toMatchObject({ task: "direct", outcome: "errored", error: 'POST /agents answered 403: {"error":"the runtime already holds 10 agents"}', faults: [] });
  });

  test("a run against a runtime with no usage route has no tokens, and isn't errored for it", async () => {
    let messaged = false;
    const api = await stub((req, res) => {
      if (req.method === "POST" && req.url === "/agents") return res.writeHead(201).end('{"id":"r1"}');
      if (req.method === "POST" && req.url === "/agents/r1/messages") return ((messaged = true), res.writeHead(202).end());
      if (req.method === "GET" && req.url === "/agents") return res.writeHead(200).end('[{"id":"r1","parent":null,"state":"running"}]');
      if (req.url === "/agents/r1/events") {
        res.writeHead(200, { "content-type": "text/event-stream" });
        const send = (seq: number, item: Item) => res.write(`id: ${seq}\nevent: item\ndata: ${JSON.stringify(item)}\n\n`);
        send(1, { type: "message", role: "user", from: "owner", text: "What's the capital of Australia?" });
        send(2, { type: "message", role: "assistant", text: "Canberra." });
        return;
      }
      if (req.method === "DELETE" && req.url === "/agents/r1") return res.writeHead(204).end();
      res.writeHead(404).end('{"error":"no route"}');
    });
    const run = await runTask({ api, runtime: "jen-eval-x-a", task: direct, name: "run-1", signal: new AbortController().signal, quietMs: 100 });
    expect(messaged).toBe(true);
    expect(run).toMatchObject({ outcome: "passed", faults: [], agents: [{ id: "r1", parent: "owner" }], metrics: { agents: 1, usage: null, tools: {} } });
    expect(run.events.map((e) => e.kind === "item" && e.item.type === "message" && e.item.text)).toEqual(["What's the capital of Australia?", "Canberra."]);
  });
});
