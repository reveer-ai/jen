// Sends a message to one container, then asks a new container on the same
// volume to recall it, over the agent's protocol, reading each reply from the
// event stream. The check plays the runtime's part: it sets each message's
// sender and the agent's identity, as a root agent with no grant to spawn,
// and serves a stand-in for the runtime's model route on the host, which adds
// the key and forwards the call to the provider, so the container holds no
// key. Uses the same JEN_LIVE_* variables as the adapter's live check.
// Skipped when the key or model is missing; with them set, a missing Docker
// fails the check.
//
// Vitest can't interrupt a synchronous child, so each Docker command has its
// own deadline, and together they fit inside the test's timeout.

import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { expect, test } from "vitest";
import type { Item } from "./model/port.ts";
import { replies } from "./model/replies.ts";

const apiKey = process.env.JEN_LIVE_API_KEY;
const model = process.env.JEN_LIVE_MODEL;
const baseURL = process.env.JEN_LIVE_BASE_URL;

test.skipIf(!apiKey || !model)("a new container on the same volume recalls the first exchange", { timeout: 600_000 }, async () => {
  docker(["build", "--target", "agent", "-t", "jen-agent", join(import.meta.dirname, "../..")], { timeout: 240_000 });
  // The agent image holds the agent and none of the runtime.
  expect(docker(["run", "--rm", "--entrypoint", "ls", "jen-agent", "src"]).trim().split("\n")).toEqual(["agent"]);
  const volume = `jen-live-${randomBytes(4).toString("hex")}`;
  const token = randomBytes(32).toString("hex");
  const containers: string[] = [];
  const proxy = await serveProxy(token);
  docker(["volume", "create", volume]);
  try {
    let base = await start(volume, token, proxy.port, containers);
    expect((await fetch(`${base}/events`)).status).toBe(401);

    const word = `jen-${randomBytes(4).toString("hex")}`;
    const remember = `Remember this word: ${word}. Reply only with OK.`;
    await send(base, token, remember);
    const first = await reply(`${base}/events`, token, 0);
    docker(["rm", "-f", containers.at(-1)!]);

    base = await start(volume, token, proxy.port, containers);
    const recall = "What was the word I asked you to remember? Reply with just the word.";
    await send(base, token, recall);
    const second = await reply(`${base}/events`, token, first.events.at(-1)!.id);
    expect(second.text).toContain(word);

    // Both messages, in order and from the owner, with the first exchange
    // before the second. The replies' wording is the model's.
    expect(first.events[0]!.item).toEqual({ type: "message", role: "user", from: "owner", text: remember });
    expect(second.events[0]!.item).toEqual({ type: "message", role: "user", from: "owner", text: recall });
    // Every model call went through the stand-in, one or more a turn.
    expect(proxy.calls()).toBeGreaterThanOrEqual(2);
  } finally {
    for (const container of containers) spawnSync("docker", ["rm", "-f", container], { timeout: 30_000 });
    docker(["volume", "rm", volume]);
    proxy.server.closeAllConnections();
    proxy.server.close();
  }
});

// A stand-in for the runtime's model route: POST /model/responses with the
// agent's token is sent on to the provider with the key, and its answer
// passed back. It listens on every interface, since on Linux the container
// reaches the host at the bridge's gateway, so it takes only the agent's
// token. calls counts the calls forwarded.
async function serveProxy(token: string) {
  let forwarded = 0;
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", async () => {
      if (req.method !== "POST" || req.url !== "/model/responses") return void res.writeHead(404).end();
      if (req.headers.authorization !== `Bearer ${token}`) return void res.writeHead(401).end();
      forwarded++;
      try {
        const answer = await fetch(`${(baseURL ?? "https://api.openai.com/v1").replace(/\/+$/, "")}/responses`, {
          method: "POST",
          headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json", accept: "application/json" },
          body: Buffer.concat(chunks),
        });
        res.writeHead(answer.status, { "content-type": answer.headers.get("content-type") ?? "application/json" }).end(Buffer.from(await answer.arrayBuffer()));
      } catch (error) {
        res.writeHead(502, { "content-type": "application/json" }).end(JSON.stringify({ error: String(error) }));
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "0.0.0.0", resolve));
  return { server, port: (server.address() as AddressInfo).port, calls: () => forwarded };
}

