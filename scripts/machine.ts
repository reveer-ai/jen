// Builds jen's machine for an Apple silicon Mac into dist/machine/, which a
// checkout's jen runs on macOS:
//
//   npm run build:machine
//
// It holds the Dockerfile's machine target, built with any engine (vmlinuz,
// initramfs, system.img and their version), the launcher, jen-machine, built
// with SwiftPM and signed ad hoc with the virtualization entitlement, and
// Docker's static docker command for macOS at its pinned version, checked
// against its checksum. It runs only on macOS, where the launcher builds.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const LAUNCHER = join(ROOT, "src", "machine", "launcher");

// The machine target's files, as the platform package's machine/ holds them.
export const MACHINE_FILES = ["vmlinuz", "initramfs", "system.img", "version"] as const;

// Docker's static client for macOS on arm64. Docker publishes no checksum for
// it, so this one is the download's, taken when the version was pinned.
export const DOCKER_CLIENT = {
  version: "29.9.3",
  url: "https://download.docker.com/mac/static/stable/aarch64/docker-29.9.3.tgz",
  sha256: "79145e169bca0b9571d02de8e1cd311a36e0e8fdb4599b6661a87b1bb3afbe13",
} as const;

export type Download = (url: string) => Promise<Uint8Array>;

const download: Download = async (url) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`downloading ${url} answered ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
};

// Refuses bytes whose SHA-256 isn't expected.
export function checkSha256(bytes: Uint8Array, expected: string, what: string): void {
  const found = createHash("sha256").update(bytes).digest("hex");
  if (found !== expected) throw new Error(`${what}'s SHA-256 is ${found}, not the pinned ${expected}`);
}

// Writes Docker's pinned docker command to dest, refusing a download that
// doesn't match its checksum before writing anything.
export async function fetchDockerClient(dest: string, get: Download = download): Promise<void> {
  const archive = await get(DOCKER_CLIENT.url);
  checkSha256(archive, DOCKER_CLIENT.sha256, DOCKER_CLIENT.url);
  const tar = spawnSync("tar", ["-xzOf", "-", "docker/docker"], { input: archive, maxBuffer: 256 * 1024 * 1024 });
  if (tar.status !== 0) throw new Error(`tar couldn't read docker/docker from ${DOCKER_CLIENT.url}: ${tar.stderr.toString().trim()}`);
  writeFileSync(dest, tar.stdout);
  chmodSync(dest, 0o755);
}

function run(program: string, args: string[], what: string): void {
  const result = spawnSync(program, args, { cwd: ROOT, stdio: ["ignore", "inherit", "inherit"] });
  if (result.status !== 0) throw new Error(`${what} failed${result.error ? `: ${result.error.message}` : ""}`);
}

// Builds the machine target and copies its files into out.
export function buildMachineFiles(out: string): void {
  const exported = mkdtempSync(join(tmpdir(), "jen-machine-"));
  try {
    run("docker", ["build", "--target", "machine", "--output", exported, ROOT], "docker build --target machine");
    mkdirSync(out, { recursive: true });
    for (const file of MACHINE_FILES) copyFileSync(join(exported, file), join(out, file));
  } finally {
    rmSync(exported, { recursive: true, force: true });
  }
}

// Builds the launcher and writes it to dest, signed ad hoc with the
// virtualization entitlement, without which Virtualization.framework refuses
// to start a VM.
export function buildLauncher(dest: string): void {
  run("swift", ["build", "-c", "release", "--package-path", LAUNCHER], "swift build");
  copyFileSync(join(LAUNCHER, ".build", "release", "jen-machine"), dest);
  run("codesign", ["--force", "--sign", "-", "--entitlements", join(LAUNCHER, "jen-machine.entitlements"), dest], "codesign");
}

export async function buildMachine(out = join(ROOT, "dist", "machine")): Promise<void> {
  if (process.platform !== "darwin") throw new Error("the machine's launcher builds only on macOS");
  buildMachineFiles(out);
  buildLauncher(join(out, "jen-machine"));
  await fetchDockerClient(join(out, "docker"));
}

if (import.meta.main) {
  try {
    await buildMachine();
  } catch (error) {
    process.stderr.write(`build:machine: ${(error as Error).message}\n`);
    process.exit(1);
  }
}
