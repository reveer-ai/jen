// npm run eval: measures how jen's agents behave on a real model, and
// compares two builds or two models side by side.
//
//   npm run eval -- [options]              runs an evaluation
//   npm run eval -- report <evaluation>    prints its report as Markdown
//   npm run eval -- record <evaluation>    writes docs/interactions.data.js
//
// An evaluation has side a, the build and model given, and side b when
// --against or --against-model is given. Each side's images are built under
// tags of the evaluation's own and run by a runtime of its own. Both sides
// run the working tree's tasks, in one queue that alternates sides and cycles
// through tasks, --parallel runs at a time. Each run is appended to
// evals/<folder>/runs.jsonl as it ends, and the summary is written at the end,
// or marked partial on an interrupt. Everything the evaluation started is
// removed when it ends, interrupted or not.
//
// It exits 0 once every run has ended, whatever the rates, and non-zero only
// when it can't carry out the evaluation.

import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { buildImages, identify, type Build } from "./build.ts";
import { report } from "./report.ts";
import { appendRun, createFolder, readRuns, readSummary, recording, summarize, writeRecording, writeSummary, type RunRecord, type Side } from "./results.ts";
import { runTask, type Run } from "./run.ts";
import { removeSide, startSide } from "./side.ts";
import { hashTask, promptTask, TASKS, type Grant, type Task } from "./tasks.ts";

const ROOT = join(import.meta.dirname, "../..");
const EVALS = join(ROOT, "evals");

export interface Options {
  tasks: Task[];
  runs: number;
  model: string;
  build: string | null;
  against: string | null;
  againstModel: string | null;
  parallel: number;
}

export type Command = { command: "evaluate"; options: Options } | { command: "report"; evaluation: string } | { command: "record"; evaluation: string };

export class UsageError extends Error {
  override name = "UsageError";
}

const USAGE = `Usage:
  npm run eval -- [--tasks <a,b>] [--runs <n>] [--model <id>] [--build <ref>]
                  [--against <ref>] [--against-model <id>]
                  [--prompt <text> [--grant <spawn,workspace>]] [--parallel <n>]
  npm run eval -- report <evaluation>
  npm run eval -- record <evaluation>

Tasks: ${TASKS.map((t) => t.name).join(", ")}`;

// The command the arguments ask for. env supplies the default model.
export function parse(argv: string[], env: NodeJS.ProcessEnv): Command {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        tasks: { type: "string" },
        runs: { type: "string" },
        model: { type: "string" },
        build: { type: "string" },
        against: { type: "string" },
        "against-model": { type: "string" },
        prompt: { type: "string" },
        grant: { type: "string" },
        parallel: { type: "string" },
        help: { type: "boolean" },
      },
    });
  } catch (error) {
    throw new UsageError(`${error instanceof Error ? error.message : String(error)}\n\n${USAGE}`);
  }
  const { values, positionals } = parsed;
  if (values.help) throw new UsageError(USAGE);
  if (positionals[0] === "report" || positionals[0] === "record") {
    if (positionals.length !== 2) throw new UsageError(`${positionals[0]} takes one evaluation, its folder under evals/\n\n${USAGE}`);
    return { command: positionals[0], evaluation: positionals[1]! };
  }
  if (positionals.length > 0) throw new UsageError(`unknown command ${JSON.stringify(positionals[0])}\n\n${USAGE}`);

  const count = (name: string, value: string | undefined, fallback: number) => {
    if (value === undefined) return fallback;
    const n = Number(value);
    if (!Number.isSafeInteger(n) || n < 1) throw new UsageError(`--${name} must be a positive whole number, not ${JSON.stringify(value)}`);
    return n;
  };
  if (values.grant !== undefined && values.prompt === undefined) throw new UsageError("--grant applies only to --prompt");
  const tasks: Task[] = [];
  if (values.tasks !== undefined || values.prompt === undefined) {
    const names = values.tasks === undefined ? TASKS.map((t) => t.name) : values.tasks.split(",").map((n) => n.trim()).filter(Boolean);
    for (const name of names) {
      const task = TASKS.find((t) => t.name === name);
      if (!task) throw new UsageError(`no task named ${JSON.stringify(name)}; the tasks are ${TASKS.map((t) => t.name).join(", ")}`);
      if (!tasks.includes(task)) tasks.push(task);
    }
    if (tasks.length === 0) throw new UsageError("--tasks names no task");
  }
  if (values.prompt !== undefined) {
    if (values.prompt.trim() === "") throw new UsageError("--prompt is empty");
    const grant: Grant = {};
    for (const key of (values.grant ?? "spawn").split(",").map((k) => k.trim()).filter(Boolean)) {
      if (key !== "spawn" && key !== "workspace") throw new UsageError(`--grant takes spawn and workspace, not ${JSON.stringify(key)}`);
      grant[key] = true;
    }
    tasks.push(promptTask(values.prompt, grant));
  }
  const model = values.model ?? env.JEN_LIVE_MODEL ?? "";
  return {
    command: "evaluate",
    options: {
      tasks,
      runs: count("runs", values.runs, 10),
      model,
      build: values.build ?? null,
      against: values.against ?? null,
      againstModel: values["against-model"] ?? null,
      parallel: count("parallel", values.parallel, 24),
    },
  };
}

