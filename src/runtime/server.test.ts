import { mkdtempSync, rmSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { gzipSync } from "node:zlib";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { openStore, type Store } from "../agent/store.ts";
import type { Item } from "../agent/model/port.ts";
import { OpenAIResponsesModel } from "../agent/model/openai-responses.ts";
import { ScriptedModel } from "../agent/model/scripted.ts";
import { Agent } from "../agent/loop.ts";
import { createServer as createAgentServer } from "../agent/server.ts";
import { PAGE, TEXTBOX } from "../agent/ui.ts";
import { DockerError } from "./docker.ts";
import { FakeDocker, type FakeExec } from "./fake-docker.ts";
import { Runtime } from "./runtime.ts";
import { createRuntimeServer, MAX_BODY, MAX_COMMAND_BODY, MAX_MODEL_BODY } from "./server.ts";

const ownerToken = "owner-secret";
const owner = { Authorization: `Bearer ${ownerToken}` };
const assistant = (text: string): Item => ({ type: "message", role: "assistant", text });

let dir: string;
let docker: FakeDocker;
let runtime: Runtime;
let base: string;
const servers: http.Server[] = [];
const stores: Store[] = [];
// Each agent's protocol, served in-process, by its container's name.
const agents = new Map<string, string>();
// What the runtime makes agents' model calls with.
const modelSettings = { model: "runtime-model", apiKey: "sk-owner", baseURL: "https://provider.test/v1/" };
// Each call the runtime sent the stub provider, and how the stub answers.
interface Provided {
  url: string;
  headers: Headers;
  raw: string;
  body: Record<string, unknown>;
  signal: AbortSignal;
}
let provided: Provided[];
let provider: (call: Provided) => Response | Promise<Response>;
const stubFetch = (async (url: string | URL | Request, init?: RequestInit) => {
  const raw = String(init?.body);
  const call = { url: String(url), headers: new Headers(init?.headers), raw, body: JSON.parse(raw), signal: init!.signal! };
  provided.push(call);
  return provider(call);
}) as typeof globalThis.fetch;

async function listen(server: http.Server): Promise<string> {
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "jen-runtime-server-"));
  docker = new FakeDocker();
  const self = docker.add({ name: "jen-runtime" });
  runtime = new Runtime({
    docker,
    name: "jen",
    image: "jen",
    workspaceImage: "jen-workspace",
    model: "m",
    maxDepth: 3,
    maxAgents: 10,
    agentURL: (container) => agents.get(container) ?? "http://127.0.0.1:1",
    // Each test serves an agent's protocol only after spawning it.
    ready: async () => {},
  });
  await runtime.startup(self.id);
  provided = [];
  provider = () => Response.json({ ok: true });
  base = await listen(createRuntimeServer({ runtime, ownerToken, model: modelSettings, fetch: stubFetch }));
});
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  for (const store of stores.splice(0)) store.close();
  agents.clear();
  rmSync(dir, { recursive: true, force: true });
});

const tokenOf = (id: string) => docker.find(`jen-agent-${id}`)!.env.find((e) => e.startsWith("JEN_TOKEN="))!.slice("JEN_TOKEN=".length);
const as = (token: string) => ({ Authorization: `Bearer ${token}` });

function call(path: string, init: RequestInit & { headers?: Record<string, string> } = {}) {
  return fetch(`${base}${path}`, { ...init, headers: { ...owner, ...init.headers } });
}

async function spawn(grant: unknown, headers: Record<string, string> = owner) {
  const res = await fetch(`${base}/agents`, { method: "POST", headers, body: JSON.stringify({ grant }) });
  return { res, body: await res.json() };
}

// Serves the agent's protocol in-process, with the token the runtime gave it,
// and a scripted model.
async function serveAgent(id: string, turns: Item[][]) {
  const store = openStore(join(dir, `${id}.db`));
  stores.push(store);
  const agent = new Agent({ store, model: new ScriptedModel(turns), tools: [], instructions: "" });
  agent.start();
  agents.set(`jen-agent-${id}`, await listen(createAgentServer({ store, agent, token: tokenOf(id) })));
  return agent;
}

// Serves an agent that records each message it's sent, whatever its token,
// and saves it with 202.
async function recordingAgent(id: string) {
  const received: { from?: string; auth?: string; body: string }[] = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      received.push({ from: req.headers["jen-from"] as string | undefined, auth: req.headers.authorization, body });
      res.writeHead(202).end();
    });
  });
  agents.set(`jen-agent-${id}`, await listen(server));
  return received;
}

const message = (text: string) => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });

// Reads an event stream until n items have arrived.
async function items(res: Response, n: number): Promise<{ id: string; item: Item }[]> {
  const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
  const found: { id: string; item: Item }[] = [];
  let buffer = "";
  while (found.length < n) {
    const { value, done } = await reader.read();
    if (done) throw new Error("the stream ended");
    buffer += value;
    let end;
    while ((end = buffer.indexOf("\n\n")) >= 0) {
      const block = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      const id = block.match(/^id: (.*)$/m)?.[1];
      const data = block.match(/^data: (.*)$/m)?.[1];
      if (id && data) found.push({ id, item: JSON.parse(data) });
    }
  }
  await reader.cancel();
  return found;
}

test("a request without a token gets 401 and changes nothing", async () => {
  const res = await fetch(`${base}/agents`, { method: "POST", body: JSON.stringify({ grant: { spawn: true } }) });
  expect(res.status).toBe(401);
  expect(res.headers.get("www-authenticate")).toBe("Bearer");
  expect(await runtime.list(null)).toEqual([]);
});

test("a wrong token gets 401", async () => {
  expect((await fetch(`${base}/agents`, { headers: as("nope") })).status).toBe(401);
  expect((await fetch(`${base}/agents`, { headers: { Authorization: ownerToken } })).status).toBe(401);
});

test("a stopped agent's token gets 401", async () => {
  const { body: root } = await spawn({ spawn: true });
  const token = tokenOf(root.id);
  expect((await fetch(`${base}/agents`, { headers: as(token) })).status).toBe(200);
  await call(`/agents/${root.id}/stop`, { method: "POST" });
  expect((await fetch(`${base}/agents`, { headers: as(token) })).status).toBe(401);
});

