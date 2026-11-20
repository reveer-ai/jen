// The engine, reached through the user's own `docker` command, which resolves
// their context and DOCKER_HOST the way they configured it. Only the calls jen
// makes are here. A secret reaches a child only through its environment or
// its stdin, never its arguments, which any user on the machine can read.

import { spawn } from "node:child_process";

export interface Output {
  code: number;
  stdout: string;
  stderr: string;
}

// Runs a program with args, adding env to the inherited environment and
// writing input to its stdin. A program that can't be started at all, such as
// a missing one, answers code -1 with the reason in stderr.
export type Runner = (program: string, args: string[], options?: { env?: Record<string, string>; input?: string }) => Promise<Output>;

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

// The engine can't be reached: no docker command, or no engine answering it.
export class Unreachable extends Error {
  constructor(reason: string) {
    super(`docker isn't reachable, so jen can't run: ${reason.trim()}. Start Docker and try again.`);
    this.name = "Unreachable";
  }
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
  // Fails with Unreachable unless the engine answers.
  ping(): Promise<void>;
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

export function createDocker(runner: Runner = runProcess): Docker {
  const docker = async (args: string[], { env = {}, secrets = {}, guard = [], input }: RunOptions = {}) => {
    for (const value of [...Object.values(secrets), ...guard]) {
      if (value !== "" && args.some((arg) => arg.includes(value))) throw new Error("a secret would have been passed as an argument to docker");
    }
    return runner("docker", args, { env: { ...env, ...secrets }, input });
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

  return {
    async ping() {
      const output = await docker(["version", "--format", "{{.Server.Version}}"]);
      if (output.code !== 0) throw new Unreachable(output.stderr || `docker exited with code ${output.code}`);
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
  };
}