// The credentials an evaluation needs, or a UsageError naming what's missing.
export function credentials(options: Options, env: NodeJS.ProcessEnv): { apiKey: string; baseURL?: string } {
  if (!env.JEN_LIVE_API_KEY) throw new UsageError("JEN_LIVE_API_KEY is not set, in the environment or in .env");
  if (!options.model) throw new UsageError("no model: set JEN_LIVE_MODEL, in the environment or in .env, or pass --model");
  return { apiKey: env.JEN_LIVE_API_KEY, ...(env.JEN_LIVE_BASE_URL ? { baseURL: env.JEN_LIVE_BASE_URL } : {}) };
}

// The order runs start in: round by round, each task in turn, each side in
// turn, so the sides alternate and both span the same minutes.
export function queue<T>(tasks: T[], sides: string[], runs: number): { side: string; task: T; index: number }[] {
  const order: { side: string; task: T; index: number }[] = [];
  for (let index = 1; index <= runs; index++) for (const task of tasks) for (const side of sides) order.push({ side, task, index });
  return order;
}

// Runs items through work, at most parallel at a time, in order. Once signal
// aborts, starts no more, and resolves when those in flight have settled.
export async function pool<T>(items: T[], parallel: number, signal: AbortSignal, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length && !signal.aborted) {
      const item = items[next++]!;
      await work(item).catch(() => {});
    }
  };
  await Promise.all(Array.from({ length: Math.min(parallel, items.length) }, worker));
}

const quote = (arg: string) => (/^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replaceAll("'", `'\\''`)}'`);