// A spawn whose body is still uploading when its caller is stopped, or
// stopped and started, is refused once the body arrives.
for (const restart of [false, true]) {
  test(`a spawn uploading while its caller is stopped${restart ? " and started" : ""} gets 401`, async () => {
    const { body: root } = await spawn({ spawn: true });
    const identified = vi.spyOn(runtime, "identify");
    const req = http.request(`${base}/agents`, { method: "POST", headers: as(tokenOf(root.id)) });
    const answered = new Promise<http.IncomingMessage>((resolve) => req.on("response", resolve));
    req.write('{"grant":');
    req.flushHeaders();
    await vi.waitFor(() => expect(identified).toHaveBeenCalled());
    expect((await identified.mock.results[0].value)?.id).toBe(root.id);
    await call(`/agents/${root.id}/stop`, { method: "POST" });
    if (restart) await call(`/agents/${root.id}/start`, { method: "POST" });
    req.end('{"spawn":false}}');
    const res = await answered;
    res.resume();
    expect(res.statusCode).toBe(401);
    expect((await runtime.list(null)).map((a) => a.id)).toEqual([root.id]);
  });
}

test("the owner spawns a root agent", async () => {
  const { res, body } = await spawn({ spawn: true });
  expect(res.status).toBe(201);
  expect(body).toEqual({ id: expect.any(String), parent: null, grant: { spawn: true, workspace: false }, state: "running" });
});

test("an agent spawns a sub-agent with its own token", async () => {
  const { body: root } = await spawn({ spawn: true });
  const { res, body } = await spawn({ spawn: false }, as(tokenOf(root.id)));
  expect(res.status).toBe(201);
  expect(body).toMatchObject({ parent: root.id, grant: { spawn: false } });
});

test("fields besides grant don't reach the container", async () => {
  const { body: plain } = await spawn({ spawn: false });
  const res = await call("/agents", { method: "POST", body: JSON.stringify({ grant: { spawn: false }, image: "evil", env: ["X=1"], binds: ["/:/host"] }) });
  expect(res.status).toBe(201);
  const extra = await res.json();
  const settings = (id: string) => {
    const { image, network, restart, volume, env } = docker.find(`jen-agent-${id}`)!.spec!;
    return { image, network, restart, path: volume.path, env: env.filter((e) => !e.startsWith("JEN_TOKEN=") && !e.startsWith("JEN_AGENT_ID=")) };
  };
  expect(settings(extra.id)).toEqual(settings(plain.id));
});

test("a grant's missing capabilities are false, and every agent is described with both", async () => {
  for (const [grant, full] of [
    [{ spawn: true }, { spawn: true, workspace: false }],
    [{ workspace: true }, { spawn: false, workspace: true }],
    [{}, { spawn: false, workspace: false }],
    [{ spawn: true, workspace: true }, { spawn: true, workspace: true }],
  ]) {
    const { res, body } = await spawn(grant);
    expect(res.status).toBe(201);
    expect(body.grant).toEqual(full);
  }
  const { body: lead } = await spawn({ spawn: true, workspace: true });
  await spawn({ workspace: true }, as(tokenOf(lead.id)));
  const described = [...(await (await call("/agents")).json()), await (await call(`/agents/${lead.id}`)).json()];
  for (const agent of described) expect(Object.keys(agent.grant).sort()).toEqual(["spawn", "workspace"]);
});

test("a spawn body that isn't JSON or has a bad grant gets 400", async () => {
  expect((await call("/agents", { method: "POST", body: "{" })).status).toBe(400);
  for (const grant of [undefined, null, [], { spawn: "yes" }, { workspace: 1 }, { spawn: true, docker: true }, { spawn: true, network: true }]) {
    expect((await spawn(grant)).res.status).toBe(400);
  }
  expect(await runtime.list(null)).toEqual([]);
});

test("a spawn body over the bound gets 413, declared or chunked, and creates nothing", async () => {
  const declared = await call("/agents", { method: "POST", body: " ".repeat(MAX_BODY + 1) });
  expect(declared.status).toBe(413);
  expect(declared.headers.get("connection")).toBe("close");

  // A chunked body is answered once it crosses the bound, before it ends.
  const { port } = new URL(base);
  const upload = (endless: boolean) =>
    new Promise<number | undefined>((resolve) => {
      const req = http.request({ host: "127.0.0.1", port, method: "POST", path: "/agents", headers: owner });
      let status: number | undefined;
      const chunk = Buffer.alloc(1024, 32);
      const write = () => {
        while (!req.destroyed && req.write(chunk));
      };
      req.on("error", () => {});
      req.on("response", (res) => ((status = res.statusCode), res.resume()));
      req.on("close", () => resolve(status));
      if (endless) req.on("drain", write), write();
      else req.write(Buffer.alloc(MAX_BODY + 1, 32));
    });
  expect(await upload(false)).toBe(413);
  // One that keeps coming has its connection closed rather than read to the
  // end. Closing on unread data resets the connection, so the 413 may be lost.
  await upload(true);
  expect(await runtime.list(null)).toEqual([]);
});

test("a caller without spawn gets 403", async () => {
  const { body: root } = await spawn({ spawn: false });
  const { res, body } = await spawn({ spawn: false }, as(tokenOf(root.id)));
  expect(res.status).toBe(403);
  expect(body.error).toBe("the caller may not spawn");
});

test("a spawn that leaves an agent behind names it", async () => {
  vi.spyOn(docker, "startContainer").mockRejectedValueOnce(new DockerError(500, "cannot start"));
  vi.spyOn(docker, "removeVolume").mockRejectedValueOnce(new DockerError(500, "cannot remove"));
  const { res, body } = await spawn({ spawn: false });
  expect(res.status).toBe(500);
  expect(body.agent).toMatch(/^[0-9a-f]{12}$/);
});

test("list, get, stop, start and delete", async () => {
  const { body: root } = await spawn({ spawn: true });
  const { body: child } = await spawn({ spawn: false }, as(tokenOf(root.id)));

  const list = await call("/agents");
  expect(list.status).toBe(200);
  expect((await list.json()).map((a: { id: string }) => a.id).sort()).toEqual([root.id, child.id].sort());
  expect(await (await fetch(`${base}/agents`, { headers: as(tokenOf(root.id)) })).json()).toEqual([child]);

  const got = await call(`/agents/${child.id}`);
  expect([got.status, await got.json()]).toEqual([200, child]);

  const stopped = await call(`/agents/${root.id}/stop`, { method: "POST" });
  expect([stopped.status, (await stopped.json()).state]).toEqual([200, "stopped"]);
  const started = await call(`/agents/${root.id}/start`, { method: "POST" });
  expect([started.status, (await started.json()).state]).toEqual([200, "running"]);
  expect((await (await call(`/agents/${child.id}`)).json()).state).toBe("stopped");

  const deleted = await call(`/agents/${root.id}`, { method: "DELETE" });
  expect([deleted.status, await deleted.text()]).toEqual([204, ""]);
  expect((await call(`/agents/${child.id}`)).status).toBe(404);
  expect(await (await call("/agents")).json()).toEqual([]);
});

