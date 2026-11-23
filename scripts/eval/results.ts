// An evaluation's results, kept in evals/<UTC start, YYYY-MM-DDTHHMM>-<id>/:
// runs.jsonl, one line per run appended as it ends, with its full transcript,
// and summary.json, written at the end, or marked partial on an interrupt.
// Both are committed with the change they measured. In runs.jsonl every
// agent ID is replaced by the short name the transcript uses: root, a1, a2…
//
// recording() picks the runs docs/interactions.html replays.

import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Build } from "./build.ts";
import { FAULT_KINDS, type FaultKind, type Run } from "./run.ts";
import { chanceFlags, compareSamples, comparePasses, median, wilson, type Verdict } from "./stats.ts";

export interface Side {
  side: string;
  build: Build;
  model: string;
}

// A run as runs.jsonl holds it.
export interface RunRecord extends Run {
  side: string;
  // The task's hash, and which of its runs on this side this is, from 1.
  hash: string;
  index: number;
}

export interface TaskResult {
  task: string;
  side: string;
  // Passed and failed runs; errored ones count in neither.
  runs: number;
  passes: number;
  errored: number;
  interval: [number, number];
  // How many runs had a fault of each kind.
  faults: Partial<Record<FaultKind, number>>;
  // Medians per run, of the passed and failed. calls and tokens are null
  // when any of them has no usage.
  median: { durationMs: number | null; calls: number | null; tokens: number | null };
}

export interface Comparison {
  task: string;
  passes: { p: number; verdict: Verdict; runsPerSide?: number };
  duration: { p: number; direction: "higher" | "lower" | "unclear"; ratio: number | null };
  // null unless both sides have usage.
  tokens: { p: number; direction: "higher" | "lower" | "unclear"; ratio: number | null } | null;
}

export interface Summary {
  id: string;
  command: string;
  started: string;
  ended: string;
  partial: boolean;
  sides: Side[];
  tasks: { name: string; hash: string }[];
  results: TaskResult[];
  // Side a against side b, for each task, when there are two sides.
  comparisons: Comparison[];
  // How many tasks chance alone would flag, when there are two sides.
  chanceFlags: number | null;
  errors: { side: string; task: string; index: number; error: string }[];
}

// The folder's name: the start in UTC to the minute, then the ID.
export function folderName(start: Date, id: string): string {
  return `${start.toISOString().slice(0, 16).replace(":", "")}-${id}`;
}

export function createFolder(root: string, start: Date, id: string): string {
  const dir = join(root, folderName(start, id));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "runs.jsonl"), "");
  return dir;
}

// The run with every agent ID in it replaced by its short name.
export function shorten<R extends Run>(run: R): R {
  const ids = run.agents.map((a) => a.id);
  const short = (i: number) => (i === 0 ? "root" : `a${i}`);
  // Longest first, so no ID is replaced inside another.
  const order = ids.map((id, i) => [id, short(i)] as const).sort((a, b) => b[0].length - a[0].length);
  let json = JSON.stringify(run);
  for (const [id, name] of order) json = json.replaceAll(id, name);
  return JSON.parse(json);
}

export function appendRun(dir: string, run: RunRecord): void {
  appendFileSync(join(dir, "runs.jsonl"), `${JSON.stringify(shorten(run))}\n`);
}

