import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { delegationTools, instructions, readIdentity, RuntimeClient, type Identity } from "./delegation.ts";
import { Agent, INTERRUPTED } from "./loop.ts";
import type { Item, Json } from "./model/port.ts";
import { ScriptedModel } from "./model/scripted.ts";
import { openStore, type Store } from "./store.ts";

const env = { JEN_AGENT_ID: "a1b2c3d4e5f6", JEN_PARENT: "owner", JEN_GRANT: '{"spawn":true}' };

describe("the agent knows who it is", () => {
  test("reads its ID, parent, grant and wake ID", () => {
    expect(readIdentity({ ...env, JEN_WAKE: "w1" })).toEqual({ id: "a1b2c3d4e5f6", parent: "owner", grant: { spawn: true }, wake: "w1" });
    expect(readIdentity(env).wake).toBeUndefined();
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
    ["JEN_WAKE", { JEN_WAKE: "" }],
  ])("exits non-zero naming %s when it's missing or malformed", (name, overrides) => {
    const run = main(overrides);
    expect(run.status).not.toBe(0);
    expect(run.status).not.toBeNull();
    expect(run.stderr).toContain(name);
  });
});

// A runtime that records each request and answers from answer.
let runtime: http.Server;
let requests: { method: string; path: string; auth?: string; body: unknown }[];
let answer: (method: string, path: string) => { status: number; body?: unknown };
let client: RuntimeClient;
beforeEach(async () => {
  requests = [];
  answer = () => ({ status: 202 });
  runtime = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      requests.push({ method: req.method!, path: req.url!, auth: req.headers.authorization, body: body === "" ? undefined : JSON.parse(body) });
      const { status, body: reply } = answer(req.method!, req.url!);
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

const child: Identity = { id: "c0c0c0c0c0c0", parent: "a1b2c3d4e5f6", grant: { spawn: false } };
const root: Identity = { id: "a1b2c3d4e5f6", parent: "owner", grant: { spawn: true } };
const signal = new AbortController().signal;

function toolOf(identity: Identity, name: string) {
  const found = delegationTools(identity, client).find((t) => t.name === name);
  if (!found) throw new Error(`no tool ${name}`);
  return found;
}

describe("every agent can send a message", () => {
  test("a child's answer to its parent is posted with its own token, and is delivered", async () => {
    const output = await toolOf(child, "send_message").run({ to: "a1b2c3d4e5f6", text: "done" }, signal);
    expect(output).toBe("delivered");
    expect(requests).toEqual([{ method: "POST", path: "/agents/a1b2c3d4e5f6/messages", auth: "Bearer agent-token", body: { text: "done" } }]);
  });

  test("an urgent send posts urgent in its body", async () => {
    await toolOf(child, "send_message").run({ to: "a1b2c3d4e5f6", text: "stop", urgent: true }, signal);
    expect(requests[0]!.body).toEqual({ text: "stop", urgent: true });
  });

  test("a send with a missing receiver or text is refused before any request", async () => {
    const send = toolOf(child, "send_message");
    await expect(send.run({ text: "hi" }, signal)).rejects.toThrow(/to/);
    await expect(send.run({ to: "a1b2c3d4e5f6", text: "" }, signal)).rejects.toThrow(/text/);
    await expect(send.run({ to: "a1b2c3d4e5f6", text: "hi", urgent: "yes" }, signal)).rejects.toThrow(/urgent/);
    expect(requests).toEqual([]);
  });
});

describe("a root agent's send to the owner is delivered by saving its result", () => {
  test("it makes no request, and its result is delivered", async () => {
    expect(await toolOf(root, "send_message").run({ to: "owner", text: "here's the result" }, signal)).toBe("delivered");
    expect(requests).toEqual([]);
  });

  test("interrupted, it wasn't delivered; any other interrupted send's outcome is unknown", () => {
    expect(toolOf(root, "send_message").interrupted!({ to: "owner", text: "x" })).toBe("Error: interrupted before it was sent, so it wasn't delivered.");
    expect(toolOf(root, "send_message").interrupted!({ to: "c0c0c0c0c0c0", text: "x" })).toBeUndefined();
    expect(toolOf(child, "send_message").interrupted!({ to: "owner", text: "x" })).toBeUndefined();
  });

  test("a sub-agent's send to owner goes to the runtime, which refuses it", async () => {
    answer = () => ({ status: 404, body: { error: "no agent owner" } });
    await expect(toolOf(child, "send_message").run({ to: "owner", text: "hi" }, signal)).rejects.toThrow("404");
    expect(requests.map((r) => r.path)).toEqual(["/agents/owner/messages"]);
  });
});

describe("delegation tools follow the grant", () => {
  test("an agent with spawn is offered every tool", () => {
    expect(delegationTools(root, client).map((t) => t.name)).toEqual(["send_message", "spawn_agent", "list_agents", "stop_agent", "start_agent", "delete_agent"]);
  });

  test("an agent without spawn is offered only send_message", () => {
    expect(delegationTools(child, client).map((t) => t.name)).toEqual(["send_message"]);
  });

  test("spawn_agent creates a child with the grant and returns its ID", async () => {
    answer = () => ({ status: 201, body: { id: "d1d1d1d1d1d1", parent: root.id, grant: { spawn: false }, state: "running" } });
    const output = await toolOf(root, "spawn_agent").run({ grant: { spawn: false } }, signal);
    expect(requests).toEqual([{ method: "POST", path: "/agents", auth: "Bearer agent-token", body: { grant: { spawn: false } } }]);
    expect(JSON.parse(output)).toMatchObject({ id: "d1d1d1d1d1d1" });
  });

  test("list, stop, start and delete call their routes and return the runtime's answer", async () => {
    answer = (method) => (method === "DELETE" ? { status: 204 } : { status: 200, body: { ok: method } });
    const id = { id: "d1d1d1d1d1d1" };
    expect(await toolOf(root, "list_agents").run({}, signal)).toBe('{"ok":"GET"}');
    expect(await toolOf(root, "stop_agent").run(id, signal)).toBe('{"ok":"POST"}');
    expect(await toolOf(root, "start_agent").run(id, signal)).toBe('{"ok":"POST"}');
    expect(await toolOf(root, "delete_agent").run(id, signal)).toBe("done");
    expect(requests.map((r) => `${r.method} ${r.path}`)).toEqual([
      "GET /agents",
      "POST /agents/d1d1d1d1d1d1/stop",
      "POST /agents/d1d1d1d1d1d1/start",
      "DELETE /agents/d1d1d1d1d1d1",
    ]);
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

  test("a send to an agent out of reach gets a result that starts with Error: and holds 404", async () => {
    answer = () => ({ status: 404, body: { error: "no agent d1d1d1d1d1d1" } });
    const turn: Item[] = [{ type: "tool_call", id: "c1", name: "send_message", input: { to: "d1d1d1d1d1d1", text: "hi" } }];
    const model = new ScriptedModel([turn, [{ type: "message", role: "assistant", text: "ok" }]]);
    const agent = new Agent({ store, model, tools: delegationTools(child, client), instructions: "" });
    agent.start();
    agent.accept({ from: child.parent, text: "say hi to d1", urgent: false });
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
    const sent = delegationTools(child, slow)[0]!.run({ to: child.parent, text: "hi" } as Json, abort.signal);
    abort.abort();
    await expect(sent).rejects.toMatchObject({ name: "AbortError" });
    hung.closeAllConnections();
    await new Promise((resolve) => hung.close(resolve));
  });
});

describe("the agent is told how to work in a tree", () => {
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

  test("every model call carries instructions holding the agent's ID and its parent's", async () => {
    const model = new ScriptedModel([[{ type: "tool_call", id: "c1", name: "list_agents", input: {} }], [{ type: "message", role: "assistant", text: "ok" }]]);
    answer = () => ({ status: 200, body: [] });
    const agent = new Agent({ store, model, tools: delegationTools(child, client), instructions: instructions(child) });
    agent.start();
    agent.accept({ from: child.parent, text: "go", urgent: false });
    await agent.idle();
    expect(model.calls).toHaveLength(2);
    for (const { instructions: text } of model.calls) {
      expect(text).toContain("c0c0c0c0c0c0");
      expect(text).toContain("a1b2c3d4e5f6");
    }
  });

  test("a root's instructions name the owner as its parent, and say what matters", () => {
    const text = instructions(root);
    expect(text).toContain('"owner"');
    expect(text).toMatch(/text output reaches no one/);
    expect(text).toMatch(/end your turn/);
    expect(text).toMatch(/send your parent the result/);
    expect(text).toMatch(/urgent only when waiting would cause harm or waste/);
  });
});
