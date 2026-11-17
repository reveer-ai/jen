// An in-memory Docker engine for tests. It keeps the engine's rules the
// runtime depends on: names are unique, a volume in use can't be removed,
// removal of something absent succeeds, a container's network must exist
// unless it's "none", an exec runs only in a running container, and removing
// a container ends its execs' streams.

import { randomBytes } from "node:crypto";
import { DockerError, type Container, type ContainerDetails, type ContainerSpec, type Docker, type ExecEnd, type ExecRead, type ExecSpec, type Volume } from "./docker.ts";

// An exec as a test drives it, in place of the command it was asked to run.
export interface FakeExec {
  // The container's name.
  container: string;
  // As it was asked for, without its input.
  spec: ExecSpec;
  // What was written to its stdin, when it was given input.
  input?: Buffer;
  // Writes to the exec's stdout. Nothing is read once reading has stopped.
  write(data: string | Buffer): void;
  // Ends the stream, as the exec's process does when it exits.
  end(): void;
  // Why reading stopped, once it has.
  stopped?: ExecEnd;
}

export interface FakeContainer extends ContainerDetails {
  // The spec it was created with. Undefined for one a test added by hand.
  spec?: ContainerSpec;
  volume?: string;
}

// The settings createNetwork gives a network on the engine.
const AGENTS_NETWORK = { internal: true, enableIPv6: false, gatewayModeIPv4: "isolated" } as const;

export interface FakeNetwork {
  name: string;
  labels: Record<string, string>;
  aliases: Map<string, string[]>;
  internal: boolean;
  enableIPv6: boolean;
  gatewayModeIPv4: "isolated" | "nat";
}

export class FakeDocker implements Docker {
  readonly volumes = new Map<string, Volume>();
  readonly containers = new Map<string, FakeContainer>();
  readonly networks = new Map<string, FakeNetwork>();
  readonly #watches = new Set<{ labels: string[]; onExit: (id: string) => void }>();
  // Every exec, in the order they started.
  readonly execs: FakeExec[] = [];
  // Drives each exec as it starts. By default an exec writes nothing and ends.
  onExec: (exec: FakeExec) => void = (exec) => exec.end();

