// An in-memory Docker engine for tests. It keeps the engine's rules the
// runtime depends on: names are unique, a volume in use can't be removed,
// removal of something absent succeeds, and a container's network must exist.

import { randomBytes } from "node:crypto";
import { DockerError, type Container, type ContainerDetails, type ContainerSpec, type Docker, type Volume } from "./docker.ts";

export interface FakeContainer extends ContainerDetails {
  // The spec it was created with. Undefined for one a test added by hand.
  spec?: ContainerSpec;
  volume?: string;
}

export class FakeDocker implements Docker {
  readonly volumes = new Map<string, Volume>();
  readonly containers = new Map<string, FakeContainer>();
  readonly networks = new Map<string, { name: string; labels: Record<string, string>; aliases: Map<string, string[]> }>();
  readonly #watches = new Set<{ labels: string[]; onExit: (id: string) => void }>();

  // Ends a container's process, as a crash does. With restart, the engine
  // restarts it; without, it's left exited, as when its restarts run out.
  exit(nameOrId: string, { restart }: { restart: boolean }) {
    const c = this.#get(nameOrId);
    c.state = restart ? "restarting" : "exited";
    for (const watch of this.#watches) if (matches(c.labels, watch.labels)) watch.onExit(c.id);
  }

  // Adds a container directly, such as the runtime's own, and returns it.
  add(container: Partial<FakeContainer> & { name: string }): FakeContainer {
    const added: FakeContainer = { id: randomBytes(32).toString("hex"), state: "running", labels: {}, env: [], networks: [], ...container };
    this.containers.set(added.id, added);
    return added;
  }

  // Finds a container by ID or name.
  find(nameOrId: string): FakeContainer | undefined {
    return this.containers.get(nameOrId) ?? [...this.containers.values()].find((c) => c.name === nameOrId);
  }

  async createVolume(name: string, labels: Record<string, string>) {
    if (!this.volumes.has(name)) this.volumes.set(name, { name, labels: { ...labels } });
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
    if (!this.networks.has(spec.network)) throw new DockerError(404, `network ${spec.network} not found`);
    // The engine creates a missing volume, with no labels.
    await this.createVolume(spec.volume.name, {});
    const created = this.add({ name, state: "created", labels: { ...spec.labels }, env: [...spec.env], networks: [spec.network], spec: structuredClone(spec), volume: spec.volume.name });
    return created.id;
  }
  async startContainer(nameOrId: string) {
    this.#get(nameOrId).state = "running";
  }
  async listContainers(labels: string[]): Promise<Container[]> {
    return [...this.containers.values()]
      .filter((c) => matches(c.labels, labels))
      .map(({ id, name, state, labels }) => ({ id, name, state, labels: { ...labels } }));
  }
  async inspectContainer(nameOrId: string): Promise<ContainerDetails | undefined> {
    const c = this.find(nameOrId);
    return c && { id: c.id, name: c.name, state: c.state, labels: { ...c.labels }, env: [...c.env], networks: [...c.networks] };
  }
  async renameContainer(nameOrId: string, name: string) {
    const c = this.#get(nameOrId);
    if (this.find(name)) throw new DockerError(409, `the container name "/${name}" is already in use`);
    c.name = name;
  }
  async removeContainer(nameOrId: string) {
    const c = this.find(nameOrId);
    if (c) this.containers.delete(c.id);
  }

  async createNetwork(name: string, labels: Record<string, string>) {
    if (this.networks.has(name)) throw new DockerError(409, `network with name ${name} already exists`);
    this.networks.set(name, { name, labels: { ...labels }, aliases: new Map() });
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

  #get(nameOrId: string): FakeContainer {
    const c = this.find(nameOrId);
    if (!c) throw new DockerError(404, `No such container: ${nameOrId}`);
    return c;
  }
}

function matches(labels: Record<string, string>, filters: string[]): boolean {
  return filters.every((filter) => {
    const at = filter.indexOf("=");
    return at < 0 ? filter in labels : labels[filter.slice(0, at)] === filter.slice(at + 1);
  });
}
