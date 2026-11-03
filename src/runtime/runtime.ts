// The tree of agents on one Docker engine. Docker holds the only record: each
// agent is a labelled volume, and each run of it is a container. The runtime
// keeps nothing of its own, so it can be restarted at any moment and read the
// tree back.
//
// A caller is the owner (null) or an agent, named by its ID and the hash of
// the token it authenticated with. The owner is every agent's ancestor and has
// every capability; a root agent's parent is the owner.

import { createHash, randomBytes } from "node:crypto";
import net from "node:net";
import { DockerError, type Container, type Docker } from "./docker.ts";

export type Caller = { id: string; credential: string } | null;

export interface Grant {
  spawn: boolean;
}

export interface Agent {
  id: string;
  parent: string | null;
  grant: Grant;
  state: "running" | "stopped";
}

export interface RuntimeOptions {
  docker: Docker;
  // JEN_RUNTIME_NAME. Every label, volume, container and network carries it.
  name: string;
  // The agent image, run with its default command.
  image: string;
  model: { model: string; apiKey: string; baseURL?: string };
  maxDepth: number;
  maxAgents: number;
  // Where an agent's protocol is served, given its container's name.
  agentURL?: (container: string) => string;
  // Resolves once an agent at url accepts connections, and rejects if it
  // never does.
  ready?: (url: string) => Promise<void>;
}

// A refusal or failure the API reports with status. agent names an agent a
// failed spawn left behind.
export class RuntimeError extends Error {
  readonly status: number;
  readonly agent?: string;
  constructor(status: number, message: string, agent?: string) {
    super(message);
    this.name = "RuntimeError";
    this.status = status;
    this.agent = agent;
  }
}

// The owner's grant: every capability.
const OWNER_GRANT: Grant = { spawn: true };
const MAX_RETRIES = 3;
// The address agents reach the runtime at, by its alias on their network.
const RUNTIME_URL = "http://runtime:8080";
const READY_MS = 30_000;

interface Node {
  id: string;
  parent: string | null;
  grant: Grant;
  container?: Container;
}

// A container is alive while it runs, or while the engine restarts it after
// a crash. Any other state is left over and counts as stopped.
export const alive = (state: string) => state === "running" || state === "restarting";

export class Runtime {
  readonly #o: Required<RuntimeOptions>;
  // Tree operations run one at a time, in order.
  #queue: Promise<unknown> = Promise.resolve();

  constructor(options: RuntimeOptions) {
    this.#o = { agentURL: (container) => `http://${container}:8080`, ready: (url) => waitForConnection(url), ...options };
  }