  // Ends a container's process, as a crash does. With restart, the engine
  // restarts it; without, it's left exited, as when its restarts run out.
  exit(nameOrId: string, { restart }: { restart: boolean }) {
    const c = this.#get(nameOrId);
    c.state = restart ? "restarting" : "exited";
    for (const exec of this.execs) if (exec.container === c.name) exec.end();
    for (const watch of this.#watches) if (matches(c.labels, watch.labels)) watch.onExit(c.id);
  }

  // Adds a container directly, such as the runtime's own, and returns it.
  add(container: Partial<FakeContainer> & { name: string }): FakeContainer {
    const added: FakeContainer = { id: randomBytes(32).toString("hex"), state: "running", startedAt: started(), labels: {}, env: [], networks: [], ...container };
    this.containers.set(added.id, added);
    return added;
  }

  // Finds a container by ID or name.
  find(nameOrId: string): FakeContainer | undefined {
    return this.containers.get(nameOrId) ?? [...this.containers.values()].find((c) => c.name === nameOrId);
  }

  async createVolume(name: string, labels: Record<string, string>) {
    this.#ensureVolume(name, labels);
  }
  async listVolumes(labels: string[]) {
    return [...this.volumes.values()].filter((v) => matches(v.labels, labels)).map((v) => structuredClone(v));
  }
  async removeVolume(name: string) {
    if ([...this.containers.values()].some((c) => c.volume === name)) throw new DockerError(409, `volume ${name} is in use`);
    this.volumes.delete(name);
  }

  async createContainer(name: string, spec: ContainerSpec) {
    if (this.find(name)) throw new DockerError(409, `the container name "/${name}" is already in use`);
    if (spec.network !== "none" && !this.networks.has(spec.network)) throw new DockerError(404, `network ${spec.network} not found`);
    // The engine creates a missing volume, with no labels.
    this.#ensureVolume(spec.volume.name, {});
    const created = this.add({ name, state: "created", labels: { ...spec.labels }, env: [...spec.env], networks: [spec.network], spec: structuredClone(spec), volume: spec.volume.name });
    return created.id;
  }
  async startContainer(nameOrId: string) {
    const c = this.#get(nameOrId);
    c.state = "running";
    c.startedAt = started();
  }

  // Brings a container its engine was restarting back, as a new start.
  restarted(nameOrId: string) {
    void this.startContainer(nameOrId);
  }
  async listContainers(labels: string[]): Promise<Container[]> {
    return [...this.containers.values()]
      .filter((c) => matches(c.labels, labels))
      .map(({ id, name, state, labels }) => ({ id, name, state, labels: { ...labels } }));
  }
  async inspectContainer(nameOrId: string): Promise<ContainerDetails | undefined> {
    const c = this.find(nameOrId);
    return c && { id: c.id, name: c.name, state: c.state, startedAt: c.startedAt, labels: { ...c.labels }, env: [...c.env], networks: [...c.networks] };
  }
  async renameContainer(nameOrId: string, name: string) {
    const c = this.#get(nameOrId);
    if (this.find(name)) throw new DockerError(409, `the container name "/${name}" is already in use`);
    c.name = name;
  }
  async removeContainer(nameOrId: string) {
    const c = this.find(nameOrId);
    if (!c) return;
    this.containers.delete(c.id);
    for (const exec of this.execs) if (exec.container === c.name) exec.end();
  }

  exec(container: string, spec: ExecSpec, read: ExecRead): Promise<ExecEnd> {
    const c = this.find(container);
    if (!c) return Promise.reject(new DockerError(404, `No such container: ${container}`));
    if (c.state !== "running") return Promise.reject(new DockerError(409, `container ${c.id} is not running`));
    return new Promise((resolve) => {
      let size = 0;
      const stop = (end: ExecEnd) => {
        if (exec.stopped) return;
        exec.stopped = end;
        read.signal.removeEventListener("abort", aborted);
        resolve(end);
      };
      const aborted = () => stop("aborted");
      const { input, ...rest } = spec;
      const exec: FakeExec = {
        container: c.name,
        spec: structuredClone(rest),
        ...(input === undefined ? {} : { input: Buffer.from(input) }),
        write(data) {
          if (exec.stopped) return;
          const bytes = Buffer.from(data);
          const room = read.bound - size;
          size += bytes.length;
          read.onOutput(bytes.length > room ? bytes.subarray(0, room) : bytes);
          if (size > read.bound) stop("bound");
        },
        end: () => stop("ended"),
      };
      this.execs.push(exec);
      if (read.signal.aborted) return stop("aborted");
      read.signal.addEventListener("abort", aborted, { once: true });
      this.onExec(exec);
    });
  }

  async createNetwork(name: string, labels: Record<string, string>) {
    if (this.networks.has(name)) throw new DockerError(409, `network with name ${name} already exists`);
    this.networks.set(name, { name, labels: { ...labels }, aliases: new Map(), ...AGENTS_NETWORK });
  }
  async inspectNetwork(name: string) {
    return this.networks.has(name) ? { name } : undefined;
  }
  async connectNetwork(network: string, container: string, aliases: string[]) {
    const n = this.networks.get(network);
    if (!n) throw new DockerError(404, `network ${network} not found`);
    const c = this.#get(container);
    if (c.networks.includes(network)) throw new DockerError(403, `endpoint already exists in network ${network}`);
    c.networks.push(network);
    n.aliases.set(c.id, [...aliases]);
  }

  watchExits(labels: string[], onExit: (id: string) => void) {
    const watch = { labels, onExit };
    this.#watches.add(watch);
    return () => void this.#watches.delete(watch);
  }

  #ensureVolume(name: string, labels: Record<string, string>) {
    if (!this.volumes.has(name)) this.volumes.set(name, { name, labels: { ...labels } });
  }

  #get(nameOrId: string): FakeContainer {
    const c = this.find(nameOrId);
    if (!c) throw new DockerError(404, `No such container: ${nameOrId}`);
    return c;
  }
}

// A start time no other start shares, as the engine's are in nanoseconds.
let starts = 0;
const started = () => `2026-01-01T00:00:00.${String(++starts).padStart(9, "0")}Z`;

function matches(labels: Record<string, string>, filters: string[]): boolean {
  return filters.every((filter) => {
    const at = filter.indexOf("=");
    return at < 0 ? filter in labels : labels[filter.slice(0, at)] === filter.slice(at + 1);
  });
}
