// Holds agents to how they should behave on owner tasks, against a runtime of
// its own: six tasks, three runs each, in parallel, each with its own root.
// A run settles after 30 seconds with no new event on any of its agents'
// streams. A failing run prints its transcript. Uses the same JEN_LIVE_*
// variables as the other live checks. Skipped when the key or model is
// missing; with them set, a missing Docker fails the check.

import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { expect, test } from "vitest";
import type { Item } from "../agent/model/port.ts";
import { replies } from "../agent/model/replies.ts";

const apiKey = process.env.JEN_LIVE_API_KEY;
const model = process.env.JEN_LIVE_MODEL;
const baseURL = process.env.JEN_LIVE_BASE_URL;

const RUNS = 3;
const QUIET_MS = 30_000;
const MAX_MS = 360_000;

interface Task {
  name: string;
  // The owner's messages: the first, then each later one once the run settles.
  steps: string[];
  // How many replies the owner should get.
  replies: number;
  // Sent to the root once it first replies.
  answer?: string;
}

const tasks: Task[] = [
  { name: "delegation", steps: ["Spawn a sub-agent to write a haiku about herons, then send me its haiku."], replies: 1 },
  { name: "direct", steps: ["What's the capital of Australia?"], replies: 1 },
  { name: "fanout", steps: ["Get three sub-agents to each propose a name for a coffee shop, then send me the best of the three with one line on why."], replies: 1 },
  {
    name: "question",
    steps: ["Have a sub-agent write a two-line wedding toast for my sister and her partner, using their names."],
    replies: 2,
    answer: "Maya and Jordan.",
  },
  { name: "followup", steps: ["Have a sub-agent write a haiku about herons and send it to me.", "Nice. Now one about cranes."], replies: 2 },
  {
    name: "nested",
    steps: [
      "Set up a small team: one sub-agent who leads two sub-agents of its own. The two each write one sentence of a two-sentence story about a lighthouse, and the lead combines them. Send me the story.",
    ],
    replies: 1,
  },
];

type Event = { t: number; agent: string; kind: "item" | "error"; item: Item | { message: string } };