  // Claims the runtime's name, joins its network, and repairs what a crash
  // left behind. hostname is the runtime's own container's ID.
  startup(hostname: string): Promise<void> {
    return this.#serial(async () => {
      const { docker, name } = this.#o;
      const self = await docker.inspectContainer(hostname);
      if (!self) throw new Error(`the runtime must run in a container, and none has the ID ${hostname}`);

      // Container names are unique on an engine, so holding this one is the lock.
      const claim = `${name}-runtime`;
      if (self.name !== claim) {
        const holder = await docker.inspectContainer(claim);
        if (holder && alive(holder.state)) {
          throw new Error(`another runtime named ${name} is running, in container ${holder.id.slice(0, 12)}`);
        }
        if (holder) await docker.removeContainer(holder.id);
        try {
          await docker.renameContainer(self.id, claim);
        } catch (error) {
          if (error instanceof DockerError && error.status === 409) throw new Error(`another runtime named ${name} claimed the name first`);
          throw error;
        }
      }

      if (!(await docker.inspectNetwork(name))) {
        try {
          await docker.createNetwork(name, { "jen.runtime": name });
        } catch (error) {
          if (!(error instanceof DockerError && error.status === 409)) throw error;
        }
      }
      if (!self.networks.includes(name)) await docker.connectNetwork(name, self.id, ["runtime"]);

      const { nodes, containers } = await this.#read();
      for (const c of containers) {
        if (!alive(c.state) || !nodes.has(c.labels["jen.agent"])) await docker.removeContainer(c.id);
      }
      // Detached: an agent whose parent is gone. Its subtree goes with it.
      for (const node of nodes.values()) {
        if (node.parent !== null && !nodes.has(node.parent) && nodes.has(node.id)) {
          for (const gone of subtree(nodes, node.id)) {
            await this.#remove(gone.id);
            nodes.delete(gone.id);
          }
        }
      }
    });
  }

  // The running agent whose current token is token, or undefined.
  async identify(token: string): Promise<Caller | undefined> {
    const credential = sha256(token);
    const { nodes } = await this.#read();
    for (const node of nodes.values()) {
      if (current(node, credential)) return { id: node.id, credential };
    }
    return undefined;
  }

  spawn(caller: Caller, grant: Grant): Promise<Agent> {
    return this.#serial(async () => {
      const { nodes } = await this.#read();
      const parentId = authorize(nodes, caller);
      let parentGrant = OWNER_GRANT;
      let depth = 1;
      if (parentId !== null) {
        const parent = nodes.get(parentId)!;
        parentGrant = parent.grant;
        depth = depthOf(nodes, parent) + 1;
      }
      if (!parentGrant.spawn) throw new RuntimeError(403, "the caller may not spawn");
      for (const key of Object.keys(grant) as (keyof Grant)[]) {
        if (grant[key] && !parentGrant[key]) throw new RuntimeError(403, `the grant exceeds the caller's: ${key}`);
      }
      if (depth > this.#o.maxDepth) throw new RuntimeError(403, `the agent would be deeper than ${this.#o.maxDepth}`);
      if (nodes.size >= this.#o.maxAgents) throw new RuntimeError(403, `the runtime already holds ${this.#o.maxAgents} agents`);

      const node: Node = { id: randomBytes(6).toString("hex"), parent: parentId, grant: { spawn: grant.spawn } };
      try {
        await this.#o.docker.createVolume(this.#resource(node.id), {
          "jen.runtime": this.#o.name,
          "jen.agent": node.id,
          "jen.parent": node.parent ?? "",
          "jen.grant": JSON.stringify(node.grant),
        });
        await this.#run(node.id);
      } catch (error) {
        // The step may have happened even if it reported failure, so undo
        // everything by name.
        try {
          await this.#remove(node.id);
        } catch {
          throw new RuntimeError(500, `spawning failed (${message(error)}), and agent ${node.id} is left stopped or running`, node.id);
        }
        throw new RuntimeError(500, `spawning failed: ${message(error)}`);
      }
      return describe(node, "running");
    });
  }

  // The caller's descendants.
  async list(caller: Caller): Promise<Agent[]> {
    const { nodes } = await this.#read();
    const by = authorize(nodes, caller);
    return [...nodes.values()].filter((node) => reaches(nodes, by, node.id)).map((node) => describe(node));
  }

  async get(caller: Caller, id: string): Promise<Agent> {
    const { nodes } = await this.#read();
    return describe(reach(nodes, caller, id));
  }

  // Stops the agent and everything under it, deepest first, keeping state.
  stop(caller: Caller, id: string): Promise<Agent> {
    return this.#serial(async () => {
      const { nodes } = await this.#read();
      const target = reach(nodes, caller, id);
      for (const node of subtree(nodes, id)) await this.#o.docker.removeContainer(this.#resource(node.id));
      return describe(target, "stopped");
    });
  }

  // Starts a stopped agent from its state. Its descendants are left as they are.
  start(caller: Caller, id: string): Promise<Agent> {
    return this.#serial(async () => {
      const { nodes } = await this.#read();
      const target = reach(nodes, caller, id);
      if (target.container && alive(target.container.state)) return describe(target);
      await this.#o.docker.removeContainer(this.#resource(id));
      try {
        await this.#run(id);
      } catch (error) {
        await this.#o.docker.removeContainer(this.#resource(id));
        throw new RuntimeError(500, `starting failed: ${message(error)}`);
      }
      return describe(target, "running");
    });
  }

  // Deletes the agent and everything under it, deepest first, with their state.
  delete(caller: Caller, id: string): Promise<void> {
    return this.#serial(async () => {
      const { nodes } = await this.#read();
      reach(nodes, caller, id);
      for (const node of subtree(nodes, id)) await this.#remove(node.id);
    });
  }

  // Where to relay to a running agent the caller can reach, and its current token.
  async target(caller: Caller, id: string): Promise<{ url: string; token: string }> {
    const { nodes } = await this.#read();
    const node = reach(nodes, caller, id);
    if (!node.container || !alive(node.container.state)) throw new RuntimeError(409, `agent ${id} is stopped`);
    const details = await this.#o.docker.inspectContainer(node.container.id);
    const token = details?.env.find((e) => e.startsWith("JEN_TOKEN="))?.slice("JEN_TOKEN=".length);
    if (!details || !alive(details.state) || !token) throw new RuntimeError(409, `agent ${id} is stopped`);
    return { url: this.#o.agentURL(details.name), token };
  }

  // Creates and starts a new container for the agent, with a new token, and
  // waits until the agent accepts connections.
  async #run(id: string) {
    const { docker, name, image, model } = this.#o;
    const token = randomBytes(32).toString("hex");
    const resource = this.#resource(id);
    await docker.createContainer(resource, {
      image,
      env: [
        `JEN_MODEL=${model.model}`,
        `JEN_API_KEY=${model.apiKey}`,
        ...(model.baseURL ? [`JEN_BASE_URL=${model.baseURL}`] : []),
        `JEN_TOKEN=${token}`,
        `JEN_RUNTIME_URL=${RUNTIME_URL}`,
      ],
      labels: { "jen.runtime": name, "jen.agent": id, "jen.credential": sha256(token) },
      volume: { name: resource, path: "/state" },
      network: name,
      maxRetries: MAX_RETRIES,
    });
    await docker.startContainer(resource);
    await this.#o.ready(this.#o.agentURL(resource));
  }

  // Removes an agent's container and then its volume. Each step succeeds when
  // there's nothing to remove, so an interrupted removal can be repeated.
  async #remove(id: string) {
    await this.#o.docker.removeContainer(this.#resource(id));
    await this.#o.docker.removeVolume(this.#resource(id));
  }

  // The tree as the engine has it: every agent, with its container if it has
  // one, and every agent container, including ones with no agent.
  async #read(): Promise<{ nodes: Map<string, Node>; containers: Container[] }> {
    const labels = [`jen.runtime=${this.#o.name}`, "jen.agent"];
    const [volumes, containers] = await Promise.all([this.#o.docker.listVolumes(labels), this.#o.docker.listContainers(labels)]);
    const nodes = new Map<string, Node>();
    for (const v of volumes) {
      const id = v.labels["jen.agent"];
      if (v.name !== this.#resource(id)) continue;
      nodes.set(id, { id, parent: v.labels["jen.parent"] || null, grant: parseGrant(v.labels["jen.grant"]) });
    }
    for (const c of containers) {
      const node = nodes.get(c.labels["jen.agent"]);
      if (node && c.name === this.#resource(node.id)) node.container = c;
    }
    return { nodes, containers };
  }

  // An agent's volume and container share this name.
  #resource(id: string) {
    return `${this.#o.name}-agent-${id}`;
  }

  #serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#queue.then(operation);
    this.#queue = result.catch(() => {});
    return result;
  }
}