// Starts the agent detached on a random port bound to 127.0.0.1, with the
// stand-in proxy as its runtime and no key, and returns its address once it
// accepts connections. The token is passed by name, so it stays off the
// command line. host.docker.internal is added so Linux has it too.
async function start(volume: string, token: string, proxyPort: number, containers: string[]): Promise<string> {
  const identity = { JEN_AGENT_ID: "a1b2c3d4e5f6", JEN_PARENT: "owner", JEN_GRANT: '{"spawn":false}' };
  const env = { ...process.env, JEN_MODEL: model, JEN_TOKEN: token, JEN_RUNTIME_URL: `http://host.docker.internal:${proxyPort}`, ...identity };
  const names = ["JEN_MODEL", "JEN_TOKEN", "JEN_RUNTIME_URL", ...Object.keys(identity)];
  const container = `${volume}-${randomBytes(4).toString("hex")}`;
  containers.push(container);
  const args = ["run", "-d", "--name", container, "-p", "127.0.0.1::8080", "--add-host", "host.docker.internal:host-gateway", "-v", `${volume}:/state`, ...names.flatMap((n) => ["-e", n]), "jen-agent"];
  docker(args, { env });
  const port = docker(["port", container, "8080/tcp"]).trim().split(":").at(-1);
  const base = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      await fetch(base);
      return base;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  throw new Error(`the agent in ${container} never accepted connections`);
}

// Sends a message from the owner, and returns once it's saved.
async function send(base: string, token: string, text: string) {
  const res = await fetch(`${base}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Jen-From": "owner" },
    body: JSON.stringify({ text }),
    signal: AbortSignal.timeout(30_000),
  });
  if (res.status !== 202) throw new Error(`POST /messages got ${res.status}: ${await res.text()}`);
}

type Event = { id: number; item: Item };

// Reads item events after position after until done holds of what's arrived,
// and then until no item has arrived for quietMs.
async function readEvents(url: string, token: string, after: number, done: (events: Event[]) => boolean, quietMs = 0): Promise<Event[]> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 150_000);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, "Last-Event-ID": String(after) }, signal: abort.signal });
  if (res.status !== 200) throw new Error(`GET /events got ${res.status}`);
  const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
  const events: Event[] = [];
  let buffer = "";
  try {
    for (;;) {
      const ready = done(events);
      if (ready && quietMs === 0) return events;
      const next = reader.read();
      const chunk = ready ? await Promise.race([next, new Promise<undefined>((resolve) => setTimeout(resolve, quietMs))]) : await next;
      if (chunk === undefined) return events;
      if (chunk.done) throw new Error(`the stream ended after ${events.length} items`);
      buffer += chunk.value;
      let end;
      while ((end = buffer.indexOf("\n\n")) >= 0) {
        const block = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const id = block.match(/^id: (.*)$/m)?.[1];
        const data = block.match(/^data: (.*)$/m)?.[1];
        if (/^event: item$/m.test(block) && id && data) events.push({ id: Number(id), item: JSON.parse(data) });
      }
    }
  } finally {
    clearTimeout(timer);
    abort.abort();
  }
}

// Waits for the agent's reply to what came after position after, and then
// for its turn to go quiet. Returns the reply's text and the events read.
async function reply(url: string, token: string, after: number): Promise<{ text: string; events: Event[] }> {
  const events = await readEvents(url, token, after, (events) => replies(events.map((e) => e.item)).length > 0, 5_000);
  return { text: replies(events.map((e) => e.item)).join("\n"), events };
}

function docker(args: string[], { env, timeout = 30_000 }: { env?: NodeJS.ProcessEnv; timeout?: number } = {}): string {
  const result = spawnSync("docker", args, { encoding: "utf8", env, timeout });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`docker ${args[0]} exited ${result.status}: ${result.stderr}`);
  return result.stdout;
}
