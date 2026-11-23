import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { report } from "./report.ts";
import { appendRun, createFolder, folderName, readRuns, readSummary, recording, shorten, summarize, writeRecording, writeSummary, type RunRecord, type Side, type Summary } from "./results.ts";
import type { Fault, Usage } from "./run.ts";

let root: string;
beforeEach(() => (root = mkdtempSync(join(tmpdir(), "jen-eval-results-test-"))));
afterEach(() => rmSync(root, { recursive: true, force: true }));

const build = (ref: string | null) => ({ ref, tree: "35faaf97afccae441b100a649fa0839be1a763ee", commit: "e3a9be25af7dfb401aabbf3208859c2663142b9c", dirty: ref === null });
const sides: Side[] = [
  { side: "a", build: build(null), model: "openai/gpt-6-luna" },
  { side: "b", build: build("main"), model: "openai/gpt-6-luna" },
];
const usage = (tokens: number): Usage => ({ calls: tokens / 100, inputTokens: tokens * 0.8, cachedTokens: 0, outputTokens: tokens * 0.2, reasoningTokens: 0 });
let n = 0;
function run(side: string, task: string, outcome: RunRecord["outcome"], options: { faults?: Fault[]; seconds?: number; tokens?: number | null; error?: string } = {}): RunRecord {
  const root = `r${(++n).toString(16).padStart(11, "0")}`;
  const child = `c${n.toString(16).padStart(11, "0")}`;
  return {
    side,
    task,
    hash: "h",
    index: n,
    outcome,
    ...(options.error === undefined ? {} : { error: options.error }),
    faults: options.faults ?? (outcome === "failed" ? [{ kind: "replies", detail: "the owner got 0 replies, not 1" }] : []),
    metrics: { durationMs: (options.seconds ?? 40) * 1000, agents: 2, tools: { spawn_agent: 1 }, usage: options.tokens === null ? null : usage(options.tokens ?? 1000) },
    agents: [
      { id: root, parent: "owner" },
      { id: child, parent: root },
    ],
    events: [
      { t: 100, agent: root, kind: "item", item: { type: "tool_call", id: "c1", name: "spawn_agent", input: {} } },
      { t: 200, agent: root, kind: "item", item: { type: "tool_result", callId: "c1", output: `{"id":"${child}"}` } },
      { t: 300, agent: child, kind: "item", item: { type: "message", role: "assistant", text: "hi" } },
    ],
  };
}

test("an evaluation's folder is named for its UTC start and its ID", () => {
  expect(folderName(new Date("2026-11-23T09:05:59.123Z"), "1a2b3c")).toBe("2026-11-23T0905-1a2b3c");
});

test("a run is stored with every agent ID shortened", () => {
  const r = run("a", "delegation", "passed");
  const short = shorten(r);
  expect(short.agents).toEqual([
    { id: "root", parent: "owner" },
    { id: "a1", parent: "root" },
  ]);
  expect(short.events.map((e) => e.agent)).toEqual(["root", "root", "a1"]);
  expect(JSON.stringify(short)).not.toContain(r.agents[1]!.id);
  expect(short.events[1]).toMatchObject({ item: { output: '{"id":"a1"}' } });
});

test("an interrupted evaluation's folder holds the runs that ended and a partial summary", () => {
  const started = new Date("2026-11-23T09:05:00Z");
  const dir = createFolder(root, started, "abc123");
  expect(readdirSync(root)).toEqual(["2026-11-23T0905-abc123"]);
  const ended = [run("a", "direct", "passed"), run("b", "direct", "failed")];
  for (const r of ended) appendRun(dir, r);
  // Each run is on disk as soon as it's appended, before any summary.
  expect(readFileSync(join(dir, "runs.jsonl"), "utf8").trim().split("\n")).toHaveLength(2);
  writeSummary(dir, summarize({ id: "abc123", command: "npm run eval -- --tasks direct", started: started.toISOString(), ended: started.toISOString(), partial: true, sides, tasks: [{ name: "direct", hash: "h" }], runs: ended }));
  expect(readRuns(dir).map((r) => [r.side, r.outcome])).toEqual([
    ["a", "passed"],
    ["b", "failed"],
  ]);
  expect(readSummary(dir)).toMatchObject({ partial: true, results: [{ task: "direct", side: "a", passes: 1, runs: 1 }, { task: "direct", side: "b", passes: 0, runs: 1 }] });
});

describe("a summary", () => {
  test("counts passes of judged runs, faults by kind, errored runs apart, and medians", () => {
    const runs = [
      run("a", "files", "passed", { seconds: 30 }),
      run("a", "files", "failed", { seconds: 50, faults: [{ kind: "tool_error", detail: "1 refused" }, { kind: "check", detail: "x" }, { kind: "check", detail: "y" }] }),
      run("a", "files", "passed", { seconds: 40 }),
      run("a", "files", "errored", { error: "POST /agents answered 500: no" }),
    ];
    const summary = summarize({ id: "x", command: "c", started: "s", ended: "e", partial: false, sides: [sides[0]!], tasks: [{ name: "files", hash: "h" }], runs });
    expect(summary.results).toEqual([
      { task: "files", side: "a", runs: 3, passes: 2, errored: 1, interval: [expect.closeTo(0.2077, 3), expect.closeTo(0.9385, 3)], faults: { tool_error: 1, check: 1 }, median: { durationMs: 40_000, calls: 10, tokens: 1000 } },
    ]);
    expect(summary.errors).toEqual([{ side: "a", task: "files", index: runs[3]!.index, error: "POST /agents answered 500: no" }]);
    expect(summary.comparisons).toEqual([]);
    expect(summary.chanceFlags).toBeNull();
  });
});

