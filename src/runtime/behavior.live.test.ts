// Holds agents to how they should behave on owner tasks, against a runtime of
// its own: seven tasks, three runs each, in parallel, each with its own root.
// A run settles after 30 seconds with no new event on any of its agents'
// streams. A failing run prints its transcript. Uses the same JEN_LIVE_*
// variables as the other live checks. Skipped when the key or model is
// missing; with them set, a missing Docker fails the check. With
// JEN_LIVE_RECORD set and a passing run of every task, it writes one of each to
// docs/interactions.data.js, which docs/interactions.html replays.

import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
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
  // The root's grant, which is {"spawn": true} unless set.
  grant?: { spawn?: boolean; workspace?: boolean };
  // Faults only this task can see, found before the root is deleted, from
  // its replies to the owner and the name of its workspace container.
  check?: (run: { replies: string[]; workspace: string }) => string[];
}

// The command task's line: a hash the model can't work out without running
// the command. The command counts its own runs before it prints anything, so
// a run piped into grep, or rewritten any other way, still counts.
const seed = randomBytes(4).toString("hex");
const key = `KEY: ${createHash("sha256").update(seed).digest("hex").slice(0, 16)}`;
const command =
  'echo run >> ~/runs.txt; for i in $(seq 1 4000); do echo "worker[$i]: step complete, status ok"; ' +
  `if [ "$i" -eq 2000 ]; then echo "KEY: $(printf %s ${seed} | sha256sum | cut -c1-16)"; fi; done`;

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
  {
    // About 140 KB of log with the line in its middle, in neither the start
    // nor the end a cut output keeps.
    name: "command",
    steps: [`Run this command in your workspace exactly once, and tell me the line of its output that starts with "KEY:".\n\n${command}`],
    replies: 1,
    grant: { workspace: true },
    check: ({ replies, workspace }) => {
      const faults: string[] = [];
      if (!replies.some((text) => text.includes(key))) faults.push(`the reply lacks "${key}"`);
      const runs = spawnSync("docker", ["exec", workspace, "cat", "/home/agent/runs.txt"], { encoding: "utf8", timeout: 30_000 }).stdout.split("\n").filter(Boolean).length;
      if (runs > 1) faults.push(`the command ran ${runs} times`);
      return faults;
    },
  },
];

type Event = { t: number; agent: string; kind: "item" | "error"; item: Item | { message: string } };

test.skipIf(!apiKey || !model)("agents behave on the owner's tasks", { timeout: 1_200_000 }, async () => {
  for (const target of ["agent", "runtime", "workspace"]) {
    docker(["build", "--target", target, "-t", `jen-${target}`, join(import.meta.dirname, "../..")], { timeout: 240_000 });
  }
  const name = `jen-live-${randomBytes(4).toString("hex")}`;
  const ownerToken = randomBytes(32).toString("hex");
  const owner = { Authorization: `Bearer ${ownerToken}` };
  // Twenty-one roots and their sub-agents need more than the default bound.
  const env = {
    ...process.env,
    JEN_RUNTIME_NAME: name,
    JEN_OWNER_TOKEN: ownerToken,
    JEN_MODEL: model,
    JEN_API_KEY: apiKey,
    JEN_BASE_URL: baseURL,
    JEN_MAX_AGENTS: "70",
    JEN_WORKSPACE_IMAGE: "jen-workspace",
  };
  const names = ["JEN_RUNTIME_NAME", "JEN_OWNER_TOKEN", "JEN_MODEL", "JEN_API_KEY", "JEN_MAX_AGENTS", "JEN_WORKSPACE_IMAGE", ...(baseURL ? ["JEN_BASE_URL"] : [])];
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

    const runs = tasks.flatMap((task) => Array.from({ length: RUNS }, (_, i) => runTask(api, base, owner, name, task, `${task.name}-${i + 1}`)));
    const results = await Promise.all(runs);
    if (process.env.JEN_LIVE_RECORD) record(results);
    const failed = results.filter((run) => run.faults.length > 0);
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
async function runTask(api: (path: string, init?: RequestInit) => Promise<any>, base: string, owner: Record<string, string>, name: string, task: Task, label: string) {
  const start = Date.now();
  const root: string = (await api("/agents", { method: "POST", body: JSON.stringify({ grant: task.grant ?? { spawn: true } }) })).id;
  const events: Event[] = [];
  const parents = new Map<string, string | null>();
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
    for (const agent of all) parents.set(agent.id, agent.parent);
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
  const owned = repliesOf(events, root);
  if (task.check) faults.push(...task.check({ replies: owned, workspace: `${name}-workspace-${root}` }));
  await api(`/agents/${root}`, { method: "DELETE" });

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
  return { label, faults, transcript: transcript(events, ids), recording: recording(task, events, ids, parents) };
}

// The run as docs/interactions.html replays it, with every agent ID replaced
// by the short name the transcript uses.
function recording(task: Task, events: Event[], ids: string[], parents: Map<string, string | null>) {
  const short = (id: string) => (id === ids[0] ? "root" : `a${ids.indexOf(id)}`);
  let json = JSON.stringify({
    task: task.name,
    agents: ids.map((id) => ({ id, parent: id === ids[0] ? "owner" : parents.get(id) })),
    events: [...events].sort((a, b) => a.t - b.t),
  });
  for (const id of ids) json = json.replaceAll(id, short(id));
  return JSON.parse(json);
}

function record(results: { label: string; faults: string[]; recording: { task: string } }[]) {
  const runs = tasks.map((task) => results.find((run) => run.recording.task === task.name && run.faults.length === 0)?.recording);
  // A partial recording would drop the missing tasks from the page.
  if (runs.some((run) => run === undefined)) return console.log("docs/interactions.data.js left unchanged: not every task had a passing run.");
  const data = { recorded: new Date().toISOString().slice(0, 10), model, runs };
  writeFileSync(join(import.meta.dirname, "../../docs/interactions.data.js"), `// Written by src/runtime/behavior.live.test.ts with JEN_LIVE_RECORD set.\nwindow.JEN_RECORDING = ${JSON.stringify(data, null, 1)};\n`);
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
