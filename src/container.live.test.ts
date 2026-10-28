// Runs two messages in two fresh containers on one volume, and checks that the
// second turn sees the first. Uses the same JEN_LIVE_* variables as the
// adapter's live check. Skipped when the key or model is missing; with them
// set, a missing Docker fails the check.

import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { expect, test } from "vitest";

const apiKey = process.env.JEN_LIVE_API_KEY;
const model = process.env.JEN_LIVE_MODEL;
const baseURL = process.env.JEN_LIVE_BASE_URL;

test.skipIf(!apiKey || !model)("a second container on the same volume sees the first turn", { timeout: 600_000 }, () => {
  docker(["build", "-t", "jen", join(import.meta.dirname, "..")]);
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

// Credentials are passed by name, so they stay off the command line.
function send(volume: string, text: string): string {
  const env = { ...process.env, JEN_MODEL: model, JEN_API_KEY: apiKey, JEN_BASE_URL: baseURL };
  const names = ["JEN_MODEL", "JEN_API_KEY", ...(baseURL ? ["JEN_BASE_URL"] : [])];
  return docker(["run", "--rm", "-v", `${volume}:/state`, ...names.flatMap((n) => ["-e", n]), "jen", text], env);
}

function docker(args: string[], env?: NodeJS.ProcessEnv): string {
  const result = spawnSync("docker", args, { encoding: "utf8", env });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`docker ${args[0]} exited ${result.status}: ${result.stderr}`);
  return result.stdout;
}
