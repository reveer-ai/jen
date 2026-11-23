// Runs one task against a side's runtime, as the owner: a root of its own,
// a stream open on every running agent in its tree, the owner's messages one
// at a time, each once the run has settled, and the task's answer once the
// root first replies. A run settles after 30 seconds with no new event on any
// of its tree's streams, and fails with a settle fault if it hasn't within its
// task's limit. Once settled, the task's check runs, the root's usage is read
// and the root is deleted.
//
// A run that the harness can't carry out, such as an API call the runtime
// refuses or a docker command that can't run, is errored, never failed: it
// says nothing about the agents. faults() is the run's judgement, a pure
// function of what the run saw.

import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import type { Item } from "../../src/agent/model/port.ts";
import { replies as repliesIn } from "../../src/agent/model/replies.ts";
import type { CheckInput, Task } from "./tasks.ts";

export const QUIET_MS = 30_000;
export const LIMIT_MS = 360_000;
// How often a run looks at its tree and its streams.
const POLL_MS = 2_000;

export type FaultKind = "settle" | "replies" | "list_agents" | "tool_error" | "repeat_message" | "filler_reply" | "model_error" | "publish_ui" | "check";
export const FAULT_KINDS: FaultKind[] = ["settle", "replies", "list_agents", "tool_error", "repeat_message", "filler_reply", "model_error", "publish_ui", "check"];

export interface Fault {
  kind: FaultKind;
  detail: string;
}

// One saved item or error from an agent's stream, t milliseconds after the
// run started.
export type Event = { t: number; agent: string; kind: "item"; item: Item } | { t: number; agent: string; kind: "error"; item: { message: string; gaveUp?: boolean } };

export interface Usage {
  calls: number;
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cost?: number;
}

export interface Metrics {
  // From the first message to the tree's last event.
  durationMs: number;
  agents: number;
  tools: Record<string, number>;
  // null when the side's runtime has no usage route.
  usage: Usage | null;
}

export type Outcome = "passed" | "failed" | "errored";

export interface Run {
  task: string;
  outcome: Outcome;
  // Why an errored run couldn't be carried out.
  error?: string;
  faults: Fault[];
  metrics: Metrics;
  // The tree, root first, each with its parent ("owner" for the root).
  agents: { id: string; parent: string }[];
  events: Event[];
}

// A failure of the harness or the runtime, not of the agents.
export class HarnessError extends Error {
  override name = "HarnessError";
}

// What the run saw, which faults() judges.
export interface Observed {
  task: Pick<Task, "replies">;
  events: Event[];
  // The tree, root first.
  ids: string[];
  // Set when the run didn't settle within its limit, at that step (from 1).
  unsettledAt?: number;
  limitMs: number;
  // The task's own check's faults.
  checked: string[];
}

export function faults({ task, events, ids, unsettledAt, limitMs, checked }: Observed): Fault[] {
  const found: Fault[] = [];
  const root = ids[0]!;
  if (unsettledAt !== undefined) found.push({ kind: "settle", detail: `didn't settle within ${limitMs / 60_000} minutes, at step ${unsettledAt}` });
  const owned = repliesOf(events, root);
  if (task.replies === "some" ? owned.length === 0 : owned.length !== task.replies) {
    found.push({ kind: "replies", detail: `the owner got ${owned.length} replies, not ${task.replies === "some" ? "one or more" : task.replies}` });
  }
  const items = events.flatMap((e) => (e.kind === "item" ? [{ agent: e.agent, item: e.item }] : []));
  const calls = items.flatMap(({ agent, item }) => (item.type === "tool_call" ? [{ agent, item }] : []));
  const polls = calls.filter(({ item }) => item.name === "list_agents").length;
  if (polls > 0) found.push({ kind: "list_agents", detail: `${polls} list_agents calls` });
  // A read_file of a file that doesn't exist isn't a fault: checking whether
  // a file exists before creating it is ordinary.
  const named = new Map(calls.map(({ item }) => [item.id, item.name]));
  const errors = items.filter(
    ({ item }) => item.type === "tool_result" && item.output.startsWith("Error") && !(named.get(item.callId) === "read_file" && item.output.startsWith("Error: there's no file at ")),
  ).length;
  if (errors > 0) found.push({ kind: "tool_error", detail: `${errors} refused or failed tool calls` });
  const sends = calls.filter(({ item }) => item.name === "message_sub_agent").map(({ agent, item }) => `${agent} ${JSON.stringify(item.input)}`);
  const repeats = sends.length - new Set(sends).size;
  if (repeats > 0) found.push({ kind: "repeat_message", detail: `${repeats} messages sent twice` });
  const filler = ids.slice(1).flatMap((id) => repliesOf(events, id)).filter((text) => text.length < 10);
  if (filler.length > 0) found.push({ kind: "filler_reply", detail: `filler replies: ${filler.map((text) => JSON.stringify(text)).join(", ")}` });
  const modelErrors = events.filter((e) => e.kind === "error").length;
  if (modelErrors > 0) found.push({ kind: "model_error", detail: `${modelErrors} model error events` });
  // No defined task asks for a UI.
  const publishes = calls.filter(({ item }) => item.name === "publish_ui").length;
  if (publishes > 0) found.push({ kind: "publish_ui", detail: `${publishes} publish_ui calls` });
  for (const detail of checked) found.push({ kind: "check", detail });
  return found;
}