test("an agent that isn't the caller's descendant is not found", async () => {
  const { body: a } = await spawn({ spawn: true });
  const { body: b } = await spawn({ spawn: true });
  const token = tokenOf(a.id);
  for (const [method, path] of [
    ["GET", `/agents/${b.id}`],
    ["POST", `/agents/${b.id}/stop`],
    ["POST", `/agents/${b.id}/start`],
    ["DELETE", `/agents/${b.id}`],
    ["POST", `/agents/${b.id}/messages`],
    ["GET", `/agents/${b.id}/events`],
    ["POST", `/agents/${a.id}/stop`],
    ["GET", "/agents/000000000000"],
  ]) {
    expect((await fetch(`${base}${path}`, { method, headers: as(token) })).status, `${method} ${path}`).toBe(404);
  }
  expect((await runtime.get(null, b.id)).state).toBe("running");
});

test("the owner's message is relayed and saved, and the reply is on the agent's event stream", async () => {
  const { body: root } = await spawn({ spawn: false });
  const agent = await serveAgent(root.id, [[assistant("heron")]]);
  const res = await call(`/agents/${root.id}/messages`, message("Which bird?"));
  expect(res.status).toBe(202);
  await agent.idle();
  expect(await items(await call(`/agents/${root.id}/events`), 2)).toEqual([
    { id: "1", item: { type: "message", role: "user", from: "owner", text: "Which bird?" } },
    { id: "2", item: assistant("heron") },
  ]);
});

test("a relayed message carries its true sender, whatever the caller claims, and its body unchanged", async () => {
  const { body: root } = await spawn({ spawn: true });
  const { body: child } = await spawn({ spawn: false }, as(tokenOf(root.id)));
  const received = await recordingAgent(child.id);
  const body = JSON.stringify({ text: "stop", urgent: true });
  await fetch(`${base}/agents/${child.id}/messages`, { method: "POST", headers: { ...as(tokenOf(root.id)), "Jen-From": "owner" }, body });
  await call(`/agents/${child.id}/messages`, { method: "POST", headers: { "Jen-From": "runtime" }, body });
  expect(received).toEqual([
    { from: root.id, auth: `Bearer ${tokenOf(child.id)}`, body },
    { from: "owner", auth: `Bearer ${tokenOf(child.id)}`, body },
  ]);
});

test("a child messages its parent, but can't stop it", async () => {
  const { body: root } = await spawn({ spawn: true });
  const { body: child } = await spawn({ spawn: false }, as(tokenOf(root.id)));
  const received = await recordingAgent(root.id);
  const res = await fetch(`${base}/agents/${root.id}/messages`, { method: "POST", headers: as(tokenOf(child.id)), body: '{"text":"which file?"}' });
  expect(res.status).toBe(202);
  expect(received.map((m) => m.from)).toEqual([child.id]);
  expect((await fetch(`${base}/agents/${root.id}/stop`, { method: "POST", headers: as(tokenOf(child.id)) })).status).toBe(404);
  expect((await runtime.get(null, root.id)).state).toBe("running");
});

test("a grandchild can't message its grandparent", async () => {
  const { body: root } = await spawn({ spawn: true });
  const { body: child } = await spawn({ spawn: true }, as(tokenOf(root.id)));
  const { body: grandchild } = await spawn({ spawn: false }, as(tokenOf(child.id)));
  const res = await fetch(`${base}/agents/${root.id}/messages`, { method: "POST", headers: as(tokenOf(grandchild.id)), body: '{"text":"hi"}' });
  expect(res.status).toBe(404);
});

test("no caller reaches the owner or the runtime through the API", async () => {
  const { body: root } = await spawn({ spawn: true });
  for (const id of ["owner", "runtime"]) {
    for (const [method, action] of [["POST", "/messages"], ["GET", "/events"], ["GET", ""], ["POST", "/stop"], ["POST", "/start"], ["DELETE", ""]]) {
      for (const headers of [owner, as(tokenOf(root.id))]) {
        expect((await fetch(`${base}/agents/${id}${action}`, { method, headers, body: method === "POST" ? '{"text":"hi"}' : undefined })).status).toBe(404);
      }
    }
  }
});

test("a message to a stopped agent starts it, then delivers the message and then the runtime's notice", async () => {
  const { body: root } = await spawn({ spawn: true });
  const { body: child } = await spawn({ spawn: false }, as(tokenOf(root.id)));
  await call(`/agents/${root.id}/stop`, { method: "POST" });
  const received = await recordingAgent(root.id);
  const res = await call(`/agents/${root.id}/messages`, message("wake up"));
  expect(res.status).toBe(202);
  await vi.waitFor(() => expect(received).toHaveLength(2));
  const auth = `Bearer ${tokenOf(root.id)}`;
  expect(received).toEqual([
    { from: "owner", auth, body: JSON.stringify({ text: "wake up" }) },
    {
      from: "runtime",
      auth,
      body: JSON.stringify({ text: `You were stopped and have been started again. Your sub-agents ${child.id} are still stopped. Messaging one starts it.` }),
    },
  ]);
  const env = docker.find(`jen-agent-${root.id}`)!.env;
  expect(env.some((e) => /^JEN_WAKE=[0-9a-f]{32}$/.test(e))).toBe(true);
  expect((await runtime.get(null, child.id)).state).toBe("stopped");
});

test("an explicit start with a stopped child sends the notice alone", async () => {
  const { body: root } = await spawn({ spawn: true });
  const { body: child } = await spawn({ spawn: false }, as(tokenOf(root.id)));
  await call(`/agents/${root.id}/stop`, { method: "POST" });
  const received = await recordingAgent(root.id);
  expect((await call(`/agents/${root.id}/start`, { method: "POST" })).status).toBe(200);
  expect(received).toEqual([
    {
      from: "runtime",
      auth: `Bearer ${tokenOf(root.id)}`,
      body: JSON.stringify({ text: `You were stopped and have been started again. Your sub-agents ${child.id} are still stopped. Messaging one starts it.` }),
    },
  ]);
});

test("the agent's own errors pass through unchanged", async () => {
  const { body: root } = await spawn({ spawn: false });
  await serveAgent(root.id, []);
  const res = await call(`/agents/${root.id}/messages`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: 5 }) });
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: "text must be a string" });
});