export function readRuns(dir: string): RunRecord[] {
  return readFileSync(join(dir, "runs.jsonl"), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

export function writeSummary(dir: string, summary: Summary): void {
  writeFileSync(join(dir, "summary.json"), `${JSON.stringify(summary, null, 1)}\n`);
}

export function readSummary(dir: string): Summary {
  return JSON.parse(readFileSync(join(dir, "summary.json"), "utf8"));
}

const tokensOf = (run: Run) => (run.metrics.usage === null ? null : run.metrics.usage.inputTokens + run.metrics.usage.outputTokens);

export function summarize(input: Omit<Summary, "results" | "comparisons" | "chanceFlags" | "errors"> & { runs: RunRecord[] }): Summary {
  const { runs, ...rest } = input;
  const of = (task: string, side: string) => runs.filter((r) => r.task === task && r.side === side);
  const judged = (rs: RunRecord[]) => rs.filter((r) => r.outcome !== "errored");
  const results: TaskResult[] = [];
  for (const { name } of input.tasks) {
    for (const { side } of input.sides) {
      const all = of(name, side);
      const counted = judged(all);
      const passes = counted.filter((r) => r.outcome === "passed").length;
      const faults: Partial<Record<FaultKind, number>> = {};
      for (const kind of FAULT_KINDS) {
        const n = counted.filter((r) => r.faults.some((f) => f.kind === kind)).length;
        if (n > 0) faults[kind] = n;
      }
      const usage = counted.length > 0 && counted.every((r) => r.metrics.usage !== null);
      results.push({
        task: name,
        side,
        runs: counted.length,
        passes,
        errored: all.length - counted.length,
        interval: wilson(passes, counted.length),
        faults,
        median: {
          durationMs: median(counted.map((r) => r.metrics.durationMs)),
          calls: usage ? median(counted.map((r) => r.metrics.usage!.calls)) : null,
          tokens: usage ? median(counted.map((r) => tokensOf(r)!)) : null,
        },
      });
    }
  }
  const comparisons: Comparison[] = [];
  if (input.sides.length === 2) {
    const [a, b] = input.sides.map((s) => s.side) as [string, string];
    for (const { name } of input.tasks) {
      const ra = judged(of(name, a));
      const rb = judged(of(name, b));
      const count = (rs: RunRecord[]) => ({ passes: rs.filter((r) => r.outcome === "passed").length, runs: rs.length });
      const usage = ra.length > 0 && rb.length > 0 && [...ra, ...rb].every((r) => r.metrics.usage !== null);
      comparisons.push({
        task: name,
        passes: comparePasses(count(ra), count(rb)),
        duration: compareSamples(
          ra.map((r) => r.metrics.durationMs),
          rb.map((r) => r.metrics.durationMs),
        ),
        tokens: usage ? compareSamples(ra.map((r) => tokensOf(r)!), rb.map((r) => tokensOf(r)!)) : null,
      });
    }
  }
  const errors = runs.filter((r) => r.outcome === "errored").map((r) => ({ side: r.side, task: r.task, index: r.index, error: r.error ?? "" }));
  return { ...rest, results, comparisons, chanceFlags: input.sides.length === 2 ? chanceFlags(input.tasks.length) : null, errors };
}

// What docs/interactions.html replays: each task's first passed run, or else
// its first failed one, in the order of the tasks. Side a's come first, since
// it's the build being evaluated.
export function recording(summary: Summary, runs: RunRecord[]) {
  const order = summary.sides.map((s) => s.side);
  const ranked = [...runs].sort((x, y) => order.indexOf(x.side) - order.indexOf(y.side));
  const picked = summary.tasks.flatMap(({ name }) => {
    const run = ranked.find((r) => r.task === name && r.outcome === "passed") ?? ranked.find((r) => r.task === name && r.outcome === "failed");
    return run === undefined ? [] : [run];
  });
  const model = (side: string) => summary.sides.find((s) => s.side === side)?.model;
  return {
    recorded: summary.started.slice(0, 10),
    evaluation: folderName(new Date(summary.started), summary.id),
    model: [...new Set(picked.map((r) => model(r.side)))].join(", "),
    runs: picked.map((r) => ({ task: r.task, side: r.side, outcome: r.outcome, faults: r.faults, agents: r.agents, events: r.events })),
  };
}

export function writeRecording(path: string, data: ReturnType<typeof recording>): void {
  writeFileSync(path, `// Written by npm run eval -- record evals/${data.evaluation}.\nwindow.JEN_RECORDING = ${JSON.stringify(data, null, 1)};\n`);
}
