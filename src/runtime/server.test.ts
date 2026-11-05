import { mkdtempSync, rmSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { openStore, type Store } from "../agent/store.ts";
import type { Item } from "../agent/model/port.ts";
import { ScriptedModel } from "../agent/model/scripted.ts";
import { Agent } from "../agent/loop.ts";
import { createServer as createAgentServer } from "../agent/server.ts";
import { DockerError } from "./docker.ts";
import { FakeDocker } from "./fake-docker.ts";
import { Runtime } from "./runtime.ts";
import { createRuntimeServer, MAX_BODY } from "./server.ts";

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
    model: { model: "m", apiKey: "k" },
    maxDepth: 3,
    maxAgents: 10,
    agentURL: (container) => agents.get(container) ?? "http://127.0.0.1:1",
    // Each test serves an agent's protocol only after spawning it.
    ready: async () => {},
  });
  await runtime.startup(self.id);
  base = await listen(createRuntimeServer({ runtime, ownerToken }));
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
  expect(body).toEqual({ id: expect.any(String), parent: null, grant: { spawn: true }, state: "running" });
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
    const { image, network, maxRetries, volume, env } = docker.find(`jen-agent-${id}`)!.spec!;
    return { image, network, maxRetries, path: volume.path, env: env.filter((e) => !e.startsWith("JEN_TOKEN=") && !e.startsWith("JEN_AGENT_ID=")) };
  };
  expect(settings(extra.id)).toEqual(settings(plain.id));
});

test("a spawn body that isn't JSON or has a bad grant gets 400", async () => {
  expect((await call("/agents", { method: "POST", body: "{" })).status).toBe(400);
  for (const grant of [undefined, null, [], {}, { spawn: "yes" }, { spawn: true, docker: true }]) {
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
  const res = await call(`/agents/${root.id}/messages`, message(""));
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: "text must be a non-empty string" });
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
