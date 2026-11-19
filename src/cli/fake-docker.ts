// An in-memory engine for the command's tests, behind the same interface as
// docker.ts. It runs the few containers jen runs: the short-lived ones that
// read and write the settings volume, and the runtime's, which a test serves
// with a stand-in of the runtime's API on a port of its own.

import { randomBytes } from "node:crypto";
import { Unreachable, type ContainerInfo, type Docker, type Output, type RunOptions } from "./docker.ts";

export interface FakeContainer extends ContainerInfo {
  // The host port its 8080 is published on, once it's started.
  port?: number;
  // The -p it was run with.
  publish?: string;
}

export interface RuntimeRun {
  args: string[];
  options: RunOptions;
  // The port asked for, or undefined for one Docker chooses.
  port?: number;
}

export class FakeDocker implements Docker {
  reachable = true;
  // Image names to IDs.
  readonly images = new Map<string, string>();
  readonly containers_ = new Map<string, FakeContainer>();
  // Volumes, with their labels and files.
  readonly volumes_ = new Map<string, { labels: Record<string, string>; files: Map<string, string> }>();
  readonly networks = new Set<string>();
  // Every docker run, in order.
  readonly runs: { args: string[]; options: RunOptions }[] = [];
  // Ports already taken on the host.
  readonly taken = new Set<number>();
  // The port Docker chooses next.
  nextPort = 49_000;
  // Called when the runtime's container starts, with the port asked for, and
  // answers the port it's published on. A test serves the runtime's API there,
  // or makes it exit. By default Docker chooses the next port.
  onRuntime: (container: FakeContainer, asked: number | undefined) => Promise<number | undefined> = async (_, asked) => asked ?? this.nextPort++;
  // Called when a container is removed.
  onRemove: (container: FakeContainer) => Promise<void> = async () => {};
  // Called before a docker run of the runtime, which it can fail, such as
  // with a name conflict, by returning output.
  beforeRuntime: (run: RuntimeRun) => Output | undefined = () => undefined;
  // Every call, by its name, in order.
  readonly calls: string[] = [];
  readonly logs_ = new Map<string, string>();

  constructor({ images = true }: { images?: boolean } = {}) {
    if (images) for (const image of ["jen-runtime", "jen-agent", "jen-workspace"]) this.build(image);
  }

  // Builds an image anew: same name, new ID.
  build(image: string) {
    const id = `sha256:${randomBytes(8).toString("hex")}`;
    this.images.set(image, id);
    return id;
  }

  // Adds a container directly, such as an agent the runtime started.
  add(container: Partial<FakeContainer> & { name: string }): FakeContainer {
    const added: FakeContainer = { id: randomBytes(32).toString("hex"), image: "", state: "running", env: [], labels: {}, ...container };
    this.containers_.set(added.id, added);
    return added;
  }

  find(nameOrId: string): FakeContainer | undefined {
    return this.containers_.get(nameOrId) ?? [...this.containers_.values()].find((c) => c.name === nameOrId);
  }

  // The settings file, parsed, or undefined.
  settings(name = "jen"): any {
    const text = this.volumes_.get(`${name}-settings`)?.files.get("settings.json");
    return text === undefined ? undefined : JSON.parse(text);
  }

