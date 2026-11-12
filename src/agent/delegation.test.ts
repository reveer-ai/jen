import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { DELIVERED, delegationTools, instructions, readIdentity, RuntimeClient, toolsFor, type Identity } from "./delegation.ts";
import { Agent, INTERRUPTED } from "./loop.ts";
import type { Item, Json } from "./model/port.ts";
import { ScriptedModel } from "./model/scripted.ts";
import { openStore, type Store } from "./store.ts";

const env = { JEN_AGENT_ID: "a1b2c3d4e5f6", JEN_PARENT: "owner", JEN_GRANT: '{"spawn":true}' };

describe("the agent knows who it is", () => {
  test("reads its ID, parent, grant and wake ID", () => {
    expect(readIdentity({ ...env, JEN_WAKE: "w1" })).toEqual({ id: "a1b2c3d4e5f6", parent: "owner", grant: { spawn: true, workspace: false }, wake: "w1" });
    expect(readIdentity(env).wake).toBeUndefined();
  });

  test("reads a grant with both capabilities", () => {
    expect(readIdentity({ ...env, JEN_GRANT: '{"spawn":false,"workspace":true}' }).grant).toEqual({ spawn: false, workspace: true });
  });

  // The entrypoint, run as the container runs it, with everything else it needs.
  function main(overrides: Record<string, string | undefined>) {
    const vars: Record<string, string | undefined> = { ...process.env, JEN_MODEL: "m", JEN_API_KEY: "k", JEN_TOKEN: "t", ...env, ...overrides };
    for (const [name, value] of Object.entries(vars)) if (value === undefined) delete vars[name];
    return spawnSync(process.execPath, [join(import.meta.dirname, "main.ts")], { env: vars as NodeJS.ProcessEnv, encoding: "utf8", timeout: 10_000 });
  }

  test.each([
    ["JEN_AGENT_ID", { JEN_AGENT_ID: undefined }],
    ["JEN_PARENT", { JEN_PARENT: undefined }],
    ["JEN_PARENT", { JEN_PARENT: "" }],
    ["JEN_GRANT", { JEN_GRANT: undefined }],
    ["JEN_GRANT", { JEN_GRANT: "spawn" }],
    ["JEN_GRANT", { JEN_GRANT: '{"spawn":"yes"}' }],
    ["JEN_GRANT", { JEN_GRANT: '{"spawn":true,"docker":true}' }],
    ["JEN_GRANT", { JEN_GRANT: '{"spawn":false,"x":true}' }],
    ["JEN_GRANT", { JEN_GRANT: '{"spawn":false,"workspace":"yes"}' }],
    ["JEN_WAKE", { JEN_WAKE: "" }],
  ])("exits non-zero naming %s when it's missing or malformed", (name, overrides) => {
    const run = main(overrides);
    expect(run.status).not.toBe(0);
    expect(run.status).not.toBeNull();
    expect(run.stderr).toContain(name);
  });
});

// A runtime that records each request and answers from answer, except that
// it answers a lookup of one agent from lookup. By default every agent looked
// up is the root's sub-agent.
let runtime: http.Server;
let requests: { method: string; path: string; auth?: string; body: unknown }[];
let answer: (method: string, path: string) => { status: number; body?: unknown };
let lookup: (id: string) => { status: number; body?: unknown };
let client: RuntimeClient;
const subAgentOf = (parent: string) => (id: string) => ({ status: 200, body: { id, parent, grant: { spawn: false }, state: "running" } });
beforeEach(async () => {
  requests = [];
  answer = () => ({ status: 202 });
  lookup = subAgentOf("a1b2c3d4e5f6");
  runtime = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      requests.push({ method: req.method!, path: req.url!, auth: req.headers.authorization, body: body === "" ? undefined : JSON.parse(body) });
      const one = req.method === "GET" ? req.url!.match(/^\/agents\/([^/]+)$/) : null;
      const { status, body: reply } = one ? lookup(decodeURIComponent(one[1]!)) : answer(req.method!, req.url!);
      res.writeHead(status, reply === undefined ? {} : { "Content-Type": "application/json" }).end(reply === undefined ? undefined : JSON.stringify(reply));
    });
  });
  await new Promise<void>((resolve) => runtime.listen(0, "127.0.0.1", resolve));
  client = new RuntimeClient(`http://127.0.0.1:${(runtime.address() as AddressInfo).port}`, "agent-token");
});
afterEach(async () => {
  runtime.closeAllConnections();
  await new Promise((resolve) => runtime.close(resolve));
});

