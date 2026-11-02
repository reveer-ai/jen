// Runs the runtime against real Docker, under a runtime name of its own, and
// walks the tree through its API: spawn, a refused spawn, the relay, a crash,
// stop, start, a replaced runtime, a second runtime, and delete. Uses the
// same JEN_LIVE_* variables as the other live checks. Skipped when the key or
// model is missing; with them set, a missing Docker fails the check.
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

test.skipIf(!apiKey || !model)("the runtime keeps a tree of agents on Docker", { timeout: 600_000 }, async () => {
  docker(["build", "-t", "jen", join(import.meta.dirname, "..")], { timeout: 240_000 });
  const name = `jen-live-${randomBytes(4).toString("hex")}`;
  const ownerToken = randomBytes(32).toString("hex");
  const owner = { Authorization: `Bearer ${ownerToken}` };
  const env = { ...process.env, JEN_RUNTIME_NAME: name, JEN_OWNER_TOKEN: ownerToken, JEN_MODEL: model, JEN_API_KEY: apiKey, JEN_BASE_URL: baseURL };
  // Credentials are passed by name, so they stay off the command line.
  const runtimeArgs = [
    "--user", "root",
    "-v", "/var/run/docker.sock:/var/run/docker.sock",
    ...["JEN_RUNTIME_NAME", "JEN_OWNER_TOKEN", "JEN_MODEL", "JEN_API_KEY", ...(baseURL ? ["JEN_BASE_URL"] : [])].flatMap((n) => ["-e", n]),
    "jen", "src/runtime/main.ts",
  ];

  // Starts the runtime as documented, and returns its address once it serves.
  async function startRuntime(): Promise<string> {
    docker(["run", "-d", "--name", `${name}-runtime`, "-p", "127.0.0.1::8080", ...runtimeArgs], { env });
    const port = docker(["port", `${name}-runtime`, "8080/tcp"]).trim().split("\n")[0].split(":").at(-1);
    const base = `http://127.0.0.1:${port}`;
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        await fetch(base);
        return base;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }
    throw new Error(`the runtime never served: ${docker(["logs", `${name}-runtime`])}`);
  }

  const call = async (base: string, path: string, init: RequestInit = {}) => {
    const res = await fetch(`${base}${path}`, { ...init, headers: { ...owner, ...init.headers }, signal: AbortSignal.timeout(150_000) });
    const text = await res.text();
    return { status: res.status, body: text === "" ? undefined : JSON.parse(text) };
  };
  const container = (id: string) => `${name}-agent-${id}`;
  const volume = container;
  const tokenOf = (id: string) =>
    docker(["inspect", "-f", "{{range .Config.Env}}{{println .}}{{end}}", container(id)])
      .split("\n")
      .find((e) => e.startsWith("JEN_TOKEN="))!
      .slice("JEN_TOKEN=".length);
  const running = (id: string) => docker(["ps", "-q", "--filter", `name=^${container(id)}$`, "--filter", "status=running"]).trim() !== "";
  const exists = (kind: "container" | "volume", n: string) => spawnSync("docker", [kind, "inspect", n], { timeout: 30_000 }).status === 0;

  try {
    let base = await startRuntime();
    expect((await fetch(`${base}/agents`)).status).toBe(401);

    // The owner spawns a root agent, and the root's token spawns a child.
    const root = await call(base, "/agents", { method: "POST", body: JSON.stringify({ grant: { spawn: true } }) });
    expect(root).toMatchObject({ status: 201, body: { parent: null, grant: { spawn: true }, state: "running" } });
    const rootId: string = root.body.id;
    const child = await call(base, "/agents", { method: "POST", headers: { Authorization: `Bearer ${tokenOf(rootId)}` }, body: JSON.stringify({ grant: { spawn: false } }) });
    expect(child).toMatchObject({ status: 201, body: { parent: rootId, grant: { spawn: false } } });
    const childId: string = child.body.id;
    const refused = await call(base, "/agents", { method: "POST", headers: { Authorization: `Bearer ${tokenOf(childId)}` }, body: JSON.stringify({ grant: { spawn: false } }) });
    expect(refused.status).toBe(403);

    // A message relayed to the root is answered, and its events stream.
    const word = `jen-${randomBytes(4).toString("hex")}`;
    const remember = `Remember this word: ${word}. Reply only with OK.`;
    const told = await call(base, `/agents/${rootId}/messages`, { method: "POST", body: JSON.stringify({ text: remember }) });
    expect(told.status).toBe(200);
    expect(await events(base, ownerToken, rootId, 2)).toEqual([
      { type: "message", role: "user", text: remember },
      { type: "message", role: "assistant", text: told.body.reply },
    ]);

    // The root's process exits unexpectedly. The engine brings it back, with
    // its conversation, and the child keeps running throughout.
    const childStarted = docker(["inspect", "-f", "{{.State.StartedAt}}", container(childId)]).trim();
    docker(["exec", container(rootId), "node", "-e", "process.kill(1, 'SIGTERM')"]);
    await until(() => docker(["inspect", "-f", "{{.RestartCount}} {{.State.Status}}", container(rootId)]).trim() === "1 running", "the root to restart");
    expect(running(childId)).toBe(true);
    expect(docker(["inspect", "-f", "{{.State.StartedAt}}", container(childId)]).trim()).toBe(childStarted);
    expect((await call(base, `/agents/${rootId}`)).body.state).toBe("running");
    await until(async () => (await events(base, ownerToken, rootId, 2).catch(() => [])).length === 2, "the root to serve again");

    // Stopping the root removes both containers and keeps both volumes.
    expect(await call(base, `/agents/${rootId}/stop`, { method: "POST" })).toMatchObject({ status: 200, body: { state: "stopped" } });
    expect([exists("container", container(rootId)), exists("container", container(childId))]).toEqual([false, false]);
    expect([exists("volume", volume(rootId)), exists("volume", volume(childId))]).toEqual([true, true]);

    // Starting the root resumes its memory, and leaves the child stopped.
    expect(await call(base, `/agents/${rootId}/start`, { method: "POST" })).toMatchObject({ status: 200, body: { state: "running" } });
    const recall = await call(base, `/agents/${rootId}/messages`, {
      method: "POST",
      body: JSON.stringify({ text: "What was the word I asked you to remember? Reply with just the word." }),
    });
    expect(recall.status).toBe(200);
    expect(recall.body.reply).toContain(word);
    expect((await call(base, `/agents/${childId}`)).body.state).toBe("stopped");

    // A replaced runtime reads back the same tree, and relays to it.
    const before = (await call(base, "/agents")).body;
    docker(["rm", "-f", `${name}-runtime`]);
    base = await startRuntime();
    expect((await call(base, "/agents")).body).toEqual(before);
    expect(await events(base, ownerToken, rootId, 4)).toHaveLength(4);

    // A second runtime with the same name exits, and the first keeps serving.
    const second = spawnSync("docker", ["run", "--name", `${name}-second`, ...runtimeArgs], { encoding: "utf8", env, timeout: 60_000 });
    expect(second.status).not.toBe(0);
    expect(second.stderr).toContain(`another runtime named ${name} is running`);
    expect((await call(base, "/agents")).status).toBe(200);

    // Deleting the root removes both volumes.
    expect((await call(base, `/agents/${rootId}`, { method: "DELETE" })).status).toBe(204);
    expect([exists("volume", volume(rootId)), exists("volume", volume(childId))]).toEqual([false, false]);
    expect((await call(base, "/agents")).body).toEqual([]);
  } finally {
    // Everything the check created, whatever state it was left in.
    const quiet = (args: string[]) => spawnSync("docker", args, { encoding: "utf8", timeout: 30_000 });
    const agents = quiet(["ps", "-aq", "--filter", `label=jen.runtime=${name}`]).stdout.split("\n").filter(Boolean);
    quiet(["rm", "-f", `${name}-runtime`, `${name}-second`, ...agents]);
    const volumes = quiet(["volume", "ls", "-q", "--filter", `label=jen.runtime=${name}`]).stdout.split("\n").filter(Boolean);
    if (volumes.length > 0) quiet(["volume", "rm", ...volumes]);
    quiet(["network", "rm", name]);
  }
});

// Reads an agent's event stream through the runtime until n items arrive.
async function events(base: string, token: string, id: string, n: number): Promise<Item[]> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 30_000);
  const res = await fetch(`${base}/agents/${id}/events`, { headers: { Authorization: `Bearer ${token}` }, signal: abort.signal });
  if (res.status !== 200) throw new Error(`GET /events got ${res.status}`);
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

async function until(check: () => boolean | Promise<boolean>, what: string) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`timed out waiting for ${what}`);
}

function docker(args: string[], { env, timeout = 30_000 }: { env?: NodeJS.ProcessEnv; timeout?: number } = {}): string {
  const result = spawnSync("docker", args, { encoding: "utf8", env, timeout });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`docker ${args[0]} exited ${result.status}: ${result.stderr}`);
  return result.stdout;
}
