import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { checkSha256, DOCKER_CLIENT, fetchDockerClient } from "./machine.ts";

test("bytes whose SHA-256 is the pinned one pass", () => {
  const bytes = new TextEncoder().encode("jen");
  checkSha256(bytes, createHash("sha256").update(bytes).digest("hex"), "jen");
});

test("a docker download that doesn't match its pinned checksum is refused, writing nothing", async () => {
  const dir = mkdtempSync(join(tmpdir(), "jen-client-"));
  try {
    const dest = join(dir, "docker");
    const changed = new TextEncoder().encode("not Docker's archive");
    const error = await fetchDockerClient(dest, async (url) => (expect(url).toBe(DOCKER_CLIENT.url), changed)).catch((e) => e);
    expect(error.message).toBe(`${DOCKER_CLIENT.url}'s SHA-256 is ${createHash("sha256").update(changed).digest("hex")}, not the pinned ${DOCKER_CLIENT.sha256}`);
    expect(existsSync(dest)).toBe(false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
