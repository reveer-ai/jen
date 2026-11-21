import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { describe as describePlan, githubLabels, outputs, plan, type Deps } from "./release.ts";

// A git repo of its own for each test, whose commits stand in for merges.
let dir: string;
let labels: Map<number, string[]>;
let asked: number[];
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "jen-release-"));
  git("init", "-q", "-b", "main");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "test");
  git("config", "commit.gpgsign", "false");
  git("config", "tag.gpgsign", "false");
  labels = new Map();
  asked = [];
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function git(...args: string[]) {
  return execFileSync("git", args, { cwd: dir, encoding: "utf8" });
}

// A squash merge that changes files, labelled as given.
function merge(subject: string, files: string[], prLabels: string[] = []) {
  for (const file of files) {
    mkdirSync(join(dir, dirname(file)), { recursive: true });
    writeFileSync(join(dir, file), `${subject}\n${Math.random()}\n`);
  }
  git("add", "-A");
  git("commit", "-q", "-m", subject);
  const pr = /\(#(\d+)\)$/.exec(subject)?.[1];
  if (pr) labels.set(Number(pr), prLabels);
}

const deps: Deps = {
  git: async (args) => git(...args),
  labels: async (pr) => (asked.push(pr), labels.get(pr) ?? []),
};

test("the first release is 0.1.0, with every shipped merge in its notes", async () => {
  merge("JEN-1: Start (#1)", ["src/cli/main.ts", "package.json"]);
  merge("JEN-2: Plan it (#2)", ["record/plan.md"]);
  merge("JEN-3: Add the agent (#3)", ["src/agent/main.ts"], ["major"]);
  expect(await plan(deps)).toEqual({ release: true, version: "0.1.0", notes: "- JEN-3: Add the agent (#3)\n- JEN-1: Start (#1)" });
});

test("a merge with no label raises the patch number", async () => {
  merge("JEN-1: Start (#1)", ["src/cli/main.ts"]);
  git("tag", "v0.1.0");
  merge("JEN-5: Fix the list (#5)", ["src/cli/roots.ts"]);
  expect(await plan(deps)).toMatchObject({ release: true, last: "0.1.0", version: "0.1.1", bump: "patch", notes: "- JEN-5: Fix the list (#5)" });
});

test("a merge labelled minor raises the minor number", async () => {
  merge("JEN-1: Start (#1)", ["src/cli/main.ts"]);
  git("tag", "v0.1.1");
  merge("JEN-6: Show sub-agents (#6)", ["src/cli/roots.ts"], ["minor", "enhancement"]);
  expect(await plan(deps)).toMatchObject({ version: "0.2.0", bump: "minor" });
});

test("a merge labelled major raises the major number", async () => {
  merge("JEN-1: Start (#1)", ["src/cli/main.ts"]);
  git("tag", "v0.3.2");
  merge("JEN-7: Change the protocol (#7)", ["src/runtime/server.ts"], ["major"]);
  expect(await plan(deps)).toMatchObject({ version: "1.0.0", bump: "major" });
});

test("several merges in one release take the largest label", async () => {
  merge("JEN-1: Start (#1)", ["src/cli/main.ts"]);
  git("tag", "v0.2.0");
  merge("JEN-8: A feature (#8)", ["src/agent/loop.ts"], ["minor"]);
  merge("JEN-9: A fix (#9)", ["src/agent/loop.ts"]);
  expect(await plan(deps)).toMatchObject({ version: "0.3.0", bump: "minor", notes: "- JEN-9: A fix (#9)\n- JEN-8: A feature (#8)" });
});

test("a merge of only the record, docs, skills, OpenSpec or tests releases nothing", async () => {
  merge("JEN-1: Start (#1)", ["src/cli/main.ts"]);
  git("tag", "v0.1.0");
  merge("JEN-10: Record it (#10)", ["record/plan.md", "openspec/changes/x/proposal.md"]);
  merge("JEN-11: Tend (#11)", ["docs/architecture.html", ".agents/skills/tend/SKILL.md", "AGENTS.md"]);
  merge("JEN-12: Test more (#12)", ["src/cli/main.test.ts", "src/agent/loop.live.test.ts"]);
  expect(await plan(deps)).toEqual({ release: false, last: "0.1.0" });
  expect(asked).toEqual([]);
  expect(describePlan(await plan(deps))).toBe("nothing that ships changed since v0.1.0, so nothing is released.");
});

test.each([["package.json"], ["package-lock.json"], ["Dockerfile"], ["README.md"], ["LICENSE"], ["NOTICE"], ["src/agent/ui/page.html"]])("a change to %s ships", async (file) => {
  merge("JEN-1: Start (#1)", ["src/cli/main.ts"]);
  git("tag", "v0.1.0");
  merge("JEN-13: Change it (#13)", [file]);
  expect(await plan(deps)).toMatchObject({ release: true, version: "0.1.1" });
});

test("the notes are the shipped merges' subjects, one line each, leaving out what doesn't ship", async () => {
  merge("JEN-1: Start (#1)", ["src/cli/main.ts"]);
  git("tag", "v0.1.0");
  merge("JEN-30: Show sub-agents in jen list (#40)", ["src/cli/roots.ts", "src/cli/roots.test.ts", "record/plan.md"]);
  merge("JEN-31: Plan the next cycle (#41)", ["record/plan.md"]);
  const planned = await plan(deps);
  expect(planned).toMatchObject({ notes: "- JEN-30: Show sub-agents in jen list (#40)" });
  // GitHub links #40 to its pull request in a release's notes.
  expect(outputs(planned, "EOF_X")).toBe("release=true\nversion=0.1.1\nnotes<<EOF_X\n- JEN-30: Show sub-agents in jen list (#40)\nEOF_X\n");
});

test("a commit with no pull request bumps the patch number", async () => {
  merge("JEN-1: Start (#1)", ["src/cli/main.ts"]);
  git("tag", "v0.1.0");
  merge("Fix a typo by hand", ["src/cli/main.ts"]);
  expect(await plan(deps)).toMatchObject({ version: "0.1.1", notes: "- Fix a typo by hand" });
  expect(asked).toEqual([]);
});

test("the last release is the highest v<x.y.z> tag reachable from HEAD", async () => {
  merge("JEN-1: Start (#1)", ["src/cli/main.ts"]);
  git("tag", "v0.2.0");
  git("tag", "v0.10.0");
  git("tag", "v0.9.1");
  git("tag", "v1.0");
  git("tag", "v2.0.0-beta.1");
  git("tag", "backup/v9.0.0");
  // A tag on a commit outside HEAD's history, as the local v0.1.0 to v0.5.0 are.
  git("checkout", "-q", "-b", "elsewhere");
  merge("Elsewhere", ["src/cli/other.ts"]);
  git("tag", "v5.0.0");
  git("checkout", "-q", "main");
  merge("JEN-2: Next (#2)", ["src/cli/main.ts"]);
  expect(await plan(deps)).toMatchObject({ last: "0.10.0", version: "0.10.1" });
});

test("the plan's outputs say when nothing is released", () => {
  expect(outputs({ release: false, last: "0.1.0" })).toBe("release=false\n");
});

test("labels come from the GitHub API, and a number that isn't a pull request has none", async () => {
  const requests: { url: string; headers: Record<string, string> }[] = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    requests.push({ url, headers: init.headers as Record<string, string> });
    return url.endsWith("/40/labels") ? Response.json([{ name: "minor" }, { name: "bug" }]) : new Response("Not Found", { status: 404 });
  }) as typeof fetch;
  const read = githubLabels("reveer-ai/jen", "t0ken", fetcher);
  expect(await read(40)).toEqual(["minor", "bug"]);
  expect(await read(41)).toEqual([]);
  expect(requests[0]).toMatchObject({ url: "https://api.github.com/repos/reveer-ai/jen/issues/40/labels", headers: { authorization: "Bearer t0ken" } });
});

test("any other answer from the API fails the plan", async () => {
  const fetcher = (async () => new Response("rate limited", { status: 403 })) as unknown as typeof fetch;
  await expect(githubLabels("reveer-ai/jen", undefined, fetcher)(40)).rejects.toThrow(/GitHub answered 403 for #40's labels: rate limited/);
});
