// The statistics an evaluation's report gives: an interval for a pass rate,
// whether two rates or two samples differ by more than chance explains, and
// how many runs would settle a difference that doesn't yet. Each test is
// two-sided at ALPHA, with no correction for comparing many tasks: the report
// says instead how many tasks chance alone would flag.

export const ALPHA = 0.05;
export const POWER = 0.8;
// The standard normal's quantiles at 1 - ALPHA / 2 and at POWER.
const Z_ALPHA = 1.959963984540054;
const Z_POWER = 0.8416212335729143;

// The 95% Wilson score interval for k passes of n runs, as [low, high].
export function wilson(k: number, n: number): [number, number] {
  if (n === 0) return [0, 1];
  const p = k / n;
  const z2 = Z_ALPHA * Z_ALPHA;
  const denominator = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denominator;
  const margin = (Z_ALPHA * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denominator;
  // At none or all passed the bound is exactly 0 or 1, which rounding misses.
  return [k === 0 ? 0 : Math.max(0, center - margin), k === n ? 1 : Math.min(1, center + margin)];
}

const logFactorials: number[] = [0];
function logFactorial(n: number): number {
  for (let i = logFactorials.length; i <= n; i++) logFactorials[i] = logFactorials[i - 1]! + Math.log(i);
  return logFactorials[n]!;
}

// The two-sided p of Fisher's exact test on a passes of n runs against b
// passes of m: the chance, with the margins fixed, of a table no likelier
// than the one seen.
export function fisher(a: number, n: number, b: number, m: number): number {
  const passes = a + b;
  const total = n + m;
  const logP = (x: number) =>
    logFactorial(passes) + logFactorial(total - passes) + logFactorial(n) + logFactorial(m) - logFactorial(total) - logFactorial(x) - logFactorial(n - x) - logFactorial(passes - x) - logFactorial(m - passes + x);
  const seen = logP(a);
  let p = 0;
  for (let x = Math.max(0, passes - m); x <= Math.min(n, passes); x++) {
    const lp = logP(x);
    // A relative tolerance, as R and SciPy use, so ties in likelihood count.
    if (lp <= seen + 1e-7) p += Math.exp(lp);
  }
  return Math.min(1, p);
}

// The Mann–Whitney U test of x against y: U for x, and the two-sided p. It's
// exact when there are no ties and the samples are small, and otherwise, or
// when asked, the normal approximation with the tie and continuity
// corrections.
export function mannWhitney(x: number[], y: number[], method: "auto" | "asymptotic" = "auto"): { u: number; p: number } {
  const n = x.length;
  const m = y.length;
  if (n === 0 || m === 0) return { u: 0, p: 1 };
  const all = [...x.map((v) => ({ v, inX: true })), ...y.map((v) => ({ v, inX: false }))].sort((a, b) => a.v - b.v);
  let rankX = 0;
  let ties = 0;
  for (let i = 0; i < all.length; ) {
    let j = i;
    while (j < all.length && all[j]!.v === all[i]!.v) j++;
    const rank = (i + 1 + j) / 2;
    for (let k = i; k < j; k++) if (all[k]!.inX) rankX += rank;
    const t = j - i;
    ties += t * t * t - t;
    i = j;
  }
  const u = rankX - (n * (n + 1)) / 2;
  if (method === "auto" && ties === 0 && n <= 20 && m <= 20) return { u, p: exactU(u, n, m) };
  const N = n + m;
  const mean = (n * m) / 2;
  const sd = Math.sqrt(((n * m) / 12) * (N + 1 - ties / (N * (N - 1))));
  if (sd === 0) return { u, p: 1 };
  const z = Math.max(0, Math.abs(u - mean) - 0.5) / sd;
  return { u, p: Math.min(1, erfc(z / Math.SQRT2)) };
}

// The two-sided exact p of U = u for samples of n and m with no ties, from
// the counts of each U: the coefficients of the Gaussian binomial (n+m n).
function exactU(u: number, n: number, m: number): number {
  let counts = [1];
  for (let i = 1; i <= n; i++) {
    // Multiply by (1 - q^(m+i)), then divide by (1 - q^i).
    const next = new Array<number>(counts.length + m + i).fill(0);
    counts.forEach((c, k) => {
      next[k]! += c;
      next[k + m + i]! -= c;
    });
    for (let k = i; k < next.length; k++) next[k]! += next[k - i]!;
    counts = next.slice(0, n * m + 1);
  }
  const total = counts.reduce((a, b) => a + b, 0);
  const at = Math.round(u);
  const below = counts.slice(0, at + 1).reduce((a, b) => a + b, 0) / total;
  const above = counts.slice(at).reduce((a, b) => a + b, 0) / total;
  return Math.min(1, 2 * Math.min(below, above));
}

// The complementary error function, to about 1e-7 (Numerical Recipes'
// erfcc, from Chebyshev fitting).
function erfc(x: number): number {
  const z = Math.abs(x);
  const t = 1 / (1 + 0.5 * z);
  const r =
    t *
    Math.exp(
      -z * z -
        1.26551223 +
        t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))),
    );
  return x >= 0 ? r : 2 - r;
}

// The runs per side that would detect a difference between rates p1 and p2
// at ALPHA with POWER, from the two-proportion formula (Fleiss, without the
// continuity correction), or null when the rates are equal.
export function runsPerSide(p1: number, p2: number): number | null {
  if (p1 === p2) return null;
  const mean = (p1 + p2) / 2;
  const root = Z_ALPHA * Math.sqrt(2 * mean * (1 - mean)) + Z_POWER * Math.sqrt(p1 * (1 - p1) + p2 * (1 - p2));
  return Math.ceil((root * root) / ((p1 - p2) * (p1 - p2)));
}

// How many of this many tasks chance alone would flag, on average, if no task
// truly differed.
export function chanceFlags(tasks: number): number {
  return tasks * ALPHA;
}

export type Verdict = "better" | "worse" | "unclear";

// Side a's pass rate against side b's.
export function comparePasses(a: { passes: number; runs: number }, b: { passes: number; runs: number }): { p: number; verdict: Verdict; runsPerSide?: number } {
  const p = fisher(a.passes, a.runs, b.passes, b.runs);
  const rateA = a.runs === 0 ? 0 : a.passes / a.runs;
  const rateB = b.runs === 0 ? 0 : b.passes / b.runs;
  if (p < ALPHA) return { p, verdict: rateA > rateB ? "better" : "worse" };
  const needed = a.runs === 0 || b.runs === 0 ? null : runsPerSide(rateA, rateB);
  return needed === null ? { p, verdict: "unclear" } : { p, verdict: "unclear", runsPerSide: needed };
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

// Side a's sample against side b's: whether a's is higher or lower at ALPHA,
// and the ratio of a's median to b's.
export function compareSamples(a: number[], b: number[]): { p: number; direction: "higher" | "lower" | "unclear"; ratio: number | null } {
  const { u, p } = mannWhitney(a, b);
  const ma = median(a);
  const mb = median(b);
  const ratio = ma === null || mb === null || mb === 0 ? null : ma / mb;
  if (p >= ALPHA) return { p, direction: "unclear", ratio };
  return { p, direction: u > (a.length * b.length) / 2 ? "higher" : "lower", ratio };
}
