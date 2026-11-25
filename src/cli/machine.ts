// jen's machine on an Apple silicon Mac: a Linux VM of jen's own that is its
// only Docker engine there. jen-machine, the launcher, runs the VM inside its
// own process, so the machine runs exactly as long as the launcher does. Each
// runtime name has its own machine, with its files in ~/.jen/machines/<name>/,
// which the launcher describes. The machine, the launcher and the docker
// command jen runs against it come from the platform package in an installed
// jen, and from dist/machine/, which npm run build:machine writes, in a
// checkout.

import { spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, statSync, unlinkSync, writeSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { EngineError, runProcess, type EngineOptions, type Runner } from "./docker.ts";
import { VERSION } from "./release.ts";

// The npm package that holds the machine, which npm installs only on macOS on
// arm64.
export const PLATFORM_PACKAGE = "@jen-ai/darwin-arm64";

// How long a started machine may take for its engine to answer, and how often
// it's asked. A launcher asked to stop shuts the machine down within 30
// seconds, so STOP_MS leaves it more.
export const START_MS = 60_000;
export const STOP_MS = 40_000;
const POLL_MS = 200;

// Where the machine's files come from.
export interface MachineFiles {
  // vmlinuz, initramfs, system.img and version.
  system: string;
  launcher: string;
  docker: string;
}

// The platform package's files in an installed jen, or dist/machine/'s in a
// checkout, failing with what to do when they're missing.
export function machineFiles(version = VERSION, resolve: (id: string) => string = createRequire(import.meta.url).resolve, built = join(import.meta.dirname, "..", "..", "dist", "machine")): MachineFiles {
  if (version === undefined) {
    const files = { system: built, launcher: join(built, "jen-machine"), docker: join(built, "docker") };
    if (![files.launcher, files.docker, join(built, "version")].every(existsSync)) {
      throw new EngineError("jen's machine isn't built. Build it from jen's checkout with: npm run build:machine");
    }
    return files;
  }
  let root: string;
  try {
    root = dirname(resolve(`${PLATFORM_PACKAGE}/package.json`));
  } catch {
    const arch = process.arch === "arm64" ? "" : `, with a Node built for Apple silicon: this one is built for ${process.arch}`;
    throw new EngineError(`jen's machine is missing, since npm didn't install its package, ${PLATFORM_PACKAGE}. Reinstall jen with: npm install -g jen-ai${arch}`);
  }
  return { system: join(root, "machine"), launcher: join(root, "bin", "jen-machine"), docker: join(root, "bin", "docker") };
}

// Starts the launcher detached, so it outlives jen, with its stderr appended
// to log. exitCode answers its code once it has exited, or null.
export type Launch = (launcher: string, args: string[], log: string) => { exitCode: () => number | null };

export const launch: Launch = (launcher, args, log) => {
  const fd = openSync(log, "a", 0o600);
  try {
    const child = spawn(launcher, args, { detached: true, stdio: ["ignore", "ignore", fd] });
    let code: number | null = null;
    child.on("exit", (exit) => (code = exit ?? -1));
    child.on("error", () => (code = -1));
    child.unref();
    return { exitCode: () => code };
  } finally {
    closeSync(fd);
  }
};

// Whether pid is a running process, and its program's name when it is.
export type Lookup = (pid: number) => Promise<string | undefined>;

const lookup: Lookup = async (pid) => {
  try {
    process.kill(pid, 0);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EPERM") return undefined;
  }
  const output = await runProcess("ps", ["-o", "comm=", "-p", String(pid)]);
  return output.code === 0 && output.stdout.trim() !== "" ? basename(output.stdout.trim()) : undefined;
};

export interface MachineHost {
  run: Runner;
  launch: Launch;
  lookup: Lookup;
  // Sends a signal, or with 0 none, answering false when there's no such
  // process.
  kill: (pid: number, signal: NodeJS.Signals | 0) => boolean;
  files: () => MachineFiles;
  home: string;
}

const host: MachineHost = {
  run: runProcess,
  launch,
  lookup,
  kill: (pid, signal) => {
    try {
      process.kill(pid, signal);
      return true;
    } catch {
      return false;
    }
  },
  files: () => machineFiles(),
  home: homedir(),
};

export const machineFolder = (home: string, name: string) => join(home, ".jen", "machines", name);

export class Machine {
  readonly folder: string;
  readonly host: MachineHost;
  #files?: MachineFiles;

  constructor(name: string, given: Partial<MachineHost> = {}) {
    this.host = { ...host, ...given };
    this.folder = machineFolder(this.host.home, name);
  }

  get log() {
    return join(this.folder, "console.log");
  }

  files(): MachineFiles {
    return (this.#files ??= this.host.files());
  }

  // The docker command to run against the machine's engine, and the
  // environment that points it there whatever the user's says: their
  // DOCKER_HOST, their context and their configuration, credential helpers
  // included, are all replaced.
  docker(): { program: string; env: Record<string, string> } {
    return {
      program: this.files().docker,
      env: { DOCKER_HOST: `unix://${join(this.folder, "engine.sock")}`, DOCKER_CONFIG: join(this.folder, "docker"), DOCKER_CONTEXT: "default" },
    };
  }

  // Refuses an Intel Mac, which the machine isn't built for, even when this
  // Node runs on Apple silicon through Rosetta.
  async check(): Promise<void> {
    const arm64 = await this.host.run("sysctl", ["-n", "hw.optional.arm64"]);
    if (arm64.stdout.trim() !== "1") throw new EngineError("jen needs a Mac with Apple silicon, and this one has an Intel processor.");
  }

  // Whether the engine answers. Without the machine's files, it can't be
  // running.
  async answers(): Promise<boolean> {
    let docker;
    try {
      docker = this.docker();
    } catch (error) {
      if (error instanceof EngineError) return false;
      throw error;
    }
    return (await this.host.run(docker.program, ["version", "--format", "{{.Server.Version}}"], { env: docker.env })).code === 0;
  }

  // The running launcher's process, or undefined when there's none, as after
  // the Mac restarted or the launcher crashed, whatever launcher.pid says.
  async launcher(): Promise<number | undefined> {
    const pid = Number(read(join(this.folder, "launcher.pid")));
    if (!Number.isSafeInteger(pid) || pid <= 0) return undefined;
    return (await this.host.lookup(pid)) === "jen-machine" ? pid : undefined;
  }

  // Whether the running machine booted a system other than the one jen holds.
  async outdated(): Promise<boolean> {
    if ((await this.launcher()) === undefined) return false;
    return read(join(this.folder, "version")) !== read(join(this.files().system, "version"));
  }

  // Answers once the machine's engine answers, starting the machine first
  // when start is set. Without start, an engine that doesn't answer answers
  // false.
  async ensure({ start, say, sleep, now }: EngineOptions): Promise<boolean> {
    if (await this.answers()) return true;
    if (!start) return false;
    mkdirSync(this.folder, { recursive: true, mode: 0o700 });
    const lock = join(this.folder, "start.lock");
    let said = false;
    const deadline = now() + START_MS;
    for (;;) {
      if (take(lock, this.host)) break;
      // Another jen is starting the machine, so this one waits for it.
      if (!said) say("starting jen's machine...");
      said = true;
      if (now() >= deadline) throw new EngineError(`jen's machine didn't answer within ${START_MS / 1000} seconds. Its console is in ${this.log}`);
      await sleep(POLL_MS);
      if (await this.answers()) return true;
    }
    try {
      if (await this.answers()) return true;
      if (!said) say("starting jen's machine...");
      // A launcher that's running but whose engine doesn't answer yet is
      // still booting, and is waited for rather than started again.
      let started: ReturnType<Launch> | undefined;
      if ((await this.launcher()) === undefined) {
        const { system, launcher } = this.files();
        started = this.host.launch(launcher, [this.folder, system], this.log);
      }
      const end = now() + START_MS;
      for (;;) {
        if (await this.answers()) return true;
        if (started?.exitCode() != null) throw new EngineError(`jen's machine stopped as it started. Its console is in ${this.log}`);
        if (now() >= end) {
          const pid = await this.launcher();
          if (pid !== undefined) this.host.kill(pid, "SIGTERM");
          throw new EngineError(`jen's machine didn't answer within ${START_MS / 1000} seconds. Its console is in ${this.log}`);
        }
        await sleep(POLL_MS);
      }
    } finally {
      rmSync(lock, { force: true });
    }
  }

  // Stops the machine, answering whether it was running.
  async stop({ sleep, now }: Pick<EngineOptions, "sleep" | "now">): Promise<boolean> {
    const pid = await this.launcher();
    if (pid === undefined || !this.host.kill(pid, "SIGTERM")) return false;
    const deadline = now() + STOP_MS;
    while ((await this.launcher()) !== undefined) {
      if (now() >= deadline) {
        this.host.kill(pid, "SIGKILL");
        break;
      }
      await sleep(POLL_MS);
    }
    return true;
  }

  // Stops the machine and deletes its folder, which holds everything of
  // jen's under this runtime name.
  async remove(options: Pick<EngineOptions, "sleep" | "now">): Promise<void> {
    await this.stop(options);
    rmSync(this.folder, { recursive: true, force: true });
  }
}

// A file's contents, trimmed, or undefined when it can't be read.
function read(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8").trim();
  } catch {
    return undefined;
  }
}

// Takes the start lock, which holds the starting jen's process ID, answering
// false when another jen holds it. A lock whose jen is gone is stale, as is
// an empty one, as a jen leaves that stops between creating and writing it,
// once it's a few seconds old.
function take(lock: string, host: MachineHost): boolean {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(lock, "wx", 0o600);
      writeSync(fd, `${process.pid}\n`);
      closeSync(fd);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    const holder = read(lock);
    if (holder === undefined) continue;
    const pid = Number(holder);
    if (holder === "" ? Date.now() - mtime(lock) < 5_000 : pid === process.pid || (Number.isSafeInteger(pid) && pid > 0 && host.kill(pid, 0))) return false;
    try {
      unlinkSync(lock);
    } catch {}
  }
  return false;
}

function mtime(path: string): number {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return 0;
  }
}
