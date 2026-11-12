// A minimal Docker Engine API client over the engine's Unix socket. It covers
// only what the runtime calls. The API version is pinned in every path, so an
// engine that changes its defaults can't change what a request means.

import http from "node:http";

const VERSION = "v1.47";

// The engine answered with an error. status is the engine's HTTP status:
// 404 when the object doesn't exist, 409 on a conflict such as a name in use.
export class DockerError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "DockerError";
    this.status = status;
  }
}

export interface Volume {
  name: string;
  labels: Record<string, string>;
}

// A container's state as the engine names it: created, running, restarting,
// paused, exited, removing or dead.
export interface Container {
  id: string;
  // Without the leading slash the engine puts on it.
  name: string;
  state: string;
  labels: Record<string, string>;
}

export interface ContainerDetails extends Container {
  // When its process last started, which changes when the engine restarts it.
  startedAt: string;
  env: string[];
  // The networks the container is attached to, by name.
  networks: string[];
}

export interface ContainerSpec {
  image: string;
  env: string[];
  labels: Record<string, string>;
  // Mounted at its path inside the container.
  volume: { name: string; path: string };
  // A network's name, or "none" for loopback alone.
  network: string;
  // Restart on failure at most maxRetries times, or "unless-stopped" to
  // restart whenever the process exits, until the container is removed.
  restart: { maxRetries: number } | "unless-stopped";
  // When set, the container runs unprivileged and bounded.
  sandbox?: Sandbox;
}

// A container that runs as user with every capability dropped,
// no-new-privileges, an IPC namespace of its own, Docker's init as its first
// process, and a root filesystem it can't write. It can write only to its
// volume, a tmpfs at tmp.path that programs may be run from, and /dev/shm.
export interface Sandbox {
  user: string;
  tmp: { path: string; bytes: number };
  shmBytes: number;
  memoryBytes: number;
  nanoCpus: number;
  pids: number;
}

// A command to run in a running container, with stdin closed.
export interface ExecSpec {
  user: string;
  workdir: string;
  cmd: string[];
}

// How to read an exec's output. bound counts every byte of the stream,
// frame headers included, and onOutput gets what the command wrote to stdout
// as it arrives. Its stderr isn't read.
export interface ExecRead {
  bound: number;
  signal: AbortSignal;
  onOutput(chunk: Buffer): void;
}

// Why reading an exec stopped: its stream ended or broke, more than the
// bound arrived, or the signal aborted. The stream is closed in every case.
export type ExecEnd = "ended" | "bound" | "aborted";

// Every method acts on one engine. Labels filter with "key=value", or "key"
// for any value, and a list must match every filter.
export interface Docker {
  createVolume(name: string, labels: Record<string, string>): Promise<void>;
  listVolumes(labels: string[]): Promise<Volume[]>;
  // Succeeds when the volume doesn't exist.
  removeVolume(name: string): Promise<void>;

  // Returns the new container's ID.
  createContainer(name: string, spec: ContainerSpec): Promise<string>;
  startContainer(nameOrId: string): Promise<void>;
  // Every container, running or not.
  listContainers(labels: string[]): Promise<Container[]>;
  // Undefined when the container doesn't exist.
  inspectContainer(nameOrId: string): Promise<ContainerDetails | undefined>;
  renameContainer(nameOrId: string, name: string): Promise<void>;
  // Forced, so it kills a running container. Keeps its volumes, such as an
  // agent's state. Succeeds when the container doesn't exist.
  removeContainer(nameOrId: string): Promise<void>;

  createNetwork(name: string, labels: Record<string, string>): Promise<void>;
  // Undefined when the network doesn't exist.
  inspectNetwork(name: string): Promise<{ name: string } | undefined>;
  connectNetwork(network: string, container: string, aliases: string[]): Promise<void>;

  // Runs a command in a running container and reads its output until the
  // stream ends, the bound is passed or the signal aborts. Throws a
  // DockerError: 409 when the container isn't running, 404 when it's gone.
  exec(container: string, spec: ExecSpec, read: ExecRead): Promise<ExecEnd>;

  // Calls onExit with the ID of each container matching labels whose process
  // exits, until the returned function is called. A broken watch reconnects.
  watchExits(labels: string[], onExit: (id: string) => void): () => void;
}

const RECONNECT_MS = 1_000;