// The run's metrics, but for its usage.
export function measure(events: Event[], ids: string[], firstMessageAt: number): Omit<Metrics, "usage"> {
  const last = events.reduce((t, e) => Math.max(t, e.t), firstMessageAt);
  const tools: Record<string, number> = {};
  for (const e of events) if (e.kind === "item" && e.item.type === "tool_call") tools[e.item.name] = (tools[e.item.name] ?? 0) + 1;
  return { durationMs: last - firstMessageAt, agents: ids.length, tools };
}

// The sum of the usage entries for root, or null when the runtime has no
// usage route.
export function sumUsage(entries: (Usage & { root: string })[] | null, root: string): Usage | null {
  if (entries === null) return null;
  const sum: Usage = { calls: 0, inputTokens: 0, cachedTokens: 0, outputTokens: 0, reasoningTokens: 0 };
  for (const entry of entries) {
    if (entry.root !== root) continue;
    sum.calls += entry.calls;
    sum.inputTokens += entry.inputTokens;
    sum.cachedTokens += entry.cachedTokens;
    sum.outputTokens += entry.outputTokens;
    sum.reasoningTokens += entry.reasoningTokens;
    if (entry.cost !== undefined) sum.cost = (sum.cost ?? 0) + entry.cost;
  }
  return sum;
}

// What an agent replied to its parent, read from its stream.
export function repliesOf(events: Event[], agent: string): string[] {
  return repliesIn(events.flatMap((e) => (e.agent === agent && e.kind === "item" ? [e.item] : [])));
}

// The owner's client of a side's runtime. Any answer but a success is a
// HarnessError naming the call.
export class RuntimeApi {
  readonly base: string;
  readonly #headers: Record<string, string>;
  constructor(base: string, ownerToken: string) {
    this.base = base;
    this.#headers = { Authorization: `Bearer ${ownerToken}` };
  }