async function evaluate(argv: string[], options: Options, { apiKey, baseURL }: { apiKey: string; baseURL?: string }): Promise<number> {
  const id = randomBytes(3).toString("hex");
  const started = new Date();
  const abort = new AbortController();
  let interrupted = false;
  const onSignal = () => {
    if (interrupted) return void process.stderr.write("eval: still removing what it started…\n");
    interrupted = true;
    process.stderr.write("\neval: interrupted; stopping runs and removing what it started…\n");
    abort.abort(new Error("interrupted"));
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  const sides: { side: string; ref: string | null; model: string }[] = [{ side: "a", ref: options.build, model: options.model }];
  if (options.against !== null || options.againstModel !== null) sides.push({ side: "b", ref: options.against ?? options.build, model: options.againstModel ?? options.model });
  const started_ = new Set<string>();
  const runs: RunRecord[] = [];
  let dir: string | undefined;
  let described: Side[] = [];
  const tasks = options.tasks.map((t) => ({ name: t.name, hash: hashTask(t) }));
  const finish = (partial: boolean) => {
    if (dir === undefined) return;
    const summary = summarize({ id, command: `npm run eval -- ${argv.map(quote).join(" ")}`, started: started.toISOString(), ended: new Date().toISOString(), partial, sides: described, tasks, runs });
    writeSummary(dir, summary);
    process.stdout.write(`\n${report(summary)}\nResults: ${dir}\n`);
  };

  let status = 0;
  try {
    const builds: Build[] = [];
    for (const s of sides) builds.push(await identify(ROOT, s.ref));
    described = sides.map((s, i) => ({ side: s.side, build: builds[i]!, model: s.model }));
    dir = createFolder(EVALS, started, id);
    process.stderr.write(`eval ${id}: ${options.tasks.length} tasks × ${options.runs} runs × ${sides.length} sides, into ${dir}\n`);
    const apis = new Map<string, { name: string; api: Awaited<ReturnType<typeof startSide>>["api"] }>();
    for (const [i, s] of sides.entries()) {
      process.stderr.write(`eval ${id}: building side ${s.side} (${s.ref ?? "working tree"})…\n`);
      started_.add(s.side);
      await buildImages(ROOT, builds[i]!, id, s.side, abort.signal);
      abort.signal.throwIfAborted();
      apis.set(s.side, await startSide({ id, side: s.side, model: s.model, apiKey, baseURL, inFlight: options.parallel }));
    }
    const order = queue(options.tasks, sides.map((s) => s.side), options.runs);
    const roots = new Map<string, number>();
    let ended = 0;
    await pool(order, options.parallel, abort.signal, async ({ side, task, index }) => {
      const { name, api } = apis.get(side)!;
      const n = (roots.get(side) ?? 0) + 1;
      roots.set(side, n);
      const run: Run = await runTask({ api, runtime: name, task, name: `run-${n}`, signal: abort.signal });
      const record: RunRecord = { side, hash: hashTask(task), index, ...run };
      runs.push(record);
      appendRun(dir!, record);
      ended++;
      const detail = run.outcome === "errored" ? `: ${run.error}` : run.outcome === "failed" ? `: ${run.faults.map((f) => `${f.kind} (${f.detail})`).join("; ")}` : "";
      process.stderr.write(`[${ended}/${order.length}] ${side} ${task.name} #${index} ${run.outcome} in ${Math.round(run.metrics.durationMs / 1000)}s${detail}\n`);
    });
    if (!abort.signal.aborted) finish(false);
  } catch (error) {
    if (!abort.signal.aborted) {
      process.stderr.write(`eval: ${error instanceof Error ? error.message : String(error)}\n`);
      status = 1;
    }
  } finally {
    if (abort.signal.aborted) finish(true);
    for (const side of started_) await removeSide(id, side);
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
  }
  return interrupted ? 130 : status;
}

// The folder of an evaluation given by path or by its name under evals/.
function folder(evaluation: string): string {
  for (const dir of [resolve(evaluation), join(EVALS, evaluation)]) if (existsSync(join(dir, "summary.json"))) return dir;
  throw new UsageError(`no evaluation at ${evaluation}: it needs a summary.json`);
}

export async function main(argv: string[], env: NodeJS.ProcessEnv = process.env): Promise<number> {
  try {
    const command = parse(argv, env);
    if (command.command === "report" || command.command === "record") {
      const dir = folder(command.evaluation);
      if (command.command === "report") {
        process.stdout.write(report(readSummary(dir)));
        return 0;
      }
      const data = recording(readSummary(dir), readRuns(dir));
      writeRecording(join(ROOT, "docs/interactions.data.js"), data);
      process.stdout.write(`docs/interactions.data.js holds ${data.runs.length} runs from ${data.evaluation}.\n`);
      return 0;
    }
    return await evaluate(argv, command.options, credentials(command.options, env));
  } catch (error) {
    process.stderr.write(`eval: ${error instanceof Error ? error.message : String(error)}\n`);
    return error instanceof UsageError ? 2 : 1;
  }
}

if (import.meta.main) {
  if (existsSync(join(ROOT, ".env"))) process.loadEnvFile(join(ROOT, ".env"));
  process.exitCode = await main(process.argv.slice(2));
}