  #log(call: string) {
    this.calls.push(call);
  }

  async ping() {
    this.#log("ping");
    if (!this.reachable) throw new Unreachable("failed to connect to the docker API");
  }
  async imageId(image: string) {
    this.#log("imageId");
    return this.images.get(image);
  }
  async inspect(container: string) {
    this.#log("inspect");
    const found = this.find(container);
    return found && structuredClone(found);
  }
  async containers(labels: string[]) {
    this.#log("containers");
    return [...this.containers_.values()].filter((c) => matches(c.labels, labels)).map((c) => structuredClone(c));
  }
  async port(container: string) {
    this.#log("port");
    return this.find(container)?.port;
  }
  async logs(container: string) {
    return this.logs_.get(container) ?? "";
  }
  async remove(container: string) {
    this.#log("remove");
    const found = this.find(container);
    if (found) {
      this.containers_.delete(found.id);
      if (found.port !== undefined) this.taken.delete(found.port);
      await this.onRemove(found);
    }
  }
  async volumeExists(name: string) {
    return this.volumes_.has(name);
  }
  async createVolume(name: string, labels: Record<string, string>) {
    if (!this.volumes_.has(name)) this.volumes_.set(name, { labels: { ...labels }, files: new Map() });
  }
  async volumes(labels: string[]) {
    return [...this.volumes_].filter(([, v]) => matches(v.labels, labels)).map(([name]) => name);
  }
  async removeVolume(name: string) {
    this.#log("removeVolume");
    if ([...this.containers_.values()].some((c) => c.labels["jen.volume"] === name)) throw new Error(`volume ${name} is in use`);
    this.volumes_.delete(name);
  }
  async removeNetwork(name: string) {
    this.#log("removeNetwork");
    this.networks.delete(name);
  }
  async removeImage(image: string) {
    this.#log("removeImage");
    this.images.delete(image);
  }

  async run(args: string[], options: RunOptions = {}): Promise<Output> {
    this.#log("run");
    this.runs.push({ args, options });
    const done = (stdout = ""): Output => ({ code: 0, stdout, stderr: "" });
    const fail = (stderr: string, code = 125): Output => ({ code, stdout: "", stderr });
    const after = (flag: string) => args[args.indexOf(flag) + 1]!;
    if (args.includes("--entrypoint")) {
      const [volume] = after("-v").split(":");
      const image = args[args.indexOf("--entrypoint") + 2]!;
      if (!this.images.has(image)) return fail(`Unable to find image '${image}:latest' locally`);
      // docker run creates a volume it doesn't find, with no labels.
      if (!this.volumes_.has(volume!)) this.volumes_.set(volume!, { labels: {}, files: new Map() });
      const files = this.volumes_.get(volume!)!.files;
      if (after("--entrypoint") === "cat") {
        const text = files.get("settings.json");
        return text === undefined ? fail("cat: /settings/settings.json: No such file or directory", 1) : done(text);
      }
      files.set("settings.json", options.input ?? "");
      return done();
    }

    // The runtime: docker run -d --name <name>-runtime ... <image>.
    const name = after("--name");
    const image = args.at(-1)!;
    const publish = after("-p");
    const asked = publish.split(":")[1] ? Number(publish.split(":")[1]) : undefined;
    const failed = this.beforeRuntime({ args, options, port: asked });
    if (failed) return failed;
    if (this.find(name)) return fail(`docker: Error response from daemon: Conflict. The container name "/${name}" is already in use by container "x".`);
    if (!this.images.has(image)) return fail(`Unable to find image '${image}:latest' locally`);
    const labels: Record<string, string> = {};
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--label") {
        const [k, v = ""] = args[i + 1]!.split("=");
        labels[k!] = v;
      }
    }
    const values = { ...options.env, ...options.secrets };
    const env = args.flatMap((arg, i) => (args[i - 1] === "-e" ? [`${arg}=${values[arg] ?? ""}`] : []));
    const container = this.add({ name, image: this.images.get(image)!, state: "created", env, labels, publish });
    if (asked !== undefined && this.taken.has(asked)) {
      return fail(`docker: Error response from daemon: driver failed programming external connectivity: Bind for 127.0.0.1:${asked} failed: port is already allocated.`);
    }
    container.state = "running";
    container.port = await this.onRuntime(container, asked);
    if (container.port !== undefined) this.taken.add(container.port);
    return done(container.id);
  }
}

function matches(have: Record<string, string>, labels: string[]): boolean {
  return labels.every((label) => {
    const [key, value] = label.split("=");
    return key! in have && (value === undefined || have[key!] === value);
  });
}