test.skipIf(!apiKey || !model)("agents behave on the owner's tasks", { timeout: 1_200_000 }, async () => {
  for (const target of ["agent", "runtime"]) {
    docker(["build", "--target", target, "-t", `jen-${target}`, join(import.meta.dirname, "../..")], { timeout: 240_000 });
  }
  const name = `jen-live-${randomBytes(4).toString("hex")}`;
  const ownerToken = randomBytes(32).toString("hex");
  const owner = { Authorization: `Bearer ${ownerToken}` };
  // Eighteen roots and their sub-agents need more than the default bound.
  const env = { ...process.env, JEN_RUNTIME_NAME: name, JEN_OWNER_TOKEN: ownerToken, JEN_MODEL: model, JEN_API_KEY: apiKey, JEN_BASE_URL: baseURL, JEN_MAX_AGENTS: "60" };
  const names = ["JEN_RUNTIME_NAME", "JEN_OWNER_TOKEN", "JEN_MODEL", "JEN_API_KEY", "JEN_MAX_AGENTS", ...(baseURL ? ["JEN_BASE_URL"] : [])];
  try {
    docker(["run", "-d", "--name", `${name}-runtime`, "-p", "127.0.0.1::8080", "-v", "/var/run/docker.sock:/var/run/docker.sock", ...names.flatMap((n) => ["-e", n]), "jen-runtime"], { env });
    const port = docker(["port", `${name}-runtime`, "8080/tcp"]).trim().split("\n")[0]!.split(":").at(-1);
    const base = `http://127.0.0.1:${port}`;
    for (let attempt = 0; !(await fetch(base).catch(() => undefined)); attempt++) {
      if (attempt === 100) throw new Error("the runtime didn't serve");
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    const api = async (path: string, init: RequestInit = {}) => {
      const res = await fetch(base + path, { ...init, headers: { ...owner, ...init.headers } });
      const text = await res.text();
      return text === "" ? undefined : JSON.parse(text);
    };

    const runs = tasks.flatMap((task) => Array.from({ length: RUNS }, (_, i) => runTask(api, base, owner, task, `${task.name}-${i + 1}`)));
    const failed = (await Promise.all(runs)).filter((run) => run.faults.length > 0);
    for (const run of failed) console.log(`${run.label}: ${run.faults.join("; ")}\n${run.transcript}\n`);
    expect(failed.map((run) => `${run.label}: ${run.faults.join("; ")}`)).toEqual([]);
  } finally {
    const quiet = (args: string[]) => spawnSync("docker", args, { encoding: "utf8", timeout: 60_000 });
    const containers = quiet(["ps", "-aq", "--filter", `label=jen.runtime=${name}`]).stdout.split("\n").filter(Boolean);
    quiet(["rm", "-f", `${name}-runtime`, ...containers]);
    const volumes = quiet(["volume", "ls", "-q", "--filter", `label=jen.runtime=${name}`]).stdout.split("\n").filter(Boolean);
    if (volumes.length > 0) quiet(["volume", "rm", ...volumes]);
    quiet(["network", "rm", name]);
  }
});

// Runs one task with a root of its own, watching every agent in its tree, and
// returns the run's faults and its transcript.
async function runTask(api: (path: string, init?: RequestInit) => Promise<any>, base: string, owner: Record<string, string>, task: Task, label: string) {
  const start = Date.now();
  const root: string = (await api("/agents", { method: "POST", body: JSON.stringify({ grant: { spawn: true } }) })).id;
  const events: Event[] = [];
  const watching = new Map<string, AbortController>();
  let last = Date.now();

  const watch = async (id: string) => {
    const abort = new AbortController();
    watching.set(id, abort);
    try {
      const res = await fetch(`${base}/agents/${id}/events`, { headers: owner, signal: abort.signal });
      const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        let end;
        while ((end = buffer.indexOf("\n\n")) >= 0) {
          const block = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          const kind = block.match(/^event: (.*)$/m)?.[1];
          const data = block.match(/^data: (.*)$/m)?.[1];
          if ((kind === "item" || kind === "error") && data) {
            events.push({ t: Date.now() - start, agent: id, kind, item: JSON.parse(data) });
            last = Date.now();
          }
        }
      }
    } catch {
      // Aborted at the end of the run, or the agent stopped.
    }
    watching.delete(id);
  };
  // The root's tree, with a stream open on each running agent in it.
  const tree = async () => {
    const all = (await api("/agents")) as { id: string; parent: string | null; state: string }[];
    const mine = new Set([root]);
    for (let grew = true; grew; ) {
      grew = false;
      for (const agent of all) if (agent.parent && mine.has(agent.parent) && !mine.has(agent.id)) grew = Boolean(mine.add(agent.id));
    }
    for (const agent of all) if (mine.has(agent.id) && agent.state === "running" && !watching.has(agent.id)) void watch(agent.id);
    return [root, ...[...mine].filter((id) => id !== root)];
  };

  void watch(root);
  const faults: string[] = [];
  let answered = false;
  for (const [i, text] of task.steps.entries()) {
    last = Date.now();
    await api(`/agents/${root}/messages`, { method: "POST", body: JSON.stringify({ text }) });
    for (;;) {
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      await tree();
      // Read once the stream has been quiet for a moment, so a response
      // that's still arriving isn't taken for a reply.
      if (task.answer && !answered && Date.now() - last > 2_000 && repliesOf(events, root).length > 0) {
        answered = true;
        last = Date.now();
        await api(`/agents/${root}/messages`, { method: "POST", body: JSON.stringify({ text: task.answer }) });
      }
      if (Date.now() - last > QUIET_MS) break;
      if (Date.now() - start > MAX_MS) {
        faults.push(`didn't settle within ${MAX_MS / 60_000} minutes, at step ${i + 1}`);
        break;
      }
    }
    if (faults.length > 0) break;
  }
  const ids = await tree();
  for (const abort of watching.values()) abort.abort();
  await api(`/agents/${root}`, { method: "DELETE" });

  const owned = repliesOf(events, root);
  if (owned.length !== task.replies) faults.push(`the owner got ${owned.length} replies, not ${task.replies}`);
  const items = events.flatMap((e) => (e.kind === "item" ? [{ agent: e.agent, item: e.item as Item }] : []));
  const calls = items.flatMap(({ agent, item }) => (item.type === "tool_call" ? [{ agent, item }] : []));
  const polls = calls.filter(({ item }) => item.name === "list_agents").length;
  if (polls > 0) faults.push(`${polls} list_agents calls`);
  const errors = items.filter(({ item }) => item.type === "tool_result" && item.output.startsWith("Error")).length;
  if (errors > 0) faults.push(`${errors} refused or failed tool calls`);
  const sends = calls.filter(({ item }) => item.name === "message_sub_agent").map(({ agent, item }) => `${agent} ${JSON.stringify(item.input)}`);
  const repeats = sends.length - new Set(sends).size;
  if (repeats > 0) faults.push(`${repeats} messages sent twice`);
  const filler = ids.filter((id) => id !== root).flatMap((id) => repliesOf(events, id)).filter((text) => text.length < 10);
  if (filler.length > 0) faults.push(`filler replies: ${filler.map((text) => JSON.stringify(text)).join(", ")}`);
  const modelErrors = events.filter((e) => e.kind === "error").length;
  if (modelErrors > 0) faults.push(`${modelErrors} model error events`);
  return { label, faults, transcript: transcript(events, ids) };
}

// What an agent replied to its parent, read from its stream.
function repliesOf(events: Event[], agent: string): string[] {
  return replies(events.flatMap((e) => (e.agent === agent && e.kind === "item" ? [e.item as Item] : [])));
}

// The run in the lab's compact form: one line per event, agents named root,
// a1, a2 and so on.
function transcript(events: Event[], ids: string[]): string {
  const short = (id: string) => (id === ids[0] ? "root" : ids.includes(id) ? `a${ids.indexOf(id)}` : id);
  const flat = (text: string) => text.replace(/\n/g, " / ");
  return [...events]
    .sort((a, b) => a.t - b.t)
    .map(({ t, agent, kind, item }) => {
      const head = `${(t / 1000).toFixed(0).padStart(4)}s ${short(agent).padEnd(5)}`;
      if (kind === "error") return `${head} ERROR ${(item as { message: string }).message}`;
      const it = item as Item;
      if (it.type === "message" && it.role === "user") return `${head} <- ${short(it.from)}: ${flat(it.text)}`;
      if (it.type === "message") return `${head} says: ${flat(it.text)}`;
      if (it.type === "tool_call") {
        const input = it.input as { to?: string; text?: string };
        return it.name === "message_sub_agent" ? `${head} call message_sub_agent -> ${short(String(input.to))}: ${flat(String(input.text))}` : `${head} call ${it.name} ${JSON.stringify(it.input)}`;
      }
      return `${head}   = ${flat(it.output).slice(0, 200)}`;
    })
    .join("\n");
}

function docker(args: string[], options: { env?: NodeJS.ProcessEnv; timeout?: number } = {}): string {
  const run = spawnSync("docker", args, { encoding: "utf8", timeout: 60_000, ...options });
  if (run.status !== 0) throw new Error(`docker ${args[0]} failed: ${run.stderr || run.error?.message}`);
  return run.stdout;
}
