// An evaluation's report as Markdown, from its summary alone, ready to paste
// into a pull request. With two sides, verdicts are side a's against side b's.

import { ALPHA } from "./stats.ts";
import type { Comparison, Side, Summary, TaskResult } from "./results.ts";

const percent = (x: number) => `${Math.round(x * 100)}%`;
const seconds = (ms: number | null) => (ms === null ? "—" : `${Math.round(ms / 1000)}s`);
const number = (n: number | null) => (n === null ? "—" : n >= 10_000 ? `${(n / 1000).toFixed(0)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${Math.round(n)}`);

function build({ build }: Side): string {
  const where = build.ref === null ? `working tree on \`${build.commit.slice(0, 7)}\`${build.dirty ? " (dirty)" : ""}` : `\`${build.ref}\` at \`${build.commit.slice(0, 7)}\``;
  return `${where}, tree \`${build.tree.slice(0, 7)}\``;
}

function rate(r: TaskResult | undefined): string {
  if (r === undefined || r.runs === 0) return r && r.errored > 0 ? `— (${r.errored} errored)` : "—";
  const [low, high] = r.interval;
  return `${r.passes}/${r.runs} (${percent(low)}–${percent(high)})${r.errored > 0 ? `, ${r.errored} errored` : ""}`;
}

function verdict(c: Comparison): string {
  const { verdict, runsPerSide } = c.passes;
  if (verdict !== "unclear") return `**${verdict}** (${c.passes.p < 0.001 ? "p < 0.001" : `p = ${c.passes.p.toFixed(3)}`})`;
  return runsPerSide === undefined ? "unclear" : `unclear: about ${runsPerSide} runs a side would settle it`;
}

function change(c: { direction: "higher" | "lower" | "unclear"; ratio: number | null } | null, higher: string, lower: string): string {
  if (c === null) return "—";
  const ratio = c.ratio === null ? "" : ` ×${c.ratio.toFixed(2)}`;
  return c.direction === "unclear" ? `unclear${ratio}` : `**${c.direction === "higher" ? higher : lower}**${ratio}`;
}

function faults(r: TaskResult | undefined): string {
  const entries = Object.entries(r?.faults ?? {});
  return entries.length === 0 ? "—" : entries.map(([kind, n]) => `${kind} ${n}`).join(", ");
}

const table = (head: string[], rows: string[][]) => [`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`, ...rows.map((row) => `| ${row.join(" | ")} |`)].join("\n");

export function report(summary: Summary): string {
  const sides = summary.sides.map((s) => s.side);
  const result = (task: string, side: string) => summary.results.find((r) => r.task === task && r.side === side);
  const comparison = (task: string) => summary.comparisons.find((c) => c.task === task);
  const two = sides.length === 2;
  const out: string[] = [];

  out.push(`### Evaluation \`${summary.id}\`${summary.partial ? " (partial: interrupted)" : ""}`);
  out.push("");
  out.push(`\`${summary.command}\`, from ${summary.started} to ${summary.ended}.`);
  out.push("");
  out.push(table(["Side", "Build", "Model"], summary.sides.map((s) => [s.side, build(s), `\`${s.model}\``])));
  out.push("");

  out.push(table(["Task", ...sides.map((s) => `Passed, ${s}`), ...(two ? ["a against b"] : [])], summary.tasks.map(({ name }) => [name, ...sides.map((s) => rate(result(name, s))), ...(two ? [verdict(comparison(name)!)] : [])])));
  out.push("");
  if (two && summary.chanceFlags !== null) {
    out.push(`A verdict is called at p < ${ALPHA}, so chance alone would flag about ${summary.chanceFlags.toFixed(1)} of these ${summary.tasks.length} tasks. Rerun a flagged task alone, with more runs, to confirm it.`);
    out.push("");
  }

  out.push("Runs with each kind of fault:");
  out.push("");
  out.push(table(["Task", ...sides], summary.tasks.map(({ name }) => [name, ...sides.map((s) => faults(result(name, s)))])));
  out.push("");

  // Tokens show for a side whose runs all have them, and are compared only
  // when both sides' are.
  const tokens = sides.filter((s) => summary.results.some((r) => r.side === s && r.median.tokens !== null));
  const compared = two && summary.comparisons.some((c) => c.tokens !== null);
  out.push("Medians per run:");
  out.push("");
  out.push(
    table(
      ["Task", ...sides.map((s) => `Time, ${s}`), ...(two ? ["Time, a against b"] : []), ...tokens.flatMap((s) => [`Calls, ${s}`, `Tokens, ${s}`]), ...(compared ? ["Tokens, a against b"] : [])],
      summary.tasks.map(({ name }) => [
        name,
        ...sides.map((s) => seconds(result(name, s)?.median.durationMs ?? null)),
        ...(two ? [change(comparison(name)!.duration, "slower", "faster")] : []),
        ...tokens.flatMap((s) => [number(result(name, s)?.median.calls ?? null), number(result(name, s)?.median.tokens ?? null)]),
        ...(compared ? [change(comparison(name)!.tokens, "more", "fewer")] : []),
      ]),
    ),
  );
  // A side with runs but no tokens ran a build with no usage route.
  const untokened = sides.filter((s) => !tokens.includes(s) && summary.results.some((r) => r.side === s && r.runs > 0));
  if (untokened.length > 0) {
    out.push("");
    out.push(`No tokens for ${untokened.join(" and ")}: its runtime has no usage route.`);
  }

  if (summary.errors.length > 0) {
    out.push("");
    out.push("Errored runs, which count toward no rate:");
    out.push("");
    for (const e of summary.errors) out.push(`- ${e.side} ${e.task} #${e.index}: ${e.error.replace(/\s+/g, " ").slice(0, 300)}`);
  }
  return `${out.join("\n")}\n`;
}
