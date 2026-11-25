// The engine, reached through a docker command: on Linux the user's own, which
// resolves their context and DOCKER_HOST the way they configured it, and on
// macOS the one jen's package holds, pointed at jen's machine. Only the calls
// jen makes are here. A secret reaches a child only through its environment or
// its stdin, never its arguments, which any user on the machine can read.

import { spawn } from "node:child_process";
import type { Machine } from "./machine.ts";

export interface Output {
  code: number;
  stdout: string;
  stderr: string;
}

// Runs a program with args, adding env to the inherited environment, where a
// name whose value is undefined is removed, and writing input to its stdin. A program that can't be started at all, such as
// a missing one, answers code -1 with the reason in stderr.
export type Runner = (program: string, args: string[], options?: { env?: Record<string, string | undefined>; input?: string }) => Promise<Output>;

export const runProcess: Runner = (program, args, { env = {}, input } = {}) =>
  new Promise((resolve) => {
    const child = spawn(program, args, { env: { ...process.env, ...env }, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
    child.on("error", (error) => resolve({ code: -1, stdout, stderr: error.message }));
    child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
    child.stdin.on("error", () => {});
    child.stdin.end(input ?? "");
  });

// A docker call that failed for a reason jen doesn't expect. Docker's own
// message is shown as it is.
export class DockerError extends Error {
  readonly stderr: string;
  constructor(args: string[], output: Output) {
    super(`docker ${args[0]} failed: ${output.stderr.trim() || `exit code ${output.code}`}`);
    this.name = "DockerError";
    this.stderr = output.stderr;
  }
}

// Docker can't run jen: there's no docker command, its engine doesn't answer
// and jen couldn't start it, or the engine is too old. On macOS: the Mac isn't
// Apple silicon, or jen's machine is missing or didn't start.
export class EngineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EngineError";
  }
}

// The oldest engine jen runs on: agents' network needs an isolated gateway.
// jen's machine brings a newer one.
export const MIN_ENGINE = [28, 0] as const;
// How long a started Docker on Linux may take to answer, and how often it's
// asked.
export const START_MS = 120_000;
const START_POLL_MS = 1_000;