export function createDocker(socketPath = "/var/run/docker.sock"): Docker {
  async function call(method: string, path: string, body?: object): Promise<any> {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const { status, text } = await new Promise<{ status: number; text: string }>((resolve, reject) => {
      const req = http.request(
        {
          socketPath,
          method,
          path: `/${VERSION}${path}`,
          headers: payload === undefined ? {} : { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => chunks.push(chunk));
          res.on("end", () => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf8") }));
          res.on("error", reject);
        },
      );
      req.on("error", reject);
      req.end(payload);
    });
    const parsed = text === "" ? undefined : parse(text);
    if (status >= 400) throw new DockerError(status, parsed?.message ?? (text || `the engine answered ${status}`));
    return parsed;
  }

  // Absent is success for removal, and undefined for inspection.
  async function absentOk<T>(promise: Promise<T>): Promise<T | undefined> {
    try {
      return await promise;
    } catch (error) {
      if (error instanceof DockerError && error.status === 404) return undefined;
      throw error;
    }
  }

  const filters = (labels: string[]) => encodeURIComponent(JSON.stringify({ label: labels }));
  const id = encodeURIComponent;

  return {
    async createVolume(name, labels) {
      await call("POST", "/volumes/create", { Name: name, Labels: labels });
    },
    async listVolumes(labels) {
      const body = await call("GET", `/volumes?filters=${filters(labels)}`);
      return (body?.Volumes ?? []).map((v: any) => ({ name: v.Name, labels: v.Labels ?? {} }));
    },
    async removeVolume(name) {
      await absentOk(call("DELETE", `/volumes/${id(name)}`));
    },

    async createContainer(name, spec) {
      const body = await call("POST", `/containers/create?name=${id(name)}`, {
        Image: spec.image,
        Env: spec.env,
        Labels: spec.labels,
        ...(spec.sandbox ? { User: spec.sandbox.user } : {}),
        HostConfig: {
          Mounts: [{ Type: "volume", Source: spec.volume.name, Target: spec.volume.path }],
          NetworkMode: spec.network,
          RestartPolicy: spec.restart === "unless-stopped" ? { Name: "unless-stopped" } : { Name: "on-failure", MaximumRetryCount: spec.restart.maxRetries },
          ...(spec.sandbox ? sandboxed(spec.sandbox) : {}),
        },
      });
      return body.Id;
    },
    async startContainer(nameOrId) {
      await call("POST", `/containers/${id(nameOrId)}/start`);
    },
    async listContainers(labels) {
      const body = await call("GET", `/containers/json?all=true&filters=${filters(labels)}`);
      return body.map((c: any) => ({
        id: c.Id,
        name: (c.Names?.[0] ?? "").replace(/^\//, ""),
        state: c.State,
        labels: c.Labels ?? {},
      }));
    },
    async inspectContainer(nameOrId) {
      const c = await absentOk(call("GET", `/containers/${id(nameOrId)}/json`));
      if (c === undefined) return undefined;
      return {
        id: c.Id,
        name: (c.Name ?? "").replace(/^\//, ""),
        state: c.State?.Status ?? "",
        startedAt: c.State?.StartedAt ?? "",
        labels: c.Config?.Labels ?? {},
        env: c.Config?.Env ?? [],
        networks: Object.keys(c.NetworkSettings?.Networks ?? {}),
      };
    },
    async renameContainer(nameOrId, name) {
      await call("POST", `/containers/${id(nameOrId)}/rename?name=${id(name)}`);
    },
    async removeContainer(nameOrId) {
      await absentOk(call("DELETE", `/containers/${id(nameOrId)}?force=true`));
    },

    async createNetwork(name, labels) {
      await call("POST", "/networks/create", { Name: name, Driver: "bridge", Labels: labels });
    },
    async inspectNetwork(name) {
      const n = await absentOk(call("GET", `/networks/${id(name)}`));
      return n === undefined ? undefined : { name: n.Name };
    },
    async connectNetwork(network, container, aliases) {
      await call("POST", `/networks/${id(network)}/connect`, { Container: container, EndpointConfig: { Aliases: aliases } });
    },

    async exec(container, spec, read) {
      const created = await call("POST", `/containers/${id(container)}/exec`, {
        AttachStdin: false,
        AttachStdout: true,
        AttachStderr: false,
        Tty: false,
        User: spec.user,
        WorkingDir: spec.workdir,
        Cmd: spec.cmd,
      });
      const payload = JSON.stringify({ Detach: false, Tty: false });
      return new Promise<ExecEnd>((resolve, reject) => {
        let finished = false;
        // A hijacked stream belongs to one exec, so it gets a connection of its own.
        const req = http.request({
          socketPath,
          agent: false,
          method: "POST",
          path: `/${VERSION}/exec/${id(created.Id)}/start`,
          headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) },
        });
        const finish = (end: ExecEnd) => {
          if (finished) return;
          finished = true;
          read.signal.removeEventListener("abort", aborted);
          req.destroy();
          resolve(end);
        };
        const aborted = () => finish("aborted");
        if (read.signal.aborted) return finish("aborted");
        read.signal.addEventListener("abort", aborted, { once: true });
        req.on("response", (res) => {
          if ((res.statusCode ?? 0) >= 400) {
            const chunks: Buffer[] = [];
            res.on("data", (chunk: Buffer) => chunks.push(chunk));
            res.on("end", () => {
              const text = Buffer.concat(chunks).toString("utf8");
              finished = true;
              read.signal.removeEventListener("abort", aborted);
              reject(new DockerError(res.statusCode ?? 0, parse(text)?.message ?? `the engine answered ${res.statusCode}`));
            });
            return;
          }
          const frames = frameDecoder(read.onOutput);
          let size = 0;
          res.on("data", (chunk: Buffer) => {
            if (finished) return;
            const room = read.bound - size;
            size += chunk.length;
            frames(chunk.length > room ? chunk.subarray(0, room) : chunk);
            if (size > read.bound) finish("bound");
          });
          res.on("end", () => finish("ended"));
          res.on("error", () => finish("ended"));
          res.on("close", () => finish("ended"));
        });
        req.on("error", (error) => {
          if (finished) return;
          finished = true;
          read.signal.removeEventListener("abort", aborted);
          reject(error);
        });
        req.end(payload);
      });
    },

    watchExits(labels, onExit) {
      let closed = false;
      let req: http.ClientRequest | undefined;
      const query = encodeURIComponent(JSON.stringify({ type: ["container"], event: ["die"], label: labels }));
      const connect = () => {
        if (closed) return;
        let retried = false;
        const retry = () => {
          if (retried || closed) return;
          retried = true;
          setTimeout(connect, RECONNECT_MS).unref();
        };
        req = http.request({ socketPath, method: "GET", path: `/${VERSION}/events?filters=${query}` }, (res) => {
          if (res.statusCode !== 200) return void (res.resume(), retry());
          // The engine sends one JSON object per line.
          let buffer = "";
          res.setEncoding("utf8");
          res.on("data", (chunk: string) => {
            buffer += chunk;
            let end;
            while ((end = buffer.indexOf("\n")) >= 0) {
              const line = buffer.slice(0, end).trim();
              buffer = buffer.slice(end + 1);
              const event = line === "" ? undefined : parse(line);
              if (event?.Action === "die" && typeof event.Actor?.ID === "string") onExit(event.Actor.ID);
            }
          });
          res.on("end", retry);
          res.on("error", retry);
        });
        req.on("error", retry);
        req.end();
      };
      connect();
      return () => {
        closed = true;
        req?.destroy();
      };
    },
  };
}

// The engine's settings for a sandbox. Docker mounts a tmpfs noexec unless
// told otherwise, which would break tools that build and run helpers in /tmp.
function sandboxed(sandbox: Sandbox) {
  return {
    Tmpfs: { [sandbox.tmp.path]: `rw,exec,nosuid,nodev,size=${sandbox.tmp.bytes}` },
    ShmSize: sandbox.shmBytes,
    IpcMode: "private",
    CapDrop: ["ALL"],
    SecurityOpt: ["no-new-privileges"],
    ReadonlyRootfs: true,
    Init: true,
    PidsLimit: sandbox.pids,
    Memory: sandbox.memoryBytes,
    NanoCpus: sandbox.nanoCpus,
  };
}

// Splits an exec's multiplexed stream into its frames, each an 8-byte header
// (the stream, then the payload's length) and a payload, and passes stdout's
// payloads to onOutput. A frame may arrive across chunks.
function frameDecoder(onOutput: (chunk: Buffer) => void): (chunk: Buffer) => void {
  let pending: Buffer = Buffer.alloc(0);
  return (chunk) => {
    pending = pending.length === 0 ? chunk : Buffer.concat([pending, chunk]);
    while (pending.length >= 8) {
      const length = pending.readUInt32BE(4);
      if (pending.length < 8 + length) return;
      if (pending[0] === 1) onOutput(pending.subarray(8, 8 + length));
      pending = pending.subarray(8 + length);
    }
  };
}

function parse(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return { message: text.trim() };
  }
}
