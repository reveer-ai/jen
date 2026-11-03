// Sends a message to one container, then asks a new container on the same
// volume to recall it, over the agent's protocol. Uses the same JEN_LIVE_*
// variables as the adapter's live check. Skipped when the key or model is
// missing; with them set, a missing Docker fails the check.
//
// Vitest can't interrupt a synchronous child, so each Docker command has its
// own deadline, and together they fit inside the test's timeout.

import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { expect, test } from "vitest";
import type { Item } from "./model/port.ts";

const apiKey = process.env.JEN_LIVE_API_KEY;
const model = process.env.JEN_LIVE_MODEL;
const baseURL = process.env.JEN_LIVE_BASE_URL;

test.skipIf(!apiKey || !model)("a new container on the same volume recalls the first turn", { timeout: 600_000 }, async () => {
  docker(["build", "--target", "agent", "-t", "jen-agent", join(import.meta.dirname, "../..")], { timeout: 240_000 });
  // The agent image holds the agent and none of the runtime.
  expect(docker(["run", "--rm", "--entrypoint", "ls", "jen-agent", "src"]).trim().split("\n")).toEqual(["agent"]);
  const volume = `jen-live-${randomBytes(4).toString("hex")}`;
  const token = randomBytes(32).toString("hex");
  const containers: string[] = [];
  docker(["volume", "create", volume]);
  try {
    let base = await start(volume, token, containers);
    expect((await fetch(`${base}/events`)).status).toBe(401);

    const word = `jen-${randomBytes(4).toString("hex")}`;
    const remember = `Remember this word: ${word}. Reply only with OK.`;
    await send(base, token, remember);
    docker(["rm", "-f", containers.at(-1)!]);

    base = await start(volume, token, containers);
    const recall = "What was the word I asked you to remember? Reply with just the word.";
    const reply = await send(base, token, recall);
    expect(reply).toContain(word);

    // The two exchanges, in order. The first reply's wording is the model's.
    const [first, second, third, fourth] = await events(base, token, 4);
    expect(first).toEqual({ type: "message", role: "user", text: remember });
    expect(second).toMatchObject({ type: "message", role: "assistant" });
    expect(third).toEqual({ type: "message", role: "user", text: recall });
    expect(fourth).toEqual({ type: "message", role: "assistant", text: reply });
  } finally {
    for (const container of containers) spawnSync("docker", ["rm", "-f", container], { timeout: 30_000 });
    docker(["volume", "rm", volume]);
  }
});

// Starts the agent detached on a random port bound to 127.0.0.1, and returns
// its address once it accepts connections. Credentials are passed by name,
// so they stay off the command line.
async function start(volume: string, token: string, containers: string[]): Promise<string> {
  const env = { ...process.env, JEN_MODEL: model, JEN_API_KEY: apiKey, JEN_BASE_URL: baseURL, JEN_TOKEN: token };
  const names = ["JEN_MODEL", "JEN_API_KEY", "JEN_TOKEN", ...(baseURL ? ["JEN_BASE_URL"] : [])];
  const container = `${volume}-${randomBytes(4).toString("hex")}`;
  containers.push(container);
  const args = ["run", "-d", "--name", container, "-p", "127.0.0.1::8080", "-v", `${volume}:/state`, ...names.flatMap((n) => ["-e", n]), "jen-agent"];
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

async function send(base: string, token: string, text: string): Promise<string> {
  const res = await fetch(`${base}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ text }),
    signal: AbortSignal.timeout(120_000),
  });
  const body = await res.json();
  if (res.status !== 200) throw new Error(`POST /messages got ${res.status}: ${JSON.stringify(body)}`);
  return body.reply;
}

// Reads the event stream until n items have arrived.
async function events(base: string, token: string, n: number): Promise<Item[]> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 30_000);
  const res = await fetch(`${base}/events`, { headers: { Authorization: `Bearer ${token}` }, signal: abort.signal });
  const items: Item[] = [];
  let buffer = "";
  try {
    for await (const chunk of res.body!.pipeThrough(new TextDecoderStream())) {
      buffer += chunk;
      for (const line of buffer.split("\n").slice(0, -1)) {
        if (line.startsWith("data: ")) items.push(JSON.parse(line.slice(6)));
      }
      buffer = buffer.slice(buffer.lastIndexOf("\n") + 1);
      if (items.length >= n) return items;
    }
    throw new Error(`the stream ended after ${items.length} items`);
  } finally {
    clearTimeout(timer);
    abort.abort();
  }
}

function docker(args: string[], { env, timeout = 30_000 }: { env?: NodeJS.ProcessEnv; timeout?: number } = {}): string {
  const result = spawnSync("docker", args, { encoding: "utf8", env, timeout });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`docker ${args[0]} exited ${result.status}: ${result.stderr}`);
  return result.stdout;
}
