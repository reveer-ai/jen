// Runs two messages in two fresh containers on one volume, and checks that the
// second turn sees the first. Uses the same JEN_LIVE_* variables as the
// adapter's live check. Skipped when the key or model is missing; with them
// set, a missing Docker fails the check.
//
// Vitest can't interrupt a synchronous child, so each Docker command has its
// own deadline, and together they fit inside the test's timeout.

import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { expect, test } from "vitest";

const apiKey = process.env.JEN_LIVE_API_KEY;
const model = process.env.JEN_LIVE_MODEL;
const baseURL = process.env.JEN_LIVE_BASE_URL;

test.skipIf(!apiKey || !model)("a second container on the same volume sees the first turn", { timeout: 600_000 }, () => {
  docker(["build", "-t", "jen", join(import.meta.dirname, "..")], { timeout: 240_000 });
  const volume = `jen-live-${randomBytes(4).toString("hex")}`;
  docker(["volume", "create", volume]);
  try {
    const word = `jen-${randomBytes(4).toString("hex")}`;
    send(volume, `Remember this word: ${word}. Reply only with OK.`);
    expect(send(volume, "What was the word I asked you to remember? Reply with just the word.")).toContain(word);
  } finally {
    docker(["volume", "rm", volume]);
  }
});

// Credentials are passed by name, so they stay off the command line. Killing
// the Docker client doesn't stop its container, so a failed run removes it.
function send(volume: string, text: string): string {
  const env = { ...process.env, JEN_MODEL: model, JEN_API_KEY: apiKey, JEN_BASE_URL: baseURL };
  const names = ["JEN_MODEL", "JEN_API_KEY", ...(baseURL ? ["JEN_BASE_URL"] : [])];
  const container = `${volume}-${randomBytes(4).toString("hex")}`;
  const args = ["run", "--rm", "--name", container, "-v", `${volume}:/state`, ...names.flatMap((n) => ["-e", n]), "jen", text];
  try {
    return docker(args, { env, timeout: 120_000 });
  } catch (error) {
    spawnSync("docker", ["rm", "-f", container], { timeout: 30_000 });
    throw error;
  }
}

function docker(args: string[], { env, timeout = 30_000 }: { env?: NodeJS.ProcessEnv; timeout?: number } = {}): string {
  const result = spawnSync("docker", args, { encoding: "utf8", env, timeout });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`docker ${args[0]} exited ${result.status}: ${result.stderr}`);
  return result.stdout;
}