// Connects to url's host and port every 100 ms until one connection succeeds,
// for at most timeoutMs. A name that doesn't resolve yet counts as refused.
export async function waitForConnection(url: string, timeoutMs = READY_MS): Promise<void> {
  const { hostname, port } = new URL(url);
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const socket = net.connect({ host: hostname, port: Number(port) });
    socket.setTimeout(1_000);
    const connected = await new Promise<boolean>((resolve) => {
      socket.once("connect", () => resolve(true));
      socket.once("error", () => resolve(false));
      socket.once("timeout", () => resolve(false));
    });
    socket.destroy();
    if (connected) return;
    if (Date.now() >= deadline) throw new Error(`the agent didn't accept connections within ${timeoutMs / 1000} seconds`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

function describe(node: Node, state?: Agent["state"]): Agent {
  return {
    id: node.id,
    parent: node.parent,
    grant: { ...node.grant },
    state: state ?? (node.container && alive(node.container.state) ? "running" : "stopped"),
  };
}

// Whether id is a strict descendant of caller.
function reaches(nodes: Map<string, Node>, caller: string | null, id: string): boolean {
  let parent = nodes.get(id)?.parent;
  if (parent === undefined) return false;
  if (caller === null) return true;
  while (parent !== null) {
    if (parent === caller) return true;
    const next = nodes.get(parent);
    if (!next) return false;
    parent = next.parent;
  }
  return false;
}

// The caller's ID, if its token is still current in this read of the tree: an
// agent stopped or restarted since it authenticated has no authority left.
// Every operation checks this against the tree it acts on, after any wait in
// the queue or for a request body.
function authorize(nodes: Map<string, Node>, caller: Caller): string | null {
  if (caller === null) return null;
  const node = nodes.get(caller.id);
  if (!node || !current(node, caller.credential)) throw new RuntimeError(401, "the caller's token is no longer current");
  return node.id;
}

// Whether the node is running with the token whose hash is credential.
function current(node: Node, credential: string): boolean {
  return !!node.container && alive(node.container.state) && node.container.labels["jen.credential"] === credential;
}

// The node, if the caller may act on it. Anything else is not found, so a
// caller can't probe for agents outside its subtree.
function reach(nodes: Map<string, Node>, caller: Caller, id: string): Node {
  if (!reaches(nodes, authorize(nodes, caller), id)) throw new RuntimeError(404, `no agent ${id}`);
  return nodes.get(id)!;
}

function depthOf(nodes: Map<string, Node>, node: Node): number {
  let depth = 1;
  for (let p = node.parent; p !== null; p = nodes.get(p)?.parent ?? null) depth++;
  return depth;
}

// The agent and its descendants, deepest first, so that whatever remains
// after an interruption still has its parent.
function subtree(nodes: Map<string, Node>, id: string): Node[] {
  const root = nodes.get(id)!;
  const found = [root, ...[...nodes.values()].filter((n) => reaches(nodes, id, n.id))];
  return found.sort((a, b) => depthOf(nodes, b) - depthOf(nodes, a));
}

function parseGrant(label: string | undefined): Grant {
  try {
    return { spawn: JSON.parse(label ?? "{}")?.spawn === true };
  } catch {
    return { spawn: false };
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