// A stored summary of two sides: side a drops on delegation, and side b,
// built from a ref with no usage route, has no tokens.
function twoSides(): Summary {
  const runs: RunRecord[] = [];
  for (let i = 0; i < 20; i++) {
    runs.push(run("a", "delegation", i < 8 ? "passed" : "failed", { seconds: 60 + i, faults: i < 8 ? [] : [{ kind: "filler_reply", detail: 'filler replies: "Done."' }] }));
    runs.push(run("b", "delegation", i < 19 ? "passed" : "failed", { seconds: 30 + i, tokens: null }));
    runs.push(run("a", "direct", "passed", { seconds: 10 + (i % 3) }));
    runs.push(run("b", "direct", i < 19 ? "passed" : "failed", { seconds: 10 + (i % 3), tokens: null }));
  }
  runs.push(run("b", "direct", "errored", { tokens: null, error: "docker exec failed: No such container" }));
  return summarize({
    id: "abc123",
    command: "npm run eval -- --against main --tasks delegation,direct --runs 20",
    started: "2026-11-23T09:05:00.000Z",
    ended: "2026-11-23T09:35:00.000Z",
    partial: false,
    sides,
    tasks: [
      { name: "delegation", hash: "h1" },
      { name: "direct", hash: "h2" },
    ],
    runs,
  });
}

describe("the report", () => {
  test("of two sides gives rates, intervals, verdicts, fault kinds and medians, and tokens only for the side that has them", () => {
    const summary = twoSides();
    writeSummary(root, summary);
    const text = report(readSummary(root));
    expect(text).toContain("| a | working tree on `e3a9be2` (dirty), tree `35faaf9` | `openai/gpt-6-luna` |");
    expect(text).toContain("| b | `main` at `e3a9be2`, tree `35faaf9` | `openai/gpt-6-luna` |");
    expect(text).toContain("| Task | Passed, a | Passed, b | a against b |");
    expect(text).toMatch(/\| delegation \| 8\/20 \(22%–61%\) \| 19\/20 \(76%–99%\) \| \*\*worse\*\* \(p < 0\.001\) \|/);
    expect(text).toMatch(/\| direct \| 20\/20 \(84%–100%\) \| 19\/20 \(76%–99%\), 1 errored \| unclear: about \d+ runs a side would settle it \|/);
    expect(text).toContain("chance alone would flag about 0.1 of these 2 tasks");
    expect(text).toContain("| delegation | filler_reply 12 | replies 1 |");
    expect(text).toContain("| Task | Time, a | Time, b | Time, a against b | Calls, a | Tokens, a |");
    expect(text).toMatch(/\| delegation \| 70s \| 40s \| \*\*slower\*\* ×1\.\d\d \| 10 \| 1\.0k \|/);
    expect(text).not.toContain("Tokens, b");
    expect(text).not.toContain("Tokens, a against b");
    expect(text).toContain("No tokens for b: its runtime has no usage route.");
    expect(text).toMatch(/- b direct #\d+: docker exec failed: No such container/);
  });

  test("of two sides that both have tokens compares them", () => {
    const runs = [run("a", "direct", "passed", { tokens: 3000 }), run("b", "direct", "passed", { tokens: 1000 })];
    const text = report(summarize({ id: "x", command: "c", started: "s", ended: "e", partial: false, sides, tasks: [{ name: "direct", hash: "h" }], runs }));
    expect(text).toContain("| Calls, a | Tokens, a | Calls, b | Tokens, b | Tokens, a against b |");
    expect(text).toContain("| 30 | 3.0k | 10 | 1.0k | unclear ×3.00 |");
  });

  test("of a partial evaluation says so", () => {
    const summary = { ...twoSides(), partial: true };
    expect(report(summary)).toMatch(/^### Evaluation `abc123` \(partial: interrupted\)/);
  });
});

describe("the recording", () => {
  test("holds each task's first passed run, or else its first failed one, with its faults", () => {
    const summary: Summary = { ...twoSides(), tasks: [{ name: "relay", hash: "h3" }, { name: "direct", hash: "h2" }, { name: "never", hash: "h4" }] };
    const runs = [
      run("a", "relay", "errored", { error: "x" }),
      run("a", "relay", "failed", { faults: [{ kind: "replies", detail: "the owner got 1 replies, not 2" }] }),
      run("b", "relay", "failed"),
      run("b", "direct", "failed"),
      run("a", "direct", "passed"),
    ].map(shorten);
    const data = recording(summary, runs);
    expect(data).toMatchObject({ recorded: "2026-11-23", evaluation: "2026-11-23T0905-abc123", model: "openai/gpt-6-luna" });
    expect(data.runs.map((r) => [r.task, r.side, r.outcome])).toEqual([
      ["relay", "a", "failed"],
      ["direct", "a", "passed"],
    ]);
    expect(data.runs[0]!.faults).toEqual([{ kind: "replies", detail: "the owner got 1 replies, not 2" }]);
    expect(data.runs[0]!.agents[0]).toEqual({ id: "root", parent: "owner" });
    const path = join(root, "interactions.data.js");
    writeRecording(path, data);
    const window: { JEN_RECORDING?: unknown } = {};
    new Function("window", readFileSync(path, "utf8"))(window);
    expect(window.JEN_RECORDING).toEqual(data);
  });
});
