import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { identify, removeCheckout, tag } from "./build.ts";

let repo: string;
const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "jen-eval-build-test-"));
  git("init", "-q", "-b", "main");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  writeFileSync(join(repo, ".gitignore"), "ignored.txt\n");
  writeFileSync(join(repo, "a.txt"), "one\n");
  git("add", "-A");
  git("commit", "-q", "-m", "first");
});
afterEach(() => rmSync(repo, { recursive: true, force: true }));

test("a clean working tree is its commit's tree", async () => {
  const head = git("rev-parse", "HEAD");
  expect(await identify(repo, null)).toEqual({ ref: null, tree: git("rev-parse", "HEAD^{tree}"), commit: head, dirty: false });
  expect(await identify(repo, "main")).toEqual({ ref: "main", tree: git("rev-parse", "HEAD^{tree}"), commit: head, dirty: false });
});

test("a dirty tree and the commit of the same contents get the same tree, the first marked dirty", async () => {
  writeFileSync(join(repo, "a.txt"), "two\n");
  const dirty = await identify(repo, null);
  expect(dirty.dirty).toBe(true);
  expect(dirty.tree).not.toBe(git("rev-parse", "HEAD^{tree}"));
  // Nothing was staged in the real index.
  expect(git("diff", "--cached", "--name-only")).toBe("");
  git("commit", "-q", "-am", "second");
  expect(await identify(repo, null)).toEqual({ ref: null, tree: dirty.tree, commit: git("rev-parse", "HEAD"), dirty: false });
  expect((await identify(repo, "HEAD")).tree).toBe(dirty.tree);
});

test("an untracked file changes the tree, and an ignored one doesn't", async () => {
  const clean = (await identify(repo, null)).tree;
  writeFileSync(join(repo, "ignored.txt"), "secret\n");
  expect((await identify(repo, null)).tree).toBe(clean);
  writeFileSync(join(repo, "new.txt"), "new\n");
  const untracked = await identify(repo, null);
  expect(untracked).toMatchObject({ dirty: true });
  expect(untracked.tree).not.toBe(clean);
  // It's still untracked.
  expect(git("status", "--porcelain")).toContain("?? new.txt");
});

test("a deleted file changes the tree", async () => {
  const clean = (await identify(repo, null)).tree;
  rmSync(join(repo, "a.txt"));
  expect((await identify(repo, null)).tree).not.toBe(clean);
});

test("a ref that doesn't exist is refused", async () => {
  await expect(identify(repo, "nope")).rejects.toThrow(/git rev-parse --verify failed/);
});

test("a removed checkout leaves no worktree behind", async () => {
  const dir = join(mkdtempSync(join(tmpdir(), "jen-eval-checkout-")), "src");
  git("worktree", "add", "--detach", dir, "main");
  expect(readFileSync(join(dir, "a.txt"), "utf8")).toBe("one\n");
  await removeCheckout(repo, dir);
  expect(existsSync(join(dir, ".."))).toBe(false);
  expect(git("worktree", "list").split("\n")).toHaveLength(1);
});

test("tags are the evaluation's and the side's", () => {
  expect(tag("agent", "1a2b3c", "a")).toBe("jen-agent:eval-1a2b3c-a");
});
