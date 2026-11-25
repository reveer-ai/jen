// Checks jen's machine on a real Apple silicon Mac, from the checkout's
// dist/machine/, which npm run build:machine writes, under a runtime name of
// its own, so it touches nothing of the user's. It starts the machine, sees its
// engine answer within 60 seconds, runs the machine's own check that nothing
// listens on its network, reaches a container's port published on 127.0.0.1
// from the Mac and from nowhere else, sees the Mac stop listening once the
// container is gone, stops the machine and starts it again with a volume's
// data kept, and removes the machine, even when it fails. It also pulls from
// ghcr.io with a stand-in for the keychain's credential helper first on PATH,
// which jen's docker mustn't ask. It needs no model, pulls alpine from Docker
// Hub, and asks ghcr.io for a tag of jen-runtime that doesn't exist. Skipped
// anywhere but macOS on arm64; there, a machine that isn't built fails the
// check. Whether the clock is right
// after the Mac sleeps is a hand check, since a check can't sleep the Mac:
// docker run --rm alpine date against the Mac's date after pmset sleepnow.

import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { connect, createServer } from "node:net";
import { networkInterfaces, tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { Machine, START_MS } from "./machine.ts";

const onMac = process.platform === "darwin" && process.arch === "arm64";
const checkout = join(import.meta.dirname, "../..");

test.skipIf(!onMac)("jen's machine starts, pulls anonymously whatever the keychain holds, serves a port published on 127.0.0.1, keeps its data across a restart, and is removed", { timeout: 600_000 }, async () => {
  const machine = new Machine(`jen-live-${randomBytes(4).toString("hex")}`);
  const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
  const options = { start: true, say: () => {}, sleep, now: Date.now };
  const docker = (args: string[], input?: string) => {
    const { program, env } = machine.docker();
    const result = spawnSync(program, args, { encoding: "utf8", env: { ...process.env, ...env }, input, timeout: 300_000 });
    if (result.status !== 0) throw new Error(`docker ${args.join(" ")} failed: ${result.stderr || result.error?.message}`);
    return result.stdout;
  };
  try {
    const started = Date.now();
    expect(await machine.ensure(options)).toBe(true);
    expect(Date.now() - started).toBeLessThan(START_MS);
    expect(readFileSync(join(machine.folder, "version"), "utf8")).toBe(readFileSync(join(checkout, "dist", "machine", "version"), "utf8"));

    // A login the keychain holds, such as a stale one Docker Desktop left for
    // ghcr.io, which ghcr.io refuses: the stand-in helper answers with one for
    // any registry. jen's docker asks it nothing, so the pull is anonymous,
    // and a tag that doesn't exist is not found rather than denied.
    const helper = mkdtempSync(join(tmpdir(), "jen-live-helper-"));
    try {
      const answer = JSON.stringify({ ServerURL: "https://ghcr.io", Username: "jen-live", Secret: "stale" });
      writeFileSync(join(helper, "docker-credential-osxkeychain"), `#!/bin/sh\necho "$1" >> "$(dirname "$0")/asked"\ncat > /dev/null\necho '${answer}'\n`, { mode: 0o755 });
      const { program, env } = machine.docker();
      const pull = spawnSync(program, ["pull", "ghcr.io/reveer-ai/jen-runtime:live-missing"], { encoding: "utf8", env: { ...process.env, ...env, PATH: `${helper}:${process.env.PATH}` }, timeout: 120_000 });
      expect(pull.stderr).toMatch(/not found/);
      expect(existsSync(join(helper, "asked"))).toBe(false);
    } finally {
      rmSync(helper, { recursive: true, force: true });
    }

    expect(docker(["run", "--rm", "-i", "--network", "host", "--pid", "host", "alpine", "sh", "-s"], readFileSync(join(checkout, "src", "machine", "check.sh"), "utf8"))).toMatch(/nothing listens on the machine's network/);

    const port = await freePort();
    docker(["run", "-d", "--name", "served", "-p", `127.0.0.1:${port}:80`, "alpine", "sh", "-c", "while true; do echo served | nc -l -p 80; done"]);
    // Between two of nc's connections, one reads nothing.
    expect(await eventually(async () => ((await read("127.0.0.1", port)) === "served\n" ? "served" : undefined))).toBe("served");
    const other = Object.values(networkInterfaces()).flat().find((address) => address?.family === "IPv4" && !address.internal)?.address;
    if (other) expect(await read(other, port)).toBeUndefined();
    docker(["rm", "-f", "served"]);
    expect(await eventually(async () => ((await read("127.0.0.1", port)) === undefined ? true : undefined))).toBe(true);

    docker(["run", "--rm", "-v", "kept:/kept", "alpine", "sh", "-c", "echo heron > /kept/word"]);
    expect(await machine.stop(options)).toBe(true);
    expect(await machine.answers()).toBe(false);
    expect(await machine.ensure(options)).toBe(true);
    expect(docker(["run", "--rm", "-v", "kept:/kept", "alpine", "cat", "/kept/word"])).toBe("heron\n");
  } finally {
    await machine.remove(options);
  }
  expect(existsSync(machine.folder)).toBe(false);
});

// What a connection to host:port reads until it closes, or undefined when it
// can't connect.
function read(host: string, port: number): Promise<string | undefined> {
  return new Promise((resolve) => {
    let text = "";
    const socket = connect({ host, port, timeout: 2_000 });
    socket.setEncoding("utf8").on("data", (chunk: string) => (text += chunk));
    socket.on("end", () => resolve(text));
    socket.on("timeout", () => (socket.destroy(), resolve(undefined)));
    socket.on("error", () => resolve(undefined));
  });
}

// try's first answer that isn't undefined, asked for up to 20 seconds.
async function eventually<T>(attempt: () => Promise<T | undefined>): Promise<T | undefined> {
  const deadline = Date.now() + 20_000;
  for (;;) {
    const answer = await attempt();
    if (answer !== undefined || Date.now() >= deadline) return answer;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const server = createServer().listen(0, "127.0.0.1", () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolve(port));
    });
  });
}