test("the event stream is relayed, resuming after Last-Event-ID", async () => {
  const { body: root } = await spawn({ spawn: false });
  const agent = await serveAgent(root.id, [[assistant("one")], [assistant("two")]]);
  for (const text of ["first", "second"]) {
    await call(`/agents/${root.id}/messages`, message(text));
    await agent.idle();
  }

  const all = await call(`/agents/${root.id}/events`);
  expect(all.status).toBe(200);
  expect(all.headers.get("content-type")).toBe("text/event-stream");
  expect((await items(all, 4)).map((e) => e.id)).toEqual(["1", "2", "3", "4"]);

  const resumed = await call(`/agents/${root.id}/events`, { headers: { "Last-Event-ID": "2" } });
  expect(await items(resumed, 2)).toEqual([
    { id: "3", item: { type: "message", role: "user", from: "owner", text: "second" } },
    { id: "4", item: assistant("two") },
  ]);
});

test("an event stream opens before the agent has anything to send", async () => {
  const { body: root } = await spawn({ spawn: false });
  await serveAgent(root.id, []);
  const abort = new AbortController();
  const res = await call(`/agents/${root.id}/events`, { signal: abort.signal });
  expect(res.status).toBe(200);
  abort.abort();
});

test("an event stream ends when the agent's connection drops mid-stream", async () => {
  const { body: root } = await spawn({ spawn: false });
  // An agent that sends an event, then goes away, as a stopped or crashed one does.
  const agent = http.createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write('id: 1\ndata: {"type":"message","role":"user","from":"owner","text":"hi"}\n\n', () => setTimeout(() => res.socket?.destroy(), 20));
  });
  agents.set(`jen-agent-${root.id}`, await listen(agent));
  const res = await call(`/agents/${root.id}/events`);
  expect(res.status).toBe(200);
  const reader = res.body!.getReader();
  // The first event arrives, then the stream ends or fails rather than hanging.
  expect((await reader.read()).done).toBe(false);
  const ended = await Promise.race([
    (async () => {
      try {
        while (!(await reader.read()).done);
      } catch {}
      return true;
    })(),
    new Promise((resolve) => setTimeout(() => resolve(false), 2_000)),
  ]);
  expect(ended).toBe(true);
});

test("a caller that hangs up while its relay's target is looked up opens nothing", async () => {
  const { body: root } = await spawn({ spawn: false });
  let connections = 0;
  const agent = http.createServer((_req, res) => res.end());
  agent.on("connection", () => connections++);
  agents.set(`jen-agent-${root.id}`, await listen(agent));
  // Hold the lookup until the caller's connection has closed.
  const closed = new Promise<void>((resolve) => servers[0].once("request", (_req, res) => res.once("close", resolve)));
  const target = runtime.target.bind(runtime);
  vi.spyOn(runtime, "target").mockImplementation(async (...args) => (await closed, target(...args)));
  const abort = new AbortController();
  const req = call(`/agents/${root.id}/events`, { signal: abort.signal }).catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, 20));
  abort.abort();
  await req;
  await closed;
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(connections).toBe(0);
});

test("watching a stopped agent gets 409 and doesn't wake it", async () => {
  const { body: root } = await spawn({ spawn: false });
  await call(`/agents/${root.id}/stop`, { method: "POST" });
  expect((await call(`/agents/${root.id}/events`)).status).toBe(409);
  expect((await runtime.get(null, root.id)).state).toBe("stopped");
});

test("a relay to an agent that can't be reached gets 502", async () => {
  const { body: root } = await spawn({ spawn: false });
  const res = await call(`/agents/${root.id}/messages`, { method: "POST", body: '{"text":"hi"}' });
  expect(res.status).toBe(502);
});

