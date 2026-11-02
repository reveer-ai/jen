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
  network: string;
  // The on-failure restart policy's maximum retry count.
  maxRetries: number;
}

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
  // Forced, so it kills a running container. Removes its anonymous volumes,
  // such as the image's /state on a runtime container, and keeps named ones,
  // such as an agent's state. Succeeds when the container doesn't exist.
  removeContainer(nameOrId: string): Promise<void>;

  createNetwork(name: string, labels: Record<string, string>): Promise<void>;
  // Undefined when the network doesn't exist.
  inspectNetwork(name: string): Promise<{ name: string } | undefined>;
  connectNetwork(network: string, container: string, aliases: string[]): Promise<void>;
}

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
        HostConfig: {
          Mounts: [{ Type: "volume", Source: spec.volume.name, Target: spec.volume.path }],
          NetworkMode: spec.network,
          RestartPolicy: { Name: "on-failure", MaximumRetryCount: spec.maxRetries },
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
        labels: c.Config?.Labels ?? {},
        env: c.Config?.Env ?? [],
        networks: Object.keys(c.NetworkSettings?.Networks ?? {}),
      };
    },
    async renameContainer(nameOrId, name) {
      await call("POST", `/containers/${id(nameOrId)}/rename?name=${id(name)}`);
    },
    async removeContainer(nameOrId) {
      await absentOk(call("DELETE", `/containers/${id(nameOrId)}?force=true&v=true`));
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
  };
}

function parse(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return { message: text.trim() };
  }
}
