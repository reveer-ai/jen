// Runs the runtime against real Docker, under a runtime name of its own, and
// walks the tree through its API: spawn, a refused spawn, the relay, a crash,
// stop, start and its notice, a replaced runtime, a second runtime, and
// delete. Replies are read from the event stream. Uses the
// same JEN_LIVE_* variables as the other live checks. Skipped when the key or
// model is missing; with them set, a missing Docker fails the check.
//
// Vitest can't interrupt a synchronous child, so each Docker command has its
// own deadline, and together they fit inside the test's timeout.

import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { expect, test } from "vitest";
import type { Item } from "../agent/model/port.ts";
import { replies } from "../agent/model/replies.ts";

const apiKey = process.env.JEN_LIVE_API_KEY;
const model = process.env.JEN_LIVE_MODEL;
const baseURL = process.env.JEN_LIVE_BASE_URL;

test.skipIf(!apiKey || !model)("the runtime keeps a tree of agents on Docker", { timeout: 600_000 }, async () => {
  for (const target of ["agent", "runtime"]) {
    docker(["build", "--target", target, "-t", `jen-${target}`, join(import.meta.dirname, "../..")], { timeout: 240_000 });
  }
  const name = `jen-live-${randomBytes(4).toString("hex")}`;
  const ownerToken = randomBytes(32).toString("hex");
  const owner = { Authorization: `Bearer ${ownerToken}` };
  const env = { ...process.env, JEN_RUNTIME_NAME: name, JEN_OWNER_TOKEN: ownerToken, JEN_MODEL: model, JEN_API_KEY: apiKey, JEN_BASE_URL: baseURL };
  // Credentials are passed by name, so they stay off the command line.
  const runtimeArgs = [
    "-v", "/var/run/docker.sock:/var/run/docker.sock",
    ...["JEN_RUNTIME_NAME", "JEN_OWNER_TOKEN", "JEN_MODEL", "JEN_API_KEY", ...(baseURL ? ["JEN_BASE_URL"] : [])].flatMap((n) => ["-e", n]),
    "jen-runtime",
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

    // A message relayed to the root is saved from the owner, and its reply
    // is on the root's event stream.
    const word = `jen-${randomBytes(4).toString("hex")}`;
    const remember = `Remember this word: ${word}. Reply only with OK.`;
    const told = await call(base, `/agents/${rootId}/messages`, { method: "POST", body: JSON.stringify({ text: remember }) });
    expect(told.status).toBe(202);
    const first = await reply(`${base}/agents/${rootId}/events`, ownerToken, 0);
    expect(first.events[0]!.item).toEqual({ type: "message", role: "user", from: "owner", text: remember });
    expect(first.text).not.toBe("");

    // The root's process exits unexpectedly. A stream open on it ends, the
    // engine brings it back with its conversation, and the child keeps
    // running throughout.
    const childStarted = docker(["inspect", "-f", "{{.State.StartedAt}}", container(childId)]).trim();
    const watcher = await fetch(`${base}/agents/${rootId}/events`, { headers: owner, signal: AbortSignal.timeout(30_000) });
    const watched = watcher.body!.pipeTo(new WritableStream()).then(() => "ended", (error) => (error.name === "TimeoutError" ? "hung" : "ended"));
    docker(["exec", container(rootId), "node", "-e", "process.kill(1, 'SIGTERM')"]);
    expect(await watched).toBe("ended");
    await until(() => docker(["inspect", "-f", "{{.RestartCount}} {{.State.Status}}", container(rootId)]).trim() === "1 running", "the root to restart");
    expect(running(childId)).toBe(true);
    expect(docker(["inspect", "-f", "{{.State.StartedAt}}", container(childId)]).trim()).toBe(childStarted);
    expect((await call(base, `/agents/${rootId}`)).body.state).toBe("running");
    await until(async () => (await events(base, ownerToken, rootId, 1).catch(() => [])).length >= 1, "the root to serve again");

    // Stopping the root removes both containers and keeps both volumes.
    expect(await call(base, `/agents/${rootId}/stop`, { method: "POST" })).toMatchObject({ status: 200, body: { state: "stopped" } });
    expect([exists("container", container(rootId)), exists("container", container(childId))]).toEqual([false, false]);
    expect([exists("volume", volume(rootId)), exists("volume", volume(childId))]).toEqual([true, true]);

    // Starting the root leaves the child stopped, tells the root so, and
    // resumes its memory.
    expect(await call(base, `/agents/${rootId}/start`, { method: "POST" })).toMatchObject({ status: 200, body: { state: "running" } });
    expect((await call(base, `/agents/${childId}`)).body.state).toBe("stopped");
    const notice = await readEvents(`${base}/agents/${rootId}/events`, ownerToken, 0, (all) =>
      all.some(({ item }) => item.type === "message" && item.role === "user" && item.from === "runtime" && item.text.includes(childId)),
    );
    const recall = await call(base, `/agents/${rootId}/messages`, {
      method: "POST",
      body: JSON.stringify({ text: "What was the word I asked you to remember? Reply with just the word." }),
    });
    expect(recall.status).toBe(202);
    const recalled = await reply(`${base}/agents/${rootId}/events`, ownerToken, notice.at(-1)!.id);
    expect(recalled.text).toContain(word);

    // A replaced runtime reads back the same tree, and relays to it.
    // Docker lists volumes in no fixed order, so compare the trees by ID.
    const tree = async () => ((await call(base, "/agents")).body as { id: string }[]).sort((a, b) => a.id.localeCompare(b.id));
    const before = await tree();
    // The runtime's image declares no volume, so the socket is its only mount.
    expect(docker(["inspect", "-f", "{{range .Mounts}}{{println .Destination}}{{end}}", `${name}-runtime`]).trim()).toBe("/var/run/docker.sock");
    docker(["rm", "-f", `${name}-runtime`]);
    base = await startRuntime();
    expect(await tree()).toEqual(before);
    expect((await events(base, ownerToken, rootId, 4)).length).toBeGreaterThanOrEqual(4);

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

// The owner asks a root agent for work it has to delegate, where the sub-agent
// must ask the root a question before it can finish. The owner's message
// describes the work, not how agents talk: following the system instructions
// is up to the model. Each agent's conversation is printed at the end.
test.skipIf(!apiKey || !model)("an agent delegates and converses in both directions", { timeout: 600_000 }, async () => {
  for (const target of ["agent", "runtime"]) {
    docker(["build", "--target", target, "-t", `jen-${target}`, join(import.meta.dirname, "../..")], { timeout: 240_000 });
  }
  const name = `jen-live-${randomBytes(4).toString("hex")}`;
  const ownerToken = randomBytes(32).toString("hex");
  const owner = { Authorization: `Bearer ${ownerToken}` };
  const env = { ...process.env, JEN_RUNTIME_NAME: name, JEN_OWNER_TOKEN: ownerToken, JEN_MODEL: model, JEN_API_KEY: apiKey, JEN_BASE_URL: baseURL };
  const names = ["JEN_RUNTIME_NAME", "JEN_OWNER_TOKEN", "JEN_MODEL", "JEN_API_KEY", ...(baseURL ? ["JEN_BASE_URL"] : [])];
  let base = "";
  let rootId = "";
  try {
    docker(["run", "-d", "--name", `${name}-runtime`, "-p", "127.0.0.1::8080", "-v", "/var/run/docker.sock:/var/run/docker.sock", ...names.flatMap((n) => ["-e", n]), "jen-runtime"], { env });
    const port = docker(["port", `${name}-runtime`, "8080/tcp"]).trim().split("\n")[0].split(":").at(-1);
    base = `http://127.0.0.1:${port}`;
    await until(async () => !!(await fetch(base).catch(() => undefined)), "the runtime to serve");

    const root = await fetch(`${base}/agents`, { method: "POST", headers: owner, body: JSON.stringify({ grant: { spawn: true } }) });
    expect(root.status).toBe(201);
    rootId = (await root.json()).id;

    const word = `heron${randomBytes(2).toString("hex")}`;
    const reversed = [...word].reverse().join("");
    const task =
      `The code word is ${word}. I need it spelled backwards, but I want a sub-agent to do the spelling, not you. ` +
      "Start one sub-agent, without the right to start its own, and ask it for the reversed code word without telling it the word: " +
      "tell it to ask you for the word. Answer its question when it asks. When it gives you the reversed word, pass it on to me.";
    expect((await fetch(`${base}/agents/${rootId}/messages`, { method: "POST", headers: owner, body: JSON.stringify({ text: task }) })).status).toBe(202);

    const toOwner = (events: Event[]) => replies(events.map((e) => e.item)).some((text) => text.includes(reversed));
    const events = await readEvents(`${base}/agents/${rootId}/events`, ownerToken, 0, toOwner, 2_000, 480_000);
    const items = events.map((e) => e.item);

    const spawned = items.find((i) => i.type === "tool_call" && i.name === "spawn_agent");
    expect(spawned).toBeDefined();
    const children = ((await (await fetch(`${base}/agents`, { headers: owner })).json()) as { id: string; parent: string | null }[]).filter((a) => a.parent === rootId);
    expect(children).toHaveLength(1);
    const childId = children[0]!.id;
    // The child's replies reach the root as messages, or in the results of
    // its wait calls.
    const waits = new Set(items.flatMap((i) => (i.type === "tool_call" && i.name === "wait" ? [i.id] : [])));
    const fromChild = items.flatMap((i) => {
      if (i.type === "message" && i.role === "user" && i.from === childId) return [i.text];
      if (i.type === "tool_result" && waits.has(i.callId) && i.output.includes(`From: ${childId}`)) return [i.output];
      return [];
    });
    const toChild = items.filter((i) => i.type === "tool_call" && i.name === "message_sub_agent" && (i.input as { to?: string }).to === childId);
    // The child asked, the root answered with the word, and the child's
    // result came back before the root passed it on.
    expect(fromChild.length).toBeGreaterThanOrEqual(2);
    expect(toChild.some((i) => JSON.stringify(i).includes(word))).toBe(true);
    expect(fromChild.some((text) => text.includes(reversed))).toBe(true);
    expect(toOwner(events)).toBe(true);
  } finally {
    if (base && rootId) {
      // The transcript shows whether the models followed the instructions.
      const agents = ((await (await fetch(`${base}/agents`, { headers: owner }).catch(() => undefined))?.json().catch(() => [])) ?? []) as { id: string }[];
      for (const { id } of agents) {
        const transcript = await readEvents(`${base}/agents/${id}/events`, ownerToken, 0, () => true, 2_000).catch((error) => [{ error: String(error) }]);
        console.log(`agent ${id}${id === rootId ? " (root)" : ""}:\n${transcript.map((e) => JSON.stringify("item" in e ? e.item : e)).join("\n")}`);
      }
    }
    const quiet = (args: string[]) => spawnSync("docker", args, { encoding: "utf8", timeout: 30_000 });
    const containers = quiet(["ps", "-aq", "--filter", `label=jen.runtime=${name}`]).stdout.split("\n").filter(Boolean);
    quiet(["rm", "-f", `${name}-runtime`, ...containers]);
    const volumes = quiet(["volume", "ls", "-q", "--filter", `label=jen.runtime=${name}`]).stdout.split("\n").filter(Boolean);
    if (volumes.length > 0) quiet(["volume", "rm", ...volumes]);
    quiet(["network", "rm", name]);
  }
});

// Reads an agent's event stream through the runtime until n items arrive.
async function events(base: string, token: string, id: string, n: number): Promise<Item[]> {
  return (await readEvents(`${base}/agents/${id}/events`, token, 0, (events) => events.length >= n)).map((e) => e.item);
}

type Event = { id: number; item: Item };

// Reads item events after position after until done holds of what's arrived,
// and then until no item has arrived for quietMs, failing after timeoutMs.
async function readEvents(url: string, token: string, after: number, done: (events: Event[]) => boolean, quietMs = 0, timeoutMs = 150_000): Promise<Event[]> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
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