const child: Identity = { id: "c0c0c0c0c0c0", parent: "a1b2c3d4e5f6", grant: { spawn: false, workspace: false } };
const lead: Identity = { id: "e0e0e0e0e0e0", parent: "a1b2c3d4e5f6", grant: { spawn: true, workspace: false } };
const root: Identity = { id: "a1b2c3d4e5f6", parent: "owner", grant: { spawn: true, workspace: false } };
const signal = new AbortController().signal;

// A record of debts kept in memory, as the store keeps them.
function ledger() {
  const owed = new Set<string>();
  return { owed, owe: (id: string) => !owed.has(id) && Boolean(owed.add(id)), clear: (id: string) => void owed.delete(id) };
}
let debts: ReturnType<typeof ledger>;
beforeEach(() => (debts = ledger()));

function toolOf(identity: Identity, name: string) {
  const found = delegationTools(identity, client, debts).find((t) => t.name === name);
  if (!found) throw new Error(`no tool ${name}`);
  return found;
}

describe("an agent messages only its own sub-agents", () => {
  test("a task is posted with the agent's own token, and is delivered", async () => {
    const output = await toolOf(root, "message_sub_agent").run({ to: "d1d1d1d1d1d1", text: "write a haiku" }, signal);
    expect(output).toBe(DELIVERED);
    expect(output).toBe("delivered. The reply will come to you. Call wait when you have nothing else to do.");
    expect(requests).toEqual([
      { method: "GET", path: "/agents/d1d1d1d1d1d1", auth: "Bearer agent-token", body: undefined },
      { method: "POST", path: "/agents/d1d1d1d1d1d1/messages", auth: "Bearer agent-token", body: { text: "write a haiku" } },
    ]);
  });

  test("an urgent send posts urgent in its body", async () => {
    await toolOf(root, "message_sub_agent").run({ to: "d1d1d1d1d1d1", text: "stop", urgent: true }, signal);
    expect(requests.at(-1)!.body).toEqual({ text: "stop", urgent: true });
  });

  test("a send with a missing receiver or text is refused before any request", async () => {
    const send = toolOf(root, "message_sub_agent");
    await expect(send.run({ text: "hi" }, signal)).rejects.toThrow(/to/);
    await expect(send.run({ to: "d1d1d1d1d1d1", text: "" }, signal)).rejects.toThrow(/text/);
    await expect(send.run({ to: "d1d1d1d1d1d1", text: "hi", urgent: "yes" }, signal)).rejects.toThrow(/urgent/);
    expect(requests).toEqual([]);
  });

  test("its description doesn't mention the parent", () => {
    expect(toolOf(root, "message_sub_agent").description).not.toMatch(/parent|owner|user/i);
  });
});

describe("a send to anyone but a sub-agent fails", () => {
  const hint = (to: string) => `you have no sub-agent ${to}. To answer your parent, end your turn with your reply.`;

  const posts = () => requests.filter((r) => r.method === "POST");

  test.each([
    [lead, "a1b2c3d4e5f6"],
    [root, "owner"],
    [root, "[user]"],
  ])("a send to %j, which the runtime doesn't show the agent, posts nothing", async (identity, to) => {
    lookup = (id) => ({ status: 404, body: { error: `no agent ${id}` } });
    await expect(toolOf(identity, "message_sub_agent").run({ to, text: "here's the result" }, signal)).rejects.toThrow(hint(to));
    expect(posts()).toEqual([]);
    expect(debts.owed.size).toBe(0);
  });

  test("a send to a grandchild posts nothing and owes nothing", async () => {
    lookup = subAgentOf("d1d1d1d1d1d1");
    await expect(toolOf(root, "message_sub_agent").run({ to: "f1f1f1f1f1f1", text: "hi" }, signal)).rejects.toThrow(hint("f1f1f1f1f1f1"));
    expect(posts()).toEqual([]);
    expect(debts.owed.size).toBe(0);
  });

  test("a sub-agent deleted between the check and the post gets the same error", async () => {
    answer = () => ({ status: 404, body: { error: "no agent d1d1d1d1d1d1" } });
    await expect(toolOf(root, "message_sub_agent").run({ to: "d1d1d1d1d1d1", text: "hi" }, signal)).rejects.toThrow(hint("d1d1d1d1d1d1"));
    expect(debts.owed.size).toBe(0);
  });
});

