// A side's build: its identity in git, and its images.
//
// A build is identified by its git tree. A ref's is the ref's tree. The
// working tree's is the tree `git add -A` would write, made with a temporary
// index so the real one is untouched: tracked and untracked files count, and
// .gitignore holds. The same contents get the same tree on any commit, so a
// working tree later committed matches its commit.
//
// A ref builds from a checkout of its own, made with `git worktree add
// --detach` and removed once its images are built; the working tree builds
// from the repo itself. Images are tagged for the evaluation and side, so no
// other evaluation, and none of the user's jen, shares them.

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const TARGETS = ["agent", "runtime", "workspace"] as const;
export type Target = (typeof TARGETS)[number];

export interface Build {
  // The ref built, or null for the working tree.
  ref: string | null;
  tree: string;
  commit: string;
  // Whether the working tree differs from its commit. Always false for a ref.
  dirty: boolean;
}

// Runs a command to its end, resolving with its output, or rejecting with its
// error output when it fails.
// A signal that aborts kills it.
export function command(file: string, args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number; input?: string; signal?: AbortSignal } = {}): Promise<string> {
  return new Promise((done, fail) => {
    // A command given no input gets no stdin pipe, so one that exits without
    // reading it can't fail the write with EPIPE.
    const child = spawn(file, args, { cwd: options.cwd, env: options.env, stdio: [options.input === undefined ? "ignore" : "pipe", "pipe", "pipe"], signal: options.signal });
    let stdout = "";
    let stderr = "";
    child.stdout!.setEncoding("utf8").on("data", (chunk) => (stdout += chunk));
    child.stderr!.setEncoding("utf8").on("data", (chunk) => (stderr += chunk));
    const timer = options.timeoutMs === undefined ? undefined : setTimeout(() => child.kill("SIGKILL"), options.timeoutMs);
    child.on("error", (error) => (clearTimeout(timer), fail(new Error(`${file} ${args[0]} failed: ${error.message}`))));
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (code === 0) return done(stdout);
      fail(new Error(`${file} ${args.slice(0, 2).join(" ")} failed${signal ? ` (${signal})` : ""}: ${(stderr || stdout).trim().split("\n").slice(-20).join("\n")}`));
    });
    if (child.stdin) {
      // A command may exit without reading its input; its exit code says how it went.
      child.stdin.on("error", () => {});
      child.stdin.end(options.input);
    }
  });
}

const git = async (repo: string, args: string[], env?: NodeJS.ProcessEnv) => (await command("git", args, { cwd: repo, env: env && { ...process.env, ...env } })).trim();

// The build of ref, or of the working tree when ref is null.
export async function identify(repo: string, ref: string | null): Promise<Build> {
  if (ref !== null) {
    const commit = await git(repo, ["rev-parse", "--verify", `${ref}^{commit}`]);
    return { ref, tree: await git(repo, ["rev-parse", `${commit}^{tree}`]), commit, dirty: false };
  }
  const commit = await git(repo, ["rev-parse", "--verify", "HEAD^{commit}"]);
  const scratch = mkdtempSync(join(tmpdir(), "jen-eval-index-"));
  try {
    const env = { GIT_INDEX_FILE: join(scratch, "index") };
    // The index starts from the commit, with no stat data, so git hashes every
    // file. A copy of the real index would save rehashing, but its fresh mtime
    // defeats git's racy-clean check: an edit made in the same second as the
    // real index was written looks unchanged.
    await git(repo, ["read-tree", commit], env);
    await git(repo, ["add", "-A"], env);
    const tree = await git(repo, ["write-tree"], env);
    return { ref: null, tree, commit, dirty: tree !== (await git(repo, ["rev-parse", `${commit}^{tree}`])) };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

// The image tag of a target for an evaluation's side.
export const tag = (target: Target, id: string, side: string) => `jen-${target}:eval-${id}-${side}`;

// Builds the three images of build for the evaluation's side. A ref builds
// from a temporary checkout, removed whether the build succeeds, fails or is
// aborted.
export async function buildImages(repo: string, build: Build, id: string, side: string, signal?: AbortSignal): Promise<void> {
  let dir = repo;
  let checkout: string | undefined;
  try {
    if (build.ref !== null) {
      checkout = join(mkdtempSync(join(tmpdir(), "jen-eval-checkout-")), "src");
      await git(repo, ["worktree", "add", "--detach", checkout, build.commit]);
      dir = checkout;
    }
    for (const target of TARGETS) {
      signal?.throwIfAborted();
      await command("docker", ["build", "--target", target, "-t", tag(target, id, side), dir], { timeoutMs: 600_000, signal });
    }
  } finally {
    if (checkout !== undefined) await removeCheckout(repo, checkout);
  }
}

// Removes a temporary checkout and git's record of it.
export async function removeCheckout(repo: string, checkout: string): Promise<void> {
  await git(repo, ["worktree", "remove", "--force", checkout]).catch(() => {});
  rmSync(join(checkout, ".."), { recursive: true, force: true });
  await git(repo, ["worktree", "prune"]).catch(() => {});
}