export interface EngineOptions {
  // Whether to start the engine when it doesn't answer: Docker Desktop on
  // Linux, jen's machine on macOS.
  start: boolean;
  // Writes a line to stderr.
  say: (line: string) => void;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

export interface ContainerInfo {
  id: string;
  name: string;
  // The ID of the image it was created from.
  image: string;
  state: string;
  env: string[];
  labels: Record<string, string>;
}

export interface Docker {
  // Answers once an engine jen can run on answers, starting it first when
  // start is set, and fails with EngineError when there's none. With start
  // unset, a missing docker command or an engine that doesn't answer answers
  // false instead.
  ensureEngine(options: EngineOptions): Promise<boolean>;
  // An image's ID by its name, or undefined when there's no such image.
  imageId(image: string): Promise<string | undefined>;
  // A container by name or ID, or undefined when there's none.
  inspect(container: string): Promise<ContainerInfo | undefined>;
  // Every container, running or not, with all of the labels.
  containers(labels: string[]): Promise<ContainerInfo[]>;
  // docker run with args. env and secrets are added to the child's
  // environment, so args name them (-e NAME), and no arg may hold a secret's
  // value; input is its stdin.
  run(args: string[], options?: RunOptions): Promise<Output>;
  // The host port a container's 8080 is published on, or undefined.
  port(container: string): Promise<number | undefined>;
  // The last lines of a container's output.
  logs(container: string, lines: number): Promise<string>;
  // docker rm -f. A container that's gone already is no failure.
  remove(container: string): Promise<void>;
  volumeExists(name: string): Promise<boolean>;
  // Creates a volume with labels, leaving one that exists as it is.
  createVolume(name: string, labels: Record<string, string>): Promise<void>;
  volumes(labels: string[]): Promise<string[]>;
  removeVolume(name: string): Promise<void>;
  // A network that's gone already is no failure.
  removeNetwork(name: string): Promise<void>;
  removeImage(image: string): Promise<void>;
  // docker pull, quietly.
  pull(image: string): Promise<void>;
  // The images, as repository:tag, whose reference matches pattern.
  listImages(pattern: string): Promise<string[]>;
}

export interface RunOptions {
  env?: Record<string, string>;
  secrets?: Record<string, string>;
  // Secret values the child gets some other way, such as in its input,
  // which no argument may hold either.
  guard?: string[];
  input?: string;
}

const missing = (stderr: string) => /no such (container|object|image|volume|network)|not found/i.test(stderr);

// The engine on Linux, or with machine, jen's machine on macOS.
export function createDocker(runner: Runner = runProcess, machine?: Machine): Docker {
  const docker = async (args: string[], { env = {}, secrets = {}, guard = [], input }: RunOptions = {}) => {
    for (const value of [...Object.values(secrets), ...guard]) {
      if (value !== "" && args.some((arg) => arg.includes(value))) throw new Error("a secret would have been passed as an argument to docker");
    }
    const target = machine?.docker() ?? { program: "docker", env: {} };
    return runner(target.program, args, { env: { ...env, ...secrets, ...target.env }, input });
  };
  const ok = async (args: string[]) => {
    const output = await docker(args);
    if (output.code !== 0) throw new DockerError(args, output);
    return output.stdout;
  };
  const inspectAll = async (ids: string[]): Promise<ContainerInfo[]> => {
    if (ids.length === 0) return [];
    const output = await docker(["inspect", "--type", "container", ...ids]);
    // A container removed between the listing and this is left out.
    const found = output.stdout.trim() === "" ? [] : (JSON.parse(output.stdout) as any[]);
    if (output.code !== 0 && found.length === 0 && !missing(output.stderr)) throw new DockerError(["inspect"], output);
    return found.map((c) => ({
      id: c.Id,
      name: String(c.Name).replace(/^\//, ""),
      image: c.Image,
      state: c.State?.Status ?? "unknown",
      env: c.Config?.Env ?? [],
      labels: c.Config?.Labels ?? {},
    }));
  };
  const removing = async (args: string[]) => {
    const output = await docker(args);
    if (output.code !== 0 && !missing(output.stderr)) throw new DockerError(args, output);
  };

  // How to start the engine by hand, naming a context that isn't Docker's own,
  // since its engine is something else, such as Podman's.
  const byHand = async () => {
    const context = (await docker(["context", "show"])).stdout.trim();
    const how = "Start Docker Desktop, or Docker Engine with: sudo systemctl start docker. Then try again.";
    return context && context !== "default" && context !== "desktop-linux" ? `docker's context is ${context}, so start its engine and try again.` : how;
  };

  return {
    async ensureEngine(options) {
      if (machine) return machine.ensure(options);
      const { start, say, sleep, now } = options;
      const version = () => docker(["version", "--format", "{{.Server.Version}}"]);
      let output = await version();
      if (output.code === -1) {
        if (!start) return false;
        throw new EngineError(`jen needs Docker, and there's no docker command. Install Docker Engine: https://docs.docker.com/engine/install/. jen needs Docker Engine ${MIN_ENGINE.join(".")} or later.`);
      }
      if (output.code !== 0) {
        if (!start) return false;
        say("starting docker...");
        const started = (await docker(["desktop", "start", "--detach"])).code === 0;
        if (started) {
          const deadline = now() + START_MS;
          for (;;) {
            output = await version();
            if (output.code === 0 || now() >= deadline) break;
            await sleep(START_POLL_MS);
          }
        }
        if (output.code !== 0) throw new EngineError(`docker isn't running, and jen couldn't start it${started ? ` within ${START_MS / 1000} seconds` : ""}. ${await byHand()}`);
      }
      const found = output.stdout.trim();
      const [, major, minor] = /^(\d+)\.(\d+)(?:\D|$)/.exec(found) ?? [];
      if (major === undefined || Number(major) < MIN_ENGINE[0] || (Number(major) === MIN_ENGINE[0] && Number(minor) < MIN_ENGINE[1])) {
        throw new EngineError(
          `jen needs Docker Engine ${MIN_ENGINE.join(".")} or later, and this engine is ${major === undefined ? `${JSON.stringify(found)}, which isn't Docker's` : found}. ` +
            "Update Docker Engine: https://docs.docker.com/engine/install/.",
        );
      }
      return true;
    },
    async imageId(image) {
      const output = await docker(["image", "inspect", "--format", "{{.Id}}", image]);
      if (output.code === 0) return output.stdout.trim();
      if (missing(output.stderr)) return undefined;
      throw new DockerError(["image", "inspect"], output);
    },
    async inspect(container) {
      return (await inspectAll([container]))[0];
    },
    async containers(labels) {
      const ids = (await ok(["ps", "-aq", "--no-trunc", ...labels.flatMap((l) => ["--filter", `label=${l}`])])).split("\n").filter(Boolean);
      return inspectAll(ids);
    },
    run: (args, options) => docker(["run", ...args], options),
    async port(container) {
      const output = await docker(["port", container, "8080/tcp"]);
      const port = Number(output.stdout.trim().split("\n")[0]?.split(":").at(-1));
      return output.code === 0 && Number.isSafeInteger(port) && port > 0 ? port : undefined;
    },
    async logs(container, lines) {
      const output = await docker(["logs", "--tail", String(lines), container]);
      return (output.stdout + output.stderr).trim();
    },
    remove: (container) => removing(["rm", "-f", container]),
    async volumeExists(name) {
      const output = await docker(["volume", "inspect", name]);
      if (output.code === 0) return true;
      if (missing(output.stderr)) return false;
      throw new DockerError(["volume", "inspect"], output);
    },
    async createVolume(name, labels) {
      await ok(["volume", "create", ...Object.entries(labels).flatMap(([k, v]) => ["--label", v === "" ? k : `${k}=${v}`]), name]);
    },
    async volumes(labels) {
      return (await ok(["volume", "ls", "-q", ...labels.flatMap((l) => ["--filter", `label=${l}`])])).split("\n").filter(Boolean);
    },
    removeVolume: (name) => removing(["volume", "rm", name]),
    removeNetwork: (name) => removing(["network", "rm", name]),
    removeImage: (image) => removing(["image", "rm", image]),
    pull: async (image) => void (await ok(["pull", "--quiet", image])),
    async listImages(pattern) {
      const listed = await ok(["image", "ls", "--filter", `reference=${pattern}`, "--format", "{{.Repository}}:{{.Tag}}"]);
      return [...new Set(listed.split("\n").filter((line) => line !== "" && !line.endsWith(":<none>")))];
    },
  };
}