describe("the agent records which sub-agents owe it a reply", () => {
  test("a send records the debt before it posts", async () => {
    let owedWhilePosting = false;
    answer = () => ((owedWhilePosting = debts.owed.has("d1d1d1d1d1d1")), { status: 202 });
    await toolOf(root, "message_sub_agent").run({ to: "d1d1d1d1d1d1", text: "hi" }, signal);
    expect(owedWhilePosting).toBe(true);
    expect([...debts.owed]).toEqual(["d1d1d1d1d1d1"]);
  });

  test("a failed send owes nothing, unless the sub-agent owed already", async () => {
    answer = () => ({ status: 500, body: { error: "down" } });
    const send = toolOf(root, "message_sub_agent");
    // Only the post fails: the lookup still finds the sub-agent.
    await expect(send.run({ to: "d1d1d1d1d1d1", text: "hi" }, signal)).rejects.toThrow("500");
    expect(debts.owed.size).toBe(0);
    debts.owe("d1d1d1d1d1d1");
    await expect(send.run({ to: "d1d1d1d1d1d1", text: "more" }, signal)).rejects.toThrow("500");
    expect([...debts.owed]).toEqual(["d1d1d1d1d1d1"]);
  });

  test("a confirmed stop or delete clears the sub-agent's debt, and a refused one doesn't", async () => {
    answer = (method) => (method === "DELETE" ? { status: 204 } : { status: 200, body: {} });
    debts.owe("d1d1d1d1d1d1");
    await toolOf(root, "stop_agent").run({ id: "d1d1d1d1d1d1" }, signal);
    expect(debts.owed.size).toBe(0);
    debts.owe("d1d1d1d1d1d1");
    await toolOf(root, "delete_agent").run({ id: "d1d1d1d1d1d1" }, signal);
    expect(debts.owed.size).toBe(0);
    debts.owe("d1d1d1d1d1d1");
    answer = () => ({ status: 409, body: { error: "busy" } });
    await expect(toolOf(root, "delete_agent").run({ id: "d1d1d1d1d1d1" }, signal)).rejects.toThrow("409");
    expect([...debts.owed]).toEqual(["d1d1d1d1d1d1"]);
  });
});

describe("the model sees no agent ID it can't message", () => {
  test("spawn_agent returns the new agent's ID, grant and state, and not its parent", async () => {
    answer = () => ({ status: 201, body: { id: "d1d1d1d1d1d1", parent: root.id, grant: { spawn: false }, state: "running" } });
    const output = await toolOf(root, "spawn_agent").run({ grant: { spawn: false } }, signal);
    expect(requests).toEqual([{ method: "POST", path: "/agents", auth: "Bearer agent-token", body: { grant: { spawn: false } } }]);
    expect(JSON.parse(output)).toEqual({ id: "d1d1d1d1d1d1", grant: { spawn: false }, state: "running" });
  });

  test("list_agents lists only direct sub-agents, without parents", async () => {
    answer = () => ({
      status: 200,
      body: [
        { id: root.id, parent: null, grant: { spawn: true }, state: "running" },
        { id: "d1d1d1d1d1d1", parent: root.id, grant: { spawn: true }, state: "running" },
        { id: "f1f1f1f1f1f1", parent: "d1d1d1d1d1d1", grant: { spawn: false }, state: "stopped" },
      ],
    });
    expect(JSON.parse(await toolOf(root, "list_agents").run({}, signal))).toEqual([{ id: "d1d1d1d1d1d1", grant: { spawn: true }, state: "running" }]);
  });

  test.each([root, lead, child])("instructions hold neither the agent's ID nor its parent's", (identity) => {
    const text = instructions(identity);
    expect(text).not.toContain(identity.id);
    expect(text).not.toContain(identity.parent);
  });
});

describe("delegation tools follow the grant", () => {
  test("an agent with spawn is offered every tool", () => {
    expect(delegationTools(root, client, debts).map((t) => t.name)).toEqual(["message_sub_agent", "spawn_agent", "list_agents", "stop_agent", "start_agent", "delete_agent"]);
  });

  test("an agent without spawn is offered no tools", () => {
    expect(delegationTools(child, client, debts)).toEqual([]);
  });

  const delegation = ["message_sub_agent", "spawn_agent", "list_agents", "stop_agent", "start_agent", "delete_agent"];
  test.each([
    [{ spawn: true, workspace: false }, delegation],
    [{ spawn: false, workspace: true }, ["run_command"]],
    [{ spawn: true, workspace: true }, [...delegation, "run_command"]],
    [{ spawn: false, workspace: false }, []],
  ])("an agent with %j is offered its grant's tools", (grant, names) => {
    expect(toolsFor({ ...root, grant }, client, debts).map((t) => t.name)).toEqual(names);
  });

  test("spawn_agent can pass workspace on", () => {
    const schema = toolOf(root, "spawn_agent").inputSchema as { properties: { grant: { properties: object } } };
    expect(Object.keys(schema.properties.grant.properties)).toEqual(["spawn", "workspace"]);
  });

  test("stop, start and delete call their routes and return the runtime's answer, without the parent", async () => {
    answer = (method, path) =>
      method === "DELETE" ? { status: 204 } : { status: 200, body: { id: "d1d1d1d1d1d1", parent: root.id, grant: { spawn: false }, state: path.endsWith("/stop") ? "stopped" : "running" } };
    const id = { id: "d1d1d1d1d1d1" };
    expect(JSON.parse(await toolOf(root, "stop_agent").run(id, signal))).toEqual({ id: "d1d1d1d1d1d1", grant: { spawn: false }, state: "stopped" });
    expect(JSON.parse(await toolOf(root, "start_agent").run(id, signal))).toEqual({ id: "d1d1d1d1d1d1", grant: { spawn: false }, state: "running" });
    expect(await toolOf(root, "delete_agent").run(id, signal)).toBe("done");
    expect(requests.map((r) => `${r.method} ${r.path}`)).toEqual(["POST /agents/d1d1d1d1d1d1/stop", "POST /agents/d1d1d1d1d1d1/start", "DELETE /agents/d1d1d1d1d1d1"]);
  });
});

