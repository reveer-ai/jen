import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { checkSha256, DOCKER_CLIENT, fetchDockerClient, machineVersion, SYSTEM_FILES } from "./machine.ts";

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

test("the machine's engine is the docker client's version", () => {
  const dockerfile = readFileSync(join(import.meta.dirname, "..", "Dockerfile"), "utf8");
  expect(dockerfile.match(/^ARG DOCKER_ENGINE=(\S+)$/m)?.[1]).toBe(DOCKER_CLIENT.version);
});

test.each([...SYSTEM_FILES, "jen-machine"])("the machine's version changes with %s alone", (changed) => {
  const dir = mkdtempSync(join(tmpdir(), "jen-version-"));
  try {
    for (const file of [...SYSTEM_FILES, "jen-machine"]) writeFileSync(join(dir, file), file);
    const before = machineVersion(dir);
    expect(before).toMatch(/^[0-9a-f]{16}$/);
    expect(machineVersion(dir)).toBe(before);
    writeFileSync(join(dir, changed), `${changed}, rebuilt`);
    expect(machineVersion(dir)).not.toBe(before);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("bytes moved from one of the machine's files to the next make another version", () => {
  const dir = mkdtempSync(join(tmpdir(), "jen-version-"));
  try {
    for (const file of SYSTEM_FILES) writeFileSync(join(dir, file), "");
    writeFileSync(join(dir, "vmlinuz"), "ab");
    writeFileSync(join(dir, "jen-machine"), "");
    const before = machineVersion(dir);
    writeFileSync(join(dir, "vmlinuz"), "a");
    writeFileSync(join(dir, "initramfs"), "b");
    expect(machineVersion(dir)).not.toBe(before);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