  async request(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<any> {
    let res: Response;
    try {
      res = await fetch(this.base + path, { method, headers: this.#headers, body: body === undefined ? undefined : JSON.stringify(body), signal });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new HarnessError(`${method} ${path} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    const text = await res.text();
    if (!res.ok) throw new HarnessError(`${method} ${path} answered ${res.status}: ${text}`);
    return text === "" ? undefined : JSON.parse(text);
  }

  // The usage entries, or null when the runtime has no usage route.
  async usage(signal?: AbortSignal): Promise<(Usage & { root: string })[] | null> {
    const res = await fetch(`${this.base}/usage`, { headers: this.#headers, signal }).catch((error) => {
      throw new HarnessError(`GET /usage failed: ${error.message}`);
    });
    if (res.status === 404) return (await res.body?.cancel(), null);
    if (!res.ok) throw new HarnessError(`GET /usage answered ${res.status}: ${await res.text()}`);
    return (await res.json()).agents;
  }

  events(id: string, lastEventId: string | undefined, signal: AbortSignal): Promise<Response> {
    const headers = lastEventId === undefined ? this.#headers : { ...this.#headers, "Last-Event-ID": lastEventId };
    return fetch(`${this.base}/agents/${id}/events`, { headers, signal });
  }
}

export interface RunOptions {
  api: RuntimeApi;
  // The side's runtime name, which names its workspace containers.
  runtime: string;
  task: Task;
  // The root's name, unique in the runtime.
  name: string;
  signal: AbortSignal;
  quietMs?: number;
}

// Runs the task once. Rejects only when signal aborts.
export async function runTask({ api, runtime, task, name, signal, quietMs = QUIET_MS }: RunOptions): Promise<Run> {
  const start = Date.now();
  const limitMs = task.limitMs ?? LIMIT_MS;
  const events: Event[] = [];
  const parents = new Map<string, string | null>();
  const watching = new Map<string, AbortController>();
  // The last event ID seen on each agent's stream, so a stream that ends and
  // is opened again resumes rather than repeating.
  const seen = new Map<string, string>();
  const ids: string[] = [];
  let root: string | undefined;
  let last = Date.now();
  let firstMessageAt = 0;

  const watch = async (id: string) => {
    const abort = new AbortController();
    watching.set(id, abort);
    try {
      const res = await api.events(id, seen.get(id), abort.signal);
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
          const eventId = block.match(/^id: (.*)$/m)?.[1];
          if (eventId !== undefined) seen.set(id, eventId);
          if ((kind === "item" || kind === "error") && data) {
            events.push({ t: Date.now() - start, agent: id, kind, item: JSON.parse(data) } as Event);
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
    const all = (await api.request("GET", "/agents", undefined, signal)) as { id: string; parent: string | null; state: string }[];
    for (const agent of all) parents.set(agent.id, agent.parent);
    const mine = new Set([root!]);
    for (let grew = true; grew; ) {
      grew = false;
      for (const agent of all) if (agent.parent && mine.has(agent.parent) && !mine.has(agent.id)) grew = Boolean(mine.add(agent.id));
    }
    for (const agent of all) if (mine.has(agent.id) && agent.state === "running" && !watching.has(agent.id)) void watch(agent.id);
    // Agents deleted since keep their place.
    for (const id of mine) if (!ids.includes(id)) ids.push(id);
  };
  const sleep = (ms: number) =>
    new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, ms);
      signal.addEventListener("abort", () => (clearTimeout(timer), reject(signal.reason)), { once: true });
    });

  let unsettledAt: number | undefined;
  let checked: string[] = [];
  let usage: Usage | null = null;
  let error: string | undefined;
  try {
    const grant = task.grant ?? { spawn: true };
    root = (await api.request("POST", "/agents", { grant, name }, signal)).id as string;
    ids.push(root);
    void watch(root);
    const seed = randomBytes(4).toString("hex");
    const workspace = (argv: string[], stdin?: string) => exec(`${runtime}-workspace-${root}`, argv, stdin);
    if (task.setup) {
      try {
        await task.setup({ seed, exec: workspace });
      } catch (caught) {
        if (signal.aborted) throw caught;
        throw new HarnessError(`the task's setup failed: ${caught instanceof Error ? caught.message : String(caught)}`);
      }
    }
    let answered = false;
    for (const [i, text] of task.steps(seed).entries()) {
      last = Date.now();
      if (i === 0) firstMessageAt = last - start;
      await api.request("POST", `/agents/${root}/messages`, { text }, signal);
      for (;;) {
        await sleep(POLL_MS);
        await tree();
        // Read once the stream has been quiet for a moment, so a response
        // that's still arriving isn't taken for a reply.
        if (task.answer && !answered && Date.now() - last > POLL_MS && repliesOf(events, root).length > 0) {
          answered = true;
          last = Date.now();
          await api.request("POST", `/agents/${root}/messages`, { text: task.answer }, signal);
        }
        if (Date.now() - last > quietMs) break;
        if (Date.now() - start > limitMs) {
          unsettledAt = i + 1;
          break;
        }
      }
      if (unsettledAt !== undefined) break;
    }
    await tree();
    for (const abort of watching.values()) abort.abort();
    if (task.check) {
      const input: CheckInput = { replies: repliesOf(events, root), seed, exec: workspace };
      checked = await task.check(input);
    }
  } catch (caught) {
    if (signal.aborted) throw caught;
    error = caught instanceof Error ? caught.message : String(caught);
  } finally {
    for (const abort of watching.values()) abort.abort();
  }
  if (root !== undefined && !signal.aborted) {
    try {
      await api.request("DELETE", `/agents/${root}`, undefined, signal);
      // Counts survive the deletion, and include any call it cut off.
      usage = sumUsage(await api.usage(signal), root);
    } catch (caught) {
      if (signal.aborted) throw caught;
      error ??= caught instanceof Error ? caught.message : String(caught);
    }
  }
  if (signal.aborted) throw signal.reason;

  const sorted = [...events].sort((a, b) => a.t - b.t);
  const agents = ids.map((id) => ({ id, parent: id === root ? "owner" : (parents.get(id) ?? "owner") }));
  const metrics = { ...measure(sorted, ids, firstMessageAt), usage };
  if (error !== undefined || root === undefined) return { task: task.name, outcome: "errored", error: error ?? "no root", faults: [], metrics, agents, events: sorted };
  const found = faults({ task, events: sorted, ids, unsettledAt, limitMs, checked });
  return { task: task.name, outcome: found.length === 0 ? "passed" : "failed", faults: found, metrics, agents, events: sorted };
}

// Runs argv in a container as its user. A docker that can't run, or a
// container that's gone, is a HarnessError; a command that fails is not.
function exec(container: string, argv: string[], input?: string): Promise<{ status: number; stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = execFile("docker", ["exec", "-i", container, ...argv], { encoding: "utf8", timeout: 120_000, maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error && typeof error.code !== "number") return reject(new HarnessError(`docker exec failed: ${error.message}`));
      // docker exec itself fails with 125 to 127 when the container is gone.
      if (error && /No such container|is not running/.test(stderr)) return reject(new HarnessError(`docker exec failed: ${stderr.trim()}`));
      resolve({ status: typeof error?.code === "number" ? error.code : 0, stdout });
    });
    child.stdin!.end(input ?? "");
  });
}