describe("a runtime refusal is a tool error", () => {
  let dir: string;
  let store: Store;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "jen-delegation-"));
    store = openStore(join(dir, "agent.db"));
  });
  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test("a stop of an agent out of reach gets a result that starts with Error: and holds 404", async () => {
    answer = () => ({ status: 404, body: { error: "no agent d1d1d1d1d1d1" } });
    const turn: Item[] = [{ type: "tool_call", id: "c1", name: "stop_agent", input: { id: "d1d1d1d1d1d1" } }];
    const model = new ScriptedModel([turn, [{ type: "message", role: "assistant", text: "ok" }]]);
    const agent = new Agent({ store, model, tools: delegationTools(root, client, store), instructions: "", parent: root.parent });
    agent.start();
    agent.accept({ from: root.parent, text: "stop d1", urgent: false });
    await agent.idle();
    const output = (store.load().find((i) => i.type === "tool_result") as { output: string }).output;
    expect(output).toMatch(/^Error: .*404/);
    expect(output).toContain("no agent d1d1d1d1d1d1");
    expect(output).not.toBe(INTERRUPTED);
  });

  test("a cancelled call aborts its request", async () => {
    const hung = http.createServer(() => {});
    await new Promise<void>((resolve) => hung.listen(0, "127.0.0.1", resolve));
    const slow = new RuntimeClient(`http://127.0.0.1:${(hung.address() as AddressInfo).port}`, "t");
    const abort = new AbortController();
    const sent = delegationTools(root, slow, debts)[0]!.run({ to: "d1d1d1d1d1d1", text: "hi" } as Json, abort.signal);
    abort.abort();
    await expect(sent).rejects.toMatchObject({ name: "AbortError" });
    expect(debts.owed.size).toBe(0);
    hung.closeAllConnections();
    await new Promise((resolve) => hung.close(resolve));
  });
});

describe("the agent is told how to work in a tree", () => {
  test("every model call carries the instructions", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jen-delegation-"));
    const store = openStore(join(dir, "agent.db"));
    const model = new ScriptedModel([[{ type: "message", role: "assistant", text: "ok" }]]);
    const agent = new Agent({ store, model, tools: [], instructions: instructions(child), parent: child.parent });
    agent.start();
    agent.accept({ from: child.parent, text: "go", urgent: false });
    await agent.idle();
    expect(model.calls.map((c) => c.instructions)).toEqual([instructions(child)]);
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test("a root's instructions say its parent is the user, and say what matters", () => {
    const text = instructions(root);
    expect(text).toMatch(/Your parent is the user\./);
    expect(text).toMatch(/That reply goes to the user, and it's the only way to answer/);
    expect(text).toMatch(/send or report something, reply with it/);
    expect(text).toMatch(/no sender line/);
    expect(text).toMatch(/message_sub_agent/);
    expect(text).toMatch(/ask the sub-agent to reply with its result, not to send it/);
    expect(text).toMatch(/call wait/);
    expect(text).toMatch(/leave the work alone/);
    expect(text).toMatch(/"runtime" tells you a sub-agent has stopped/);
    expect(text).toMatch(/Never acknowledge/);
    expect(text).toMatch(/urgent only when waiting would cause harm or waste/);
  });

  test("a sub-agent without spawn is told its parent started it, and nothing of sub-agents or wait", () => {
    const text = instructions(child);
    expect(text).toMatch(/Your parent is the agent that started you\./);
    expect(text).toMatch(/That reply goes to your parent/);
    expect(text).not.toMatch(/message_sub_agent|wait/);
  });
});
