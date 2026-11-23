import { describe, expect, test } from "vitest";
import { chanceFlags, compareSamples, comparePasses, fisher, mannWhitney, median, runsPerSide, wilson } from "./stats.ts";

describe("the Wilson interval", () => {
  // Newcombe (1998), "Two-sided confidence intervals for the single
  // proportion", Statistics in Medicine 17, table I, method 3.
  test.each([
    [81, 263, 0.2553, 0.3662],
    [15, 148, 0.0624, 0.1605],
    [0, 20, 0, 0.1611],
    [1, 29, 0.0061, 0.1718],
  ])("%i of %i is %f to %f", (k, n, low, high) => {
    const [l, h] = wilson(k, n);
    expect(l).toBeCloseTo(low, 4);
    expect(h).toBeCloseTo(high, 4);
  });

  test("all passed reaches 1, and no runs says nothing", () => {
    expect(wilson(10, 10)[1]).toBe(1);
    expect(wilson(0, 0)).toEqual([0, 1]);
  });
});

describe("Fisher's exact test", () => {
  test("Fisher's tea tasting, 3 of 4 against 1 of 4, is p = 0.4857", () => {
    expect(fisher(3, 4, 1, 4)).toBeCloseTo(0.485714, 5);
  });
  // SciPy's scipy.stats.fisher_exact examples.
  test("8 of 10 against 1 of 6 is p = 0.03497", () => {
    expect(fisher(8, 10, 1, 6)).toBeCloseTo(0.034965, 5);
  });
  test("1 of 12 against 9 of 12 is p = 0.002759", () => {
    expect(fisher(1, 12, 9, 12)).toBeCloseTo(0.0027594, 6);
  });
  test("is symmetric, and 1 for equal rates", () => {
    expect(fisher(2, 3, 3, 3)).toBe(fisher(3, 3, 2, 3));
    expect(fisher(5, 10, 5, 10)).toBeCloseTo(1, 10);
  });
});

describe("the Mann–Whitney U test", () => {
  // SciPy's scipy.stats.mannwhitneyu example.
  const males = [19, 22, 16, 29, 24];
  const females = [20, 11, 17, 12];
  test("exact: U = 17, p = 0.1111", () => {
    expect(mannWhitney(males, females)).toEqual({ u: 17, p: expect.closeTo(1 / 9, 10) });
  });
  test("by the normal approximation: p = 0.1113", () => {
    expect(mannWhitney(males, females, "asymptotic")).toEqual({ u: 17, p: expect.closeTo(0.11134688653314041, 6) });
  });
  test("with ties, U counts each tie as half", () => {
    // 24 beats 11, ties 24 and loses to 30.
    expect(mannWhitney([24], [11, 24, 30]).u).toBe(1.5);
  });
});

describe("runs per side", () => {
  test("30% against 50% takes 93 a side (Fleiss, without the continuity correction)", () => {
    expect(runsPerSide(0.3, 0.5)).toBe(93);
  });
  test("is symmetric, and null for equal rates", () => {
    expect(runsPerSide(0.5, 0.3)).toBe(93);
    expect(runsPerSide(0.9, 0.9)).toBeNull();
  });
});

describe("comparing two sides' passes", () => {
  test("too few runs: 2 of 3 against 3 of 3 is unclear, with how many runs would settle it", () => {
    const result = comparePasses({ passes: 2, runs: 3 }, { passes: 3, runs: 3 });
    expect(result).toEqual({ p: expect.closeTo(1, 10), verdict: "unclear", runsPerSide: 19 });
  });
  test("a clear drop: 30 of 50 against 48 of 50 is worse, and the other way better", () => {
    expect(comparePasses({ passes: 30, runs: 50 }, { passes: 48, runs: 50 })).toMatchObject({ verdict: "worse" });
    expect(comparePasses({ passes: 48, runs: 50 }, { passes: 30, runs: 50 })).toMatchObject({ verdict: "better" });
    expect(comparePasses({ passes: 30, runs: 50 }, { passes: 48, runs: 50 }).p).toBeLessThan(0.001);
  });
  test("the same rate is unclear with no estimate", () => {
    expect(comparePasses({ passes: 10, runs: 10 }, { passes: 10, runs: 10 })).toEqual({ p: expect.closeTo(1, 10), verdict: "unclear" });
  });
});

describe("comparing two sides' samples", () => {
  test("a clearly slower side is higher, with the ratio of medians", () => {
    const fast = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19];
    const slow = fast.map((v) => v * 2);
    expect(compareSamples(slow, fast)).toMatchObject({ direction: "higher", ratio: 29 / 14.5 });
    expect(compareSamples(fast, slow)).toMatchObject({ direction: "lower" });
  });
  test("overlapping samples are unclear", () => {
    expect(compareSamples([1, 3, 5, 7], [2, 4, 6, 8]).direction).toBe("unclear");
  });
});

test("a median of an even and an odd count, and of none", () => {
  expect(median([3, 1, 2])).toBe(2);
  expect(median([4, 1, 3, 2])).toBe(2.5);
  expect(median([])).toBeNull();
});

test("chance flags about one task in twenty", () => {
  expect(chanceFlags(11)).toBeCloseTo(0.55);
});