describe("a root agent's page and UI", () => {
  test("the page relays to a running root with workspace with no token", async () => {
    const { body: root } = await spawn({ spawn: false, workspace: true });
    await serveAgent(root.id, []);
    const res = await fetch(`${base}/agents/${root.id}/page`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(res.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(await res.text()).toBe(PAGE);
  });

  test("a stopped root, a sub-agent, a root without workspace and an unknown ID all get the same 404, and nothing starts", async () => {
    const { body: stopped } = await spawn({ spawn: false, workspace: true });
    await call(`/agents/${stopped.id}/stop`, { method: "POST" });
    const { body: lead } = await spawn({ spawn: true, workspace: true });
    const { body: sub } = await spawn({ spawn: false, workspace: true }, as(tokenOf(lead.id)));
    const { body: bare } = await spawn({ spawn: true });
    for (const id of [sub.id, bare.id]) await serveAgent(id, []);
    const containers = docker.containers.size;
    for (const id of [stopped.id, sub.id, bare.id, "0123456789ab", "owner"]) {
      const res = await fetch(`${base}/agents/${id}/page`);
      expect(res.status, id).toBe(404);
      expect(await res.json()).toEqual({ error: `no UI for agent ${id}` });
    }
    expect(docker.containers.size).toBe(containers);
    expect((await runtime.get(null, stopped.id)).state).toBe("stopped");
  });

  test("the UI is relayed to a caller that reaches the agent", async () => {
    const { body: root } = await spawn({ spawn: false, workspace: true });
    await serveAgent(root.id, []);
    const res = await call(`/agents/${root.id}/ui`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ version: 0, document: TEXTBOX });
  });

  test("the UI needs a token that reaches the agent", async () => {
    const { body: root } = await spawn({ spawn: true, workspace: true });
    const { body: other } = await spawn({ spawn: false, workspace: true });
    await serveAgent(root.id, []);
    expect((await fetch(`${base}/agents/${root.id}/ui`)).status).toBe(401);
    expect((await fetch(`${base}/agents/${root.id}/ui`, { headers: as(tokenOf(other.id)) })).status).toBe(404);
  });

  test("the UI of a sub-agent or of a root without workspace gets 403", async () => {
    const { body: lead } = await spawn({ spawn: true, workspace: true });
    const { body: sub } = await spawn({ spawn: false, workspace: true }, as(tokenOf(lead.id)));
    const { body: bare } = await spawn({ spawn: false });
    for (const id of [sub.id, bare.id]) {
      await serveAgent(id, []);
      expect((await call(`/agents/${id}/ui`)).status, id).toBe(403);
    }
  });
});

test("an unknown route gets 404", async () => {
  for (const [method, path] of [
    ["GET", "/nothing"],
    ["PUT", "/agents"],
    ["GET", "/agents/"],
    ["POST", "/agents/x/y/z"],
    ["GET", "/agents/x/stop"],
  ]) {
    expect((await call(path, { method })).status, `${method} ${path}`).toBe(404);
  }
});

describe("POST /workspace/commands", () => {
  // An agent with a workspace, whose commands script runs. Kills are recorded.
  async function workspace() {
    const { body: agent } = await spawn({ workspace: true });
    const kills: string[][] = [];
    const script = { run: (exec: FakeExec) => (exec.write("7 15\n0 2\nhi"), exec.end()) };
    docker.onExec = (exec) => (exec.spec.cmd[0] === "kill" ? (kills.push(exec.spec.cmd.slice(3)), exec.end()) : script.run(exec));
    const post = (body: string, init: RequestInit = {}) => fetch(`${base}/workspace/commands`, { method: "POST", headers: as(tokenOf(agent.id)), body, ...init });
    return { agent, kills, script, post };
  }

  test("runs the command and answers with its result", async () => {
    const { post } = await workspace();
    const res = await post(JSON.stringify({ command: "echo -n hi", timeout: 5 }));
    expect([res.status, await res.json()]).toEqual([200, { exitCode: 0, output: "hi", timedOut: false }]);
  });

  test("a cut is in the answer", async () => {
    const { post, script } = await workspace();
    script.run = (exec) => (exec.write(`7 15\n1 9000\n${"x".repeat(8192)}`), exec.end());
    const body = await (await post(JSON.stringify({ command: "seq 9000" }))).json();
    expect(body).toEqual({ exitCode: 1, output: "x".repeat(8192), timedOut: false, cut: { bytes: 9000, file: expect.stringMatching(/^\/home\/agent\/\.jen\/output\//) } });
  });

  test("a missing timeout is 120 seconds, and extra fields change nothing", async () => {
    const { post } = await workspace();
    const run = vi.spyOn(runtime, "runCommand");
    await post(JSON.stringify({ command: "true" }));
    await post(JSON.stringify({ command: "true", user: "root", image: "evil", workdir: "/" }));
    expect(run.mock.calls.map(([, command, timeout]) => [command, timeout])).toEqual([["true", 120], ["true", 120]]);
    const [first, second] = docker.execs.filter((e) => e.spec.cmd[0] === "bash");
    expect({ ...second!.spec, cmd: second!.spec.cmd.slice(0, 5) }).toEqual({ ...first!.spec, cmd: first!.spec.cmd.slice(0, 5) });
  });

  test("the owner gets 404 and an agent without workspace 403", async () => {
    await workspace();
    const { body: plain } = await spawn({ spawn: true });
    expect((await call("/workspace/commands", { method: "POST", body: '{"command":"true"}' })).status).toBe(404);
    expect((await fetch(`${base}/workspace/commands`, { method: "POST", headers: as(tokenOf(plain.id)), body: '{"command":"true"}' })).status).toBe(403);
    expect((await fetch(`${base}/workspace/commands`, { method: "POST", body: '{"command":"true"}' })).status).toBe(401);
  });

  test("a body that isn't JSON, a command that isn't a string, or a timeout out of range gets 400, and nothing runs", async () => {
    const { post } = await workspace();
    expect((await post("{")).status).toBe(400);
    for (const body of [{}, { command: 5 }, { command: null }, { command: "true", timeout: 0 }, { command: "true", timeout: 601 }, { command: "true", timeout: "5" }]) {
      expect((await post(JSON.stringify(body))).status, JSON.stringify(body)).toBe(400);
    }
    expect((await post(JSON.stringify({ command: "true", timeout: 600 }))).status).toBe(200);
    expect(docker.execs.filter((e) => e.spec.cmd[0] === "bash")).toHaveLength(1);
  });

  test("a body over 64 KiB gets 413 and closes the connection, declared or chunked, and nothing runs", async () => {
    const { agent, post } = await workspace();
    const command = "x".repeat(MAX_COMMAND_BODY);
    const declared = await post(JSON.stringify({ command }));
    expect(declared.status).toBe(413);
    expect(declared.headers.get("connection")).toBe("close");
    // Within the bound, and over the spawn route's.
    expect((await post(JSON.stringify({ command: "x".repeat(MAX_BODY * 2) }))).status).toBe(200);
    const { port } = new URL(base);
    const status = await new Promise<number | undefined>((resolve) => {
      const req = http.request({ host: "127.0.0.1", port, method: "POST", path: "/workspace/commands", headers: as(tokenOf(agent.id)) });
      let status: number | undefined;
      req.on("error", () => {});
      req.on("response", (res) => ((status = res.statusCode), res.resume()));
      req.on("close", () => resolve(status));
      req.write(Buffer.alloc(MAX_COMMAND_BODY + 1, 32));
    });
    expect(status).toBe(413);
    expect(docker.execs.filter((e) => e.spec.cmd[0] === "bash")).toHaveLength(1);
  });

  test("a client that stays connected gets a delayed answer, and nothing is killed", async () => {
    const { post, script, kills } = await workspace();
    script.run = (exec) => setTimeout(() => (exec.write("7 15\n0 5\ndone\n"), exec.end()), 300);
    const res = await post(JSON.stringify({ command: "sleep 3; echo done" }));
    expect(await res.json()).toEqual({ exitCode: 0, output: "done\n", timedOut: false });
    expect(kills).toEqual([]);
  });

  test("a client that disconnects while it waits kills the command", async () => {
    const { post, script, kills } = await workspace();
    script.run = (exec) => exec.write("7 15\n");
    const abort = new AbortController();
    const res = post(JSON.stringify({ command: "sleep 100" }), { signal: abort.signal }).catch(() => undefined);
    await vi.waitFor(() => expect(docker.execs.some((e) => e.spec.cmd[0] === "bash")).toBe(true));
    abort.abort();
    await res;
    await vi.waitFor(() => expect(kills).toEqual([["-15"]]));
  });

  test("a client that disconnects while its body arrives runs nothing", async () => {
    const { agent } = await workspace();
    const { port } = new URL(base);
    const req = http.request({ host: "127.0.0.1", port, method: "POST", path: "/workspace/commands", headers: { ...as(tokenOf(agent.id)), "Content-Length": "100" } });
    req.on("error", () => {});
    req.write('{"command":');
    await new Promise((resolve) => setTimeout(resolve, 50));
    req.destroy();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(docker.execs).toEqual([]);
  });
});

describe("GET and PUT /workspace/files", () => {
  // An agent with a workspace, whose file execs script answers. By default a
  // read answers with the bytes last written, and a write keeps its input.
  async function workspace() {
    const { body: agent } = await spawn({ workspace: true });
    let stored: Buffer = Buffer.alloc(0);
    const script = {
      run: (exec: FakeExec) => {
        if (exec.input !== undefined) {
          stored = exec.input;
          exec.write("ok\n");
        } else exec.write(Buffer.concat([Buffer.from(`ok ${stored.length}\n`), stored]));
        exec.end();
      },
    };
    docker.onExec = (exec) => script.run(exec);
    const url = (path: string) => `${base}/workspace/files?path=${encodeURIComponent(path)}`;
    const headers = as(tokenOf(agent.id));
    return { agent, script, url, headers };
  }
  const bytes = Buffer.from(Array.from({ length: 256 }, (_, i) => i));

  test("a binary body passes through unchanged both ways", async () => {
    const { url, headers } = await workspace();
    const put = await fetch(url("data/bytes.bin"), { method: "PUT", headers, body: bytes });
    expect(put.status).toBe(204);
    expect(docker.execs[0]!.spec.cmd.slice(4)).toEqual(["data/bytes.bin", "256"]);
    const get = await fetch(url("data/bytes.bin"), { headers });
    expect(get.status).toBe(200);
    expect(get.headers.get("content-type")).toBe("application/octet-stream");
    expect(Buffer.from(await get.arrayBuffer())).toEqual(bytes);
    expect(docker.execs[1]!.spec.cmd[4]).toBe("data/bytes.bin");
  });

  test("the path is read from the query, decoded, with any other fields ignored", async () => {
    const { headers } = await workspace();
    await fetch(`${base}/workspace/files?x=1&path=${encodeURIComponent("a b/ü?&=.txt")}&y=2`, { method: "PUT", headers, body: "hi" });
    expect(docker.execs[0]!.spec.cmd[4]).toBe("a b/ü?&=.txt");
  });

  test("a missing, empty, NUL-holding or over-4-KiB path gets 400, and nothing runs", async () => {
    const { url, headers } = await workspace();
    for (const target of [`${base}/workspace/files`, `${base}/workspace/files?path=`, url("a\0b"), url("a".repeat(4097)), url("é".repeat(2049))]) {
      expect((await fetch(target, { headers })).status, target.slice(0, 80)).toBe(400);
      expect((await fetch(target, { method: "PUT", headers, body: "x" })).status).toBe(400);
    }
    expect((await fetch(url("a".repeat(4096)), { headers })).status).toBe(200);
    expect(docker.execs).toHaveLength(1);
  });

  test("the owner gets 404 and an agent without workspace 403", async () => {
    const { url } = await workspace();
    const { body: plain } = await spawn({ spawn: true });
    expect((await call("/workspace/files?path=a")).status).toBe(404);
    expect((await fetch(url("a"), { method: "PUT", headers: as(tokenOf(plain.id)), body: "x" })).status).toBe(403);
    expect((await fetch(url("a"))).status).toBe(401);
    expect(docker.execs).toEqual([]);
  });

  test("the workspace's refusals keep their status and message", async () => {
    const { url, headers, script } = await workspace();
    script.run = (exec) => (exec.write("missing\n"), exec.end());
    expect([(await fetch(url("nope"), { headers })).status]).toEqual([404]);
    script.run = (exec) => (exec.write("error Permission denied\n"), exec.end());
    const res = await fetch(url("ro.txt"), { method: "PUT", headers, body: "x" });
    expect([res.status, await res.json()]).toEqual([400, { error: "Permission denied" }]);
  });

  test("a body declaring 17 MiB gets 413 unread and closes the connection, and nothing runs", async () => {
    const { agent } = await workspace();
    const { port } = new URL(base);
    const answer = await new Promise<{ status?: number; connection?: string }>((resolve) => {
      const req = http.request({ host: "127.0.0.1", port, method: "PUT", path: "/workspace/files?path=big", headers: { ...as(tokenOf(agent.id)), "Content-Length": String(17 * 2 ** 20) } });
      req.on("error", () => {});
      req.on("response", (res) => (resolve({ status: res.statusCode, connection: res.headers.connection }), res.resume()));
      req.write("x");
    });
    expect(answer).toEqual({ status: 413, connection: "close" });
    expect(docker.execs).toEqual([]);
  });

  test("a chunked body over 16 MiB gets 413, and nothing runs", async () => {
    const { agent } = await workspace();
    const { port } = new URL(base);
    const status = await new Promise<number | undefined>((resolve) => {
      const req = http.request({ host: "127.0.0.1", port, method: "PUT", path: "/workspace/files?path=big", headers: as(tokenOf(agent.id)) });
      let status: number | undefined;
      req.on("error", () => {});
      req.on("response", (res) => ((status = res.statusCode), res.resume()));
      req.on("close", () => resolve(status));
      req.write(Buffer.alloc(16 * 2 ** 20 + 1));
    });
    expect(status).toBe(413);
    expect(docker.execs).toEqual([]);
  });

  test("a caller that hangs up aborts the call", async () => {
    const { url, headers, script } = await workspace();
    script.run = () => {};
    const abort = new AbortController();
    const res = fetch(url("a"), { headers, signal: abort.signal }).catch(() => undefined);
    await vi.waitFor(() => expect(docker.execs).toHaveLength(1));
    abort.abort();
    await res;
    await vi.waitFor(() => expect(docker.execs[0]!.stopped).toBe("aborted"));
  });

  test("other methods have no route", async () => {
    const { url, headers } = await workspace();
    expect((await fetch(url("a"), { method: "POST", headers, body: "x" })).status).toBe(404);
    expect((await fetch(url("a"), { method: "DELETE", headers })).status).toBe(404);
  });
});

describe("POST /model/responses", () => {
  // A request in the adapter's shape, with one of each kind of input item.
  const valid = () => ({
    model: "agent-model",
    instructions: "be brief",
    input: [
      { role: "user", content: "From: owner\n\nwhat is a?" },
      { type: "function_call", call_id: "c1", name: "lookup", arguments: '{"key":"a"}' },
      { type: "function_call_output", call_id: "c1", output: "42" },
      { role: "assistant", content: "a is 42" },
    ],
    tools: [{ type: "function", name: "lookup", description: "Look up a key.", parameters: { type: "object", properties: { key: { type: "string" } } }, strict: false }],
    store: false,
  });
  async function agent() {
    const { body: root } = await spawn({ spawn: false });
    return { root, headers: as(tokenOf(root.id)) };
  }
  const post = (headers: Record<string, string>, body: unknown, path = "/model/responses") =>
    fetch(`${base}${path}`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });

  test("sends an agent's call to the provider with the owner's key, the runtime's model and none of the agent's headers", async () => {
    const { headers } = await agent();
    const res = await post({ ...headers, "X-Stainless-Lang": "js", Cookie: "a=b", "OpenAI-Organization": "org-x" }, valid());
    expect([res.status, await res.json()]).toEqual([200, { ok: true }]);
    expect(provided).toHaveLength(1);
    expect(provided[0]!.url).toBe("https://provider.test/v1/responses");
    expect(Object.fromEntries(provided[0]!.headers)).toEqual({ authorization: "Bearer sk-owner", "content-type": "application/json", accept: "application/json" });
    expect(provided[0]!.body).toEqual({ ...valid(), model: "runtime-model" });
  });

  test("sends the checked body serialized again, not the agent's bytes", async () => {
    const { headers } = await agent();
    const raw = JSON.stringify(valid()).replace('"store":false', '"store":true, "store" :  false');
    expect((await post(headers, raw)).status).toBe(200);
    expect(provided[0]!.raw).toBe(JSON.stringify({ ...valid(), model: "runtime-model" }));
  });

  test("goes to OpenAI's endpoint when no base URL is set", async () => {
    const { headers } = await agent();
    const other = await listen(createRuntimeServer({ runtime, ownerToken, model: { model: "runtime-model", apiKey: "sk-owner" }, fetch: stubFetch }));
    expect((await fetch(`${other}/model/responses`, { method: "POST", headers, body: JSON.stringify(valid()) })).status).toBe(200);
    expect(provided[0]!.url).toBe("https://api.openai.com/v1/responses");
  });

  test("accepts an empty input and no tools", async () => {
    const { headers } = await agent();
    expect((await post(headers, { ...valid(), input: [], tools: [] })).status).toBe(200);
  });

  test("the owner gets 403, and a missing token 401, and nothing reaches the provider", async () => {
    const owners = await post(owner, valid());
    expect([owners.status, await owners.json()]).toEqual([403, { error: "only an agent may call the model" }]);
    expect((await post({}, valid())).status).toBe(401);
    expect(provided).toEqual([]);
  });

  test("every other path under /model gets 404, and nothing reaches the provider", async () => {
    const { headers } = await agent();
    for (const path of ["/model/files", "/model", "/model/responses/r1", "/model/chat/completions"]) {
      expect((await post(headers, valid(), path)).status, path).toBe(404);
    }
    expect((await fetch(`${base}/model/responses`, { headers })).status).toBe(404);
    expect(provided).toEqual([]);
  });

  test("a body declaring over 32 MiB gets 413 unread, and a chunked one too, and nothing reaches the provider", async () => {
    const { headers } = await agent();
    const { port } = new URL(base);
    const declared = await new Promise<{ status?: number; connection?: string }>((resolve) => {
      const req = http.request({ host: "127.0.0.1", port, method: "POST", path: "/model/responses", headers: { ...headers, "Content-Length": String(MAX_MODEL_BODY + 1) } });
      req.on("error", () => {});
      req.on("response", (res) => (resolve({ status: res.statusCode, connection: res.headers.connection }), res.resume()));
      req.write("{");
    });
    expect(declared).toEqual({ status: 413, connection: "close" });
    const chunked = await new Promise<number | undefined>((resolve) => {
      const req = http.request({ host: "127.0.0.1", port, method: "POST", path: "/model/responses", headers });
      let status: number | undefined;
      req.on("error", () => {});
      req.on("response", (res) => ((status = res.statusCode), res.resume()));
      req.on("close", () => resolve(status));
      req.write(Buffer.alloc(MAX_MODEL_BODY + 1, " "));
    });
    expect(chunked).toBe(413);
    expect(provided).toEqual([]);
  });

  test("a call uploading while its agent is stopped gets 401, and nothing reaches the provider", async () => {
    const { root, headers } = await agent();
    const identified = vi.spyOn(runtime, "identify");
    const req = http.request(`${base}/model/responses`, { method: "POST", headers });
    const answered = new Promise<http.IncomingMessage>((resolve) => req.on("response", resolve));
    const body = JSON.stringify(valid());
    req.write(body.slice(0, 10));
    req.flushHeaders();
    await vi.waitFor(() => expect(identified).toHaveBeenCalled());
    await call(`/agents/${root.id}/stop`, { method: "POST" });
    req.end(body.slice(10));
    const res = await answered;
    res.resume();
    expect(res.statusCode).toBe(401);
    expect(provided).toEqual([]);
  });

  // Each refusal: what's changed from the valid request, and the field the
  // error names.
  const refusals: [string, (body: any) => unknown, string][] = [
    ["a body that isn't an object", () => [valid()], "the body must be a JSON object"],
    ["an unknown field", (b) => ({ ...b, previous_response_id: "resp_1" }), "previous_response_id is not accepted"],
    ["streaming", (b) => ({ ...b, stream: true }), "stream is not accepted"],
    ["included extras", (b) => ({ ...b, include: ["file_search_call.results"] }), "include is not accepted"],
    ["a missing field", ({ instructions, ...b }) => b, "instructions is required"],
    ["a model that isn't a string", (b) => ({ ...b, model: 1 }), "model must be a string"],
    ["instructions that aren't a string", (b) => ({ ...b, instructions: null }), "instructions must be a string"],
    ["storage on", (b) => ({ ...b, store: true }), "store must be false"],
    ["input that isn't an array", (b) => ({ ...b, input: "hi" }), "input must be an array"],
    ["an image by URL", (b) => ({ ...b, input: [{ role: "user", content: [{ type: "input_image", image_url: "https://example.com/a.png" }] }] }), "input[0].content must be a string"],
    ["a file by URL", (b) => ({ ...b, input: [{ role: "user", content: [{ type: "input_file", file_url: "https://example.com/a.pdf" }] }] }), "input[0].content must be a string"],
    ["a system message", (b) => ({ ...b, input: [{ role: "system", content: "x" }] }), 'input[0].role must be "user" or "assistant"'],
    ["a typed message", (b) => ({ ...b, input: [{ type: "message", role: "user", content: "x" }] }), 'input[0].type must be "function_call" or "function_call_output", or absent for a message'],
    ["a message with an ID", (b) => ({ ...b, input: [{ role: "user", content: "x", id: "msg_1" }] }), "input[0].id is not accepted"],
    ["a stored item by reference", (b) => ({ ...b, input: [{ type: "item_reference", id: "rs_1" }] }), 'input[0].type must be "function_call" or "function_call_output", or absent for a message'],
    ["a function call with object arguments", (b) => ({ ...b, input: [{ type: "function_call", call_id: "c1", name: "f", arguments: {} }] }), "input[0].arguments must be a string"],
    ["a function call missing its ID", (b) => ({ ...b, input: [{ type: "function_call", name: "f", arguments: "{}" }] }), "input[0].call_id is required"],
    ["a function output with a status", (b) => ({ ...b, input: [{ type: "function_call_output", call_id: "c1", output: "x", status: "completed" }] }), "input[0].status is not accepted"],
    ["a function output that isn't text", (b) => ({ ...b, input: [{ type: "function_call_output", call_id: "c1", output: [{ type: "input_image", image_url: "https://example.com/a.png" }] }] }), "input[0].output must be a string"],
    ["a later item that doesn't fit", (b) => ({ ...b, input: [...b.input, null] }), "input[4] must be an object"],
    ["tools that aren't an array", (b) => ({ ...b, tools: {} }), "tools must be an array"],
    ["a hosted tool", (b) => ({ ...b, tools: [{ type: "web_search" }] }), 'tools[0].type must be "function"'],
    ["a remote MCP server", (b) => ({ ...b, tools: [{ type: "mcp", server_label: "x", server_url: "https://example.com/mcp" }] }), "tools[0].server_label is not accepted"],
    ["a tool with parameters that aren't an object", (b) => ({ ...b, tools: [{ ...b.tools[0], parameters: [] }] }), "tools[0].parameters must be an object"],
    ["a tool whose strict isn't a boolean", (b) => ({ ...b, tools: [{ ...b.tools[0], strict: "no" }] }), "tools[0].strict must be a boolean"],
    ["a tool with an extra field", (b) => ({ ...b, tools: [{ ...b.tools[0], defer_loading: true }] }), "tools[0].defer_loading is not accepted"],
  ];
  for (const [name, change, error] of refusals) {
    test(`${name} gets 400 naming it, and nothing reaches the provider`, async () => {
      const { headers } = await agent();
      const res = await post(headers, change(valid()));
      expect([res.status, await res.json()]).toEqual([400, { error }]);
      expect(provided).toEqual([]);
    });
  }

  test("a body that isn't JSON gets 400", async () => {
    const { headers } = await agent();
    const res = await post(headers, '{"model":');
    expect([res.status, await res.json()]).toEqual([400, { error: "the body is not JSON" }]);
    expect(provided).toEqual([]);
  });

  test("the request the adapter builds is accepted unchanged but for the model, and its answer read", async () => {
    const { headers } = await agent();
    provider = () =>
      Response.json({
        id: "resp_1",
        object: "response",
        created_at: 0,
        model: "runtime-model",
        status: "completed",
        output: [{ type: "message", id: "msg_1", role: "assistant", status: "completed", content: [{ type: "output_text", text: "done", annotations: [] }] }],
      });
    // The adapter as an agent builds it, at the runtime, with its token.
    const sent: Record<string, unknown>[] = [];
    const adapter = new OpenAIResponsesModel({
      model: "agent-model",
      apiKey: headers.Authorization.slice("Bearer ".length),
      baseURL: `${base}/model`,
      fetch: (async (url: string | URL | Request, init?: RequestInit) => {
        sent.push(JSON.parse(String(init?.body)));
        return fetch(url, init);
      }) as typeof globalThis.fetch,
    });
    const reply = await adapter.next(
      [
        { type: "message", role: "user", from: "owner", text: "what is a?" },
        { type: "tool_call", id: "c1", name: "lookup", input: { key: "a" } },
        { type: "tool_result", callId: "c1", output: "42" },
        { type: "message", role: "assistant", text: "a is 42" },
        { type: "message", role: "user", from: "a1b2c3d4e5f6", text: "thanks" },
      ],
      [{ name: "lookup", description: "Look up a key.", inputSchema: { type: "object", properties: { key: { type: "string" } }, required: ["key"] } }],
      "be brief",
    );
    expect(reply).toEqual([assistant("done")]);
    expect(sent).toHaveLength(1);
    expect(provided).toHaveLength(1);
    expect(provided[0]!.body).toEqual({ ...sent[0], model: "runtime-model" });
  });

  test("the provider's status, headers and body pass back, less hop-by-hop and decoded-encoding headers", async () => {
    const { headers } = await agent();
    // What fetch hands back for a compressed answer: the decoded body, with
    // the headers that described the compressed one.
    provider = () =>
      new Response('{"error":{"message":"slow down"}}', {
        status: 429,
        headers: { "content-type": "application/json", "retry-after": "7", "content-encoding": "gzip", "content-length": "12", "keep-alive": "timeout=99", "x-request-id": "req_1" },
      });
    const res = await post(headers, valid());
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("7");
    expect(res.headers.get("x-request-id")).toBe("req_1");
    expect(res.headers.get("content-encoding")).toBeNull();
    expect(res.headers.get("keep-alive")).not.toBe("timeout=99");
    expect(await res.json()).toEqual({ error: { message: "slow down" } });
  });

  test("a gzipped answer from a real provider reaches the agent decoded", async () => {
    const { headers } = await agent();
    const answer = JSON.stringify({ text: "x".repeat(10_000) });
    let acceptEncoding: string | undefined;
    const upstream = await listen(
      http.createServer((req, res) => {
        acceptEncoding = req.headers["accept-encoding"];
        req.resume();
        const zipped = gzipSync(answer);
        res.writeHead(200, { "content-type": "application/json", "content-encoding": "gzip", "content-length": zipped.length }).end(zipped);
      }),
    );
    const other = await listen(createRuntimeServer({ runtime, ownerToken, model: { ...modelSettings, baseURL: upstream } }));
    const res = await fetch(`${other}/model/responses`, { method: "POST", headers: { ...headers, "Accept-Encoding": "identity" }, body: JSON.stringify(valid()) });
    expect(acceptEncoding).toContain("gzip");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-encoding")).toBeNull();
    expect(await res.text()).toBe(answer);
  });

  test("an agent that hangs up aborts the provider's call", async () => {
    const { headers } = await agent();
    provider = (call) => new Promise((_, reject) => call.signal.addEventListener("abort", () => reject(call.signal.reason)));
    const abort = new AbortController();
    const res = fetch(`${base}/model/responses`, { method: "POST", headers, body: JSON.stringify(valid()), signal: abort.signal }).catch(() => undefined);
    await vi.waitFor(() => expect(provided).toHaveLength(1));
    expect(provided[0]!.signal.aborted).toBe(false);
    abort.abort();
    await res;
    await vi.waitFor(() => expect(provided[0]!.signal.aborted).toBe(true));
  });

  test("a provider that can't be reached gets 502", async () => {
    const { headers } = await agent();
    const other = await listen(createRuntimeServer({ runtime, ownerToken, model: { ...modelSettings, baseURL: "http://127.0.0.1:1" } }));
    const res = await fetch(`${other}/model/responses`, { method: "POST", headers, body: JSON.stringify(valid()) });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: expect.stringMatching(/^the model provider could not be reached: /) });
  });
});
