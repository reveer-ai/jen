import { createHash } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, test, vi } from "vitest";
import { DockerError } from "./docker.ts";
import { FakeDocker } from "./fake-docker.ts";
import { Runtime, RuntimeError, waitForConnection, type RuntimeOptions } from "./runtime.ts";

const model = { model: "m", apiKey: "k", baseURL: "https://example.test/v1" };

// A runtime on a fake engine, started from its own container.
async function setup(options: Partial<RuntimeOptions> = {}) {
  const docker = new FakeDocker();
  const self = docker.add({ name: "jen-runtime" });
  const runtime = new Runtime({ docker, name: "jen", image: "jen", model, maxDepth: 3, maxAgents: 10, ready: async () => {}, ...options });
  await runtime.startup(self.id);
  // An agent as a caller, with its current token.
  const as = (id: string) => ({ id, credential: sha256(tokenOf(docker, id)) });
  return { docker, runtime, self, as };
}

const container = (docker: FakeDocker, id: string, name = "jen") => docker.find(`${name}-agent-${id}`);
const tokenOf = (docker: FakeDocker, id: string, name = "jen") =>
  container(docker, id, name)!.env.find((e) => e.startsWith("JEN_TOKEN="))!.slice("JEN_TOKEN=".length);
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

async function refused(promise: Promise<unknown>, status: number) {
  const error = (await promise.catch((e) => e)) as RuntimeError;
  expect(error).toBeInstanceOf(RuntimeError);
  expect(error.status).toBe(status);
  return error;
}

describe("spawn", () => {
  test("the owner spawns a running root agent with fixed settings", async () => {
    const { docker, runtime } = await setup();
    const agent = await runtime.spawn(null, { spawn: true });
    expect(agent).toEqual({ id: expect.stringMatching(/^[0-9a-f]{12}$/), parent: null, grant: { spawn: true }, state: "running" });

    expect(docker.volumes.get(`jen-agent-${agent.id}`)!.labels).toEqual({
      "jen.runtime": "jen",
      "jen.agent": agent.id,
      "jen.parent": "",
      "jen.grant": '{"spawn":true}',
    });
    const c = container(docker, agent.id)!;
    const token = tokenOf(docker, agent.id);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(c.state).toBe("running");
    expect(c.spec).toEqual({
      image: "jen",
      env: ["JEN_MODEL=m", "JEN_API_KEY=k", "JEN_BASE_URL=https://example.test/v1", `JEN_TOKEN=${token}`, "JEN_RUNTIME_URL=http://runtime:8080"],
      labels: { "jen.runtime": "jen", "jen.agent": agent.id, "jen.credential": sha256(token) },
      volume: { name: `jen-agent-${agent.id}`, path: "/state" },
      network: "jen",
      maxRetries: 3,
    });
  });

  test("leaves JEN_BASE_URL out when the runtime has none", async () => {
    const { docker, runtime } = await setup({ model: { model: "m", apiKey: "k" } });
    const agent = await runtime.spawn(null, { spawn: false });
    expect(container(docker, agent.id)!.env.some((e) => e.startsWith("JEN_BASE_URL"))).toBe(false);
  });

  test("an agent spawns a sub-agent with its own token", async () => {
    const { docker, runtime } = await setup();
    const root = await runtime.spawn(null, { spawn: true });
    const caller = await runtime.identify(tokenOf(docker, root.id));
    expect(caller).toEqual({ id: root.id, credential: sha256(tokenOf(docker, root.id)) });
    const child = await runtime.spawn(caller!, { spawn: false });
    expect(child).toMatchObject({ parent: root.id, grant: { spawn: false }, state: "running" });
    expect(docker.volumes.get(`jen-agent-${child.id}`)!.labels["jen.parent"]).toBe(root.id);
  });

  test("a caller without spawn is refused and nothing is created", async () => {
    const { docker, runtime, as } = await setup();
    const root = await runtime.spawn(null, { spawn: false });
    const before = [docker.volumes.size, docker.containers.size];
    await refused(runtime.spawn(as(root.id), { spawn: false }), 403);
    expect([docker.volumes.size, docker.containers.size]).toEqual(before);
  });

  test("a spawn deeper than the maximum depth is refused", async () => {
    const { runtime, as } = await setup({ maxDepth: 2 });
    const root = await runtime.spawn(null, { spawn: true });
    const child = await runtime.spawn(as(root.id), { spawn: true });
    await refused(runtime.spawn(as(child.id), { spawn: false }), 403);
  });

  test("stopped agents count toward the maximum number", async () => {
    const { runtime } = await setup({ maxAgents: 2 });
    const first = await runtime.spawn(null, { spawn: false });
    await runtime.spawn(null, { spawn: false });
    await runtime.stop(null, first.id);
    await refused(runtime.spawn(null, { spawn: false }), 403);
  });

  test("concurrent spawns run one at a time, so they can't pass the bound together", async () => {
    const { runtime } = await setup({ maxAgents: 2 });
    const results = await Promise.allSettled([1, 2, 3].map(() => runtime.spawn(null, { spawn: false })));
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "fulfilled", "rejected"]);
    expect(await runtime.list(null)).toHaveLength(2);
  });

  test("a spawn whose start fails leaves nothing behind", async () => {
    const { docker, runtime } = await setup();
    vi.spyOn(docker, "startContainer").mockRejectedValueOnce(new DockerError(500, "cannot start"));
    const error = await refused(runtime.spawn(null, { spawn: false }), 500);
    expect(error.agent).toBeUndefined();
    expect(error.message).toContain("cannot start");
    expect(await runtime.list(null)).toEqual([]);
    expect(docker.volumes.size).toBe(0);
    expect(docker.containers.size).toBe(1); // the runtime's own
  });

  test("a spawn whose start response is lost removes the container it started", async () => {
    const { docker, runtime } = await setup();
    const start = docker.startContainer.bind(docker);
    vi.spyOn(docker, "startContainer").mockImplementationOnce(async (name) => {
      await start(name);
      throw new Error("socket hang up");
    });
    await refused(runtime.spawn(null, { spawn: false }), 500);
    expect(await runtime.list(null)).toEqual([]);
    expect(docker.volumes.size).toBe(0);
    expect(docker.containers.size).toBe(1);
  });

  test("a spawn whose cleanup also fails names the agent it left", async () => {
    const { docker, runtime } = await setup();
    vi.spyOn(docker, "startContainer").mockRejectedValueOnce(new DockerError(500, "cannot start"));
    vi.spyOn(docker, "removeVolume").mockRejectedValueOnce(new DockerError(500, "cannot remove"));
    const error = await refused(runtime.spawn(null, { spawn: false }), 500);
    expect(error.agent).toMatch(/^[0-9a-f]{12}$/);
    expect(await runtime.list(null)).toEqual([{ id: error.agent, parent: null, grant: { spawn: false }, state: "stopped" }]);
  });

  test("a caller deleted while its spawn waited is refused", async () => {
    const { runtime, as } = await setup();
    const root = await runtime.spawn(null, { spawn: true });
    const child = await runtime.spawn(as(root.id), { spawn: true });
    const [, spawned] = await Promise.allSettled([runtime.delete(null, root.id), runtime.spawn(as(child.id), { spawn: false })]);
    expect(spawned.status).toBe("rejected");
    expect(await runtime.list(null)).toEqual([]);
  });
});

describe("a caller's token is checked when the operation runs", () => {
  test("a caller stopped, or stopped and started, since it authenticated is refused, and nothing changes", async () => {
    for (const restart of [false, true]) {
      const { docker, runtime, as } = await setup();
      const root = await runtime.spawn(null, { spawn: true });
      const child = await runtime.spawn(as(root.id), { spawn: false });
      const stale = as(root.id);
      await runtime.stop(null, root.id);
      await runtime.start(null, child.id);
      if (restart) await runtime.start(null, root.id);
      const before = [docker.volumes.size, docker.containers.size];
      await refused(runtime.spawn(stale, { spawn: false }), 401);
      await refused(runtime.stop(stale, child.id), 401);
      await refused(runtime.start(stale, child.id), 401);
      await refused(runtime.delete(stale, child.id), 401);
      await refused(runtime.target(stale, child.id), 401);
      await refused(runtime.get(stale, child.id), 401);
      await refused(runtime.list(stale), 401);
      expect([docker.volumes.size, docker.containers.size]).toEqual(before);
      expect((await runtime.get(null, child.id)).state).toBe("running");
    }
  });
});

describe("reach", () => {
  test("an agent can't reach its sibling, by any route", async () => {
    const { docker, runtime, as } = await setup();
    const a = await runtime.spawn(null, { spawn: true });
    const b = await runtime.spawn(null, { spawn: true });
    await refused(runtime.get(as(a.id), b.id), 404);
    await refused(runtime.stop(as(a.id), b.id), 404);
    await refused(runtime.start(as(a.id), b.id), 404);
    await refused(runtime.delete(as(a.id), b.id), 404);
    await refused(runtime.target(as(a.id), b.id), 404);
    expect(container(docker, b.id)!.state).toBe("running");
  });

  test("an agent can't reach itself", async () => {
    const { runtime, as } = await setup();
    const a = await runtime.spawn(null, { spawn: true });
    await refused(runtime.stop(as(a.id), a.id), 404);
    expect((await runtime.get(null, a.id)).state).toBe("running");
  });

  test("an ID that doesn't exist is not found", async () => {
    const { runtime } = await setup();
    await refused(runtime.get(null, "000000000000"), 404);
  });

  test("an agent lists exactly its descendants", async () => {
    const { runtime, as } = await setup();
    const root = await runtime.spawn(null, { spawn: true });
    const sibling = await runtime.spawn(null, { spawn: true });
    const child = await runtime.spawn(as(root.id), { spawn: true });
    const grandchild = await runtime.spawn(as(child.id), { spawn: false });
    const ids = async (id: string | null) => (await runtime.list(id === null ? null : as(id))).map((a) => a.id).sort();
    expect(await ids(root.id)).toEqual([child.id, grandchild.id].sort());
    expect(await ids(child.id)).toEqual([grandchild.id]);
    expect(await ids(null)).toEqual([root.id, sibling.id, child.id, grandchild.id].sort());
    expect(await runtime.get(as(root.id), grandchild.id)).toMatchObject({ parent: child.id });
  });
});

describe("stop, start and delete", () => {
  test("stopping a parent stops its child and keeps both", async () => {
    const { docker, runtime, as } = await setup();
    const root = await runtime.spawn(null, { spawn: true });
    const child = await runtime.spawn(as(root.id), { spawn: false });
    expect(await runtime.stop(null, root.id)).toMatchObject({ id: root.id, state: "stopped" });
    expect(container(docker, root.id)).toBeUndefined();
    expect(container(docker, child.id)).toBeUndefined();
    expect(docker.volumes.has(`jen-agent-${root.id}`) && docker.volumes.has(`jen-agent-${child.id}`)).toBe(true);
    expect((await runtime.list(null)).map((a) => a.state)).toEqual(["stopped", "stopped"]);
  });

  test("stop works deepest first", async () => {
    const { docker, runtime, as } = await setup();
    const root = await runtime.spawn(null, { spawn: true });
    const child = await runtime.spawn(as(root.id), { spawn: true });
    const grandchild = await runtime.spawn(as(child.id), { spawn: false });
    const removed = vi.spyOn(docker, "removeContainer");
    await runtime.stop(null, root.id);
    expect(removed.mock.calls.map(([name]) => name)).toEqual([grandchild.id, child.id, root.id].map((id) => `jen-agent-${id}`));
  });

  test("stopping a stopped agent succeeds", async () => {
    const { runtime } = await setup();
    const root = await runtime.spawn(null, { spawn: false });
    await runtime.stop(null, root.id);
    expect(await runtime.stop(null, root.id)).toMatchObject({ state: "stopped" });
  });

  test("starting resumes from the same volume and leaves descendants alone", async () => {
    const { docker, runtime, as } = await setup();
    const root = await runtime.spawn(null, { spawn: true });
    const child = await runtime.spawn(as(root.id), { spawn: false });
    await runtime.stop(null, root.id);
    expect(await runtime.start(null, root.id)).toMatchObject({ state: "running" });
    expect(container(docker, root.id)!.spec!.volume.name).toBe(`jen-agent-${root.id}`);
    expect((await runtime.get(null, child.id)).state).toBe("stopped");
  });

  test("an agent starts whatever its parent's state", async () => {
    const { runtime, as } = await setup();
    const root = await runtime.spawn(null, { spawn: true });
    const child = await runtime.spawn(as(root.id), { spawn: false });
    await runtime.stop(null, root.id);
    await runtime.start(null, child.id);
    expect((await runtime.get(null, child.id)).state).toBe("running");
    expect((await runtime.get(null, root.id)).state).toBe("stopped");
  });

  test("starting a running agent changes nothing", async () => {
    const { docker, runtime } = await setup();
    const root = await runtime.spawn(null, { spawn: false });
    const before = container(docker, root.id)!.id;
    expect(await runtime.start(null, root.id)).toMatchObject({ state: "running" });
    expect(container(docker, root.id)!.id).toBe(before);
  });

  test("starting removes a leftover container, such as one the engine gave up restarting", async () => {
    const { docker, runtime, as } = await setup();
    const root = await runtime.spawn(null, { spawn: false });
    const crashed = container(docker, root.id)!;
    crashed.state = "exited";
    expect((await runtime.get(null, root.id)).state).toBe("stopped");
    await runtime.start(null, root.id);
    expect(docker.containers.has(crashed.id)).toBe(false);
    expect(container(docker, root.id)!.state).toBe("running");
  });

  test("a start that fails after create leaves the agent stopped with its state", async () => {
    const { docker, runtime, as } = await setup();
    const root = await runtime.spawn(null, { spawn: false });
    await runtime.stop(null, root.id);
    vi.spyOn(docker, "startContainer").mockRejectedValueOnce(new DockerError(500, "cannot start"));
    await refused(runtime.start(null, root.id), 500);
    expect(container(docker, root.id)).toBeUndefined();
    expect(docker.volumes.has(`jen-agent-${root.id}`)).toBe(true);
    expect((await runtime.get(null, root.id)).state).toBe("stopped");
  });

  test("deleting a parent removes both, and frees their places", async () => {
    const { docker, runtime, as } = await setup({ maxAgents: 2 });
    const root = await runtime.spawn(null, { spawn: true });
    await runtime.spawn(as(root.id), { spawn: false });
    await runtime.delete(null, root.id);
    expect(await runtime.list(null)).toEqual([]);
    expect(docker.volumes.size).toBe(0);
    expect(docker.containers.size).toBe(1);
    await runtime.spawn(null, { spawn: false });
    await runtime.spawn(null, { spawn: false });
  });

  test("repeating an interrupted delete finishes it", async () => {
    const { docker, runtime, as } = await setup();
    const root = await runtime.spawn(null, { spawn: true });
    const child = await runtime.spawn(as(root.id), { spawn: false });
    vi.spyOn(docker, "removeVolume").mockRejectedValueOnce(new DockerError(500, "interrupted"));
    await expect(runtime.delete(null, root.id)).rejects.toThrow("interrupted");
    // The child went first, so whatever remains still has its parent.
    expect((await runtime.list(null)).every((a) => a.parent === null || a.parent === root.id)).toBe(true);
    await runtime.delete(null, root.id);
    expect(await runtime.list(null)).toEqual([]);
    expect(docker.volumes.has(`jen-agent-${child.id}`)).toBe(false);
  });

  test("an agent restarting after a crash is running, and its child is untouched", async () => {
    const { docker, runtime, as } = await setup();
    const root = await runtime.spawn(null, { spawn: true });
    const child = await runtime.spawn(as(root.id), { spawn: false });
    container(docker, root.id)!.state = "restarting";
    expect((await runtime.get(null, root.id)).state).toBe("running");
    expect(container(docker, child.id)!.state).toBe("running");
  });
});

describe("tokens", () => {
  test("starting gives a new token, and the old one no longer identifies the agent", async () => {
    const { docker, runtime } = await setup();
    const root = await runtime.spawn(null, { spawn: false });
    const old = tokenOf(docker, root.id);
    await runtime.stop(null, root.id);
    expect(await runtime.identify(old)).toBeUndefined();
    await runtime.start(null, root.id);
    const current = tokenOf(docker, root.id);
    expect(current).not.toBe(old);
    expect(await runtime.identify(old)).toBeUndefined();
    expect((await runtime.identify(current))?.id).toBe(root.id);
  });

  test("an unknown token identifies no one", async () => {
    const { runtime } = await setup();
    await runtime.spawn(null, { spawn: false });
    expect(await runtime.identify("nope")).toBeUndefined();
  });

  test("the relay target is the agent's container and current token", async () => {
    const { docker, runtime } = await setup();
    const root = await runtime.spawn(null, { spawn: false });
    expect(await runtime.target(null, root.id)).toEqual({ url: `http://jen-agent-${root.id}:8080`, token: tokenOf(docker, root.id) });
    await runtime.stop(null, root.id);
    await refused(runtime.target(null, root.id), 409);
  });
});

describe("runtimes with different names", () => {
  test("neither sees the other's agents", async () => {
    const docker = new FakeDocker();
    const make = async (name: string) => {
      const self = docker.add({ name: `${name}-runtime` });
      const runtime = new Runtime({ docker, name, image: "jen", model, maxDepth: 3, maxAgents: 10, ready: async () => {} });
      await runtime.startup(self.id);
      return runtime;
    };
    const one = await make("one");
    const two = await make("two");
    const a = await one.spawn(null, { spawn: false });
    expect(await two.list(null)).toEqual([]);
    await refused(two.stop(null, a.id), 404);
    expect((await one.identify(tokenOf(docker, a.id, "one")))?.id).toBe(a.id);
    expect(await two.identify(tokenOf(docker, a.id, "one"))).toBeUndefined();
  });
});

describe("startup", () => {
  // A fake engine with the runtime's container under a name of Docker's choosing.
  function engine() {
    const docker = new FakeDocker();
    const self = docker.add({ name: "eager_turing" });
    const runtime = new Runtime({ docker, name: "jen", image: "jen", model, maxDepth: 3, maxAgents: 10, ready: async () => {} });
    return { docker, self, runtime };
  }

  // Adds an agent's volume, and its container in the given state.
  function agent(docker: FakeDocker, id: string, parent: string | null, state?: string) {
    const name = `jen-agent-${id}`;
    docker.volumes.set(name, { name, labels: { "jen.runtime": "jen", "jen.agent": id, "jen.parent": parent ?? "", "jen.grant": '{"spawn":true}' } });
    if (state) docker.add({ name, state, labels: { "jen.runtime": "jen", "jen.agent": id, "jen.credential": "x" }, volume: name });
  }

  test("claims the runtime's name, creates the network and joins it as runtime", async () => {
    const { docker, self, runtime } = engine();
    await runtime.startup(self.id);
    expect(self.name).toBe("jen-runtime");
    expect(docker.networks.get("jen")).toMatchObject({ labels: { "jen.runtime": "jen" } });
    expect(docker.networks.get("jen")!.aliases.get(self.id)).toEqual(["runtime"]);
  });

  test("a restarted runtime that already holds its name and network changes nothing", async () => {
    const { docker, self, runtime } = engine();
    await runtime.startup(self.id);
    const connect = vi.spyOn(docker, "connectNetwork");
    const rename = vi.spyOn(docker, "renameContainer");
    await new Runtime({ docker, name: "jen", image: "jen", model, maxDepth: 3, maxAgents: 10, ready: async () => {} }).startup(self.id);
    expect(connect).not.toHaveBeenCalled();
    expect(rename).not.toHaveBeenCalled();
  });

  test("exits when a live runtime holds the name, having changed nothing", async () => {
    const { docker, self, runtime } = engine();
    const holder = docker.add({ name: "jen-runtime", state: "running" });
    agent(docker, "aaaaaaaaaaaa", "gone00000000", "exited");
    await expect(runtime.startup(self.id)).rejects.toThrow(`another runtime named jen is running, in container ${holder.id.slice(0, 12)}`);
    expect(self.name).toBe("eager_turing");
    expect(docker.networks.size).toBe(0);
    expect(docker.volumes.size).toBe(1);
    expect(docker.containers.size).toBe(3);
  });

  test("a restarting holder counts as live", async () => {
    const { docker, self, runtime } = engine();
    docker.add({ name: "jen-runtime", state: "restarting" });
    await expect(runtime.startup(self.id)).rejects.toThrow("another runtime named jen is running");
  });

  test("replaces a dead runtime that holds the name", async () => {
    const { docker, self, runtime } = engine();
    const holder = docker.add({ name: "jen-runtime", state: "exited" });
    await runtime.startup(self.id);
    expect(docker.containers.has(holder.id)).toBe(false);
    expect(self.name).toBe("jen-runtime");
  });

  test("exits when another runtime wins the race for the name", async () => {
    const { docker, self, runtime } = engine();
    vi.spyOn(docker, "renameContainer").mockRejectedValueOnce(new DockerError(409, "name in use"));
    await expect(runtime.startup(self.id)).rejects.toThrow("another runtime named jen claimed the name first");
  });

  test("exits when it isn't running in a container", async () => {
    const { runtime } = engine();
    await expect(runtime.startup("laptop")).rejects.toThrow("the runtime must run in a container");
  });

  test("joins a network that already exists", async () => {
    const { docker, self, runtime } = engine();
    await docker.createNetwork("jen", {});
    await runtime.startup(self.id);
    expect(self.networks).toEqual(["jen"]);
  });

  test("leaves running and restarting agents alone, and removes leftover containers", async () => {
    const { docker, self, runtime } = engine();
    agent(docker, "aaaaaaaaaaaa", null, "running");
    agent(docker, "bbbbbbbbbbbb", "aaaaaaaaaaaa", "restarting");
    agent(docker, "cccccccccccc", null, "exited");
    agent(docker, "dddddddddddd", null, "created");
    await runtime.startup(self.id);
    expect(container(docker, "aaaaaaaaaaaa")!.state).toBe("running");
    expect(container(docker, "bbbbbbbbbbbb")!.state).toBe("restarting");
    expect(container(docker, "cccccccccccc")).toBeUndefined();
    expect(container(docker, "dddddddddddd")).toBeUndefined();
    expect((await runtime.list(null)).map((a) => [a.id, a.state])).toEqual([
      ["aaaaaaaaaaaa", "running"],
      ["bbbbbbbbbbbb", "running"],
      ["cccccccccccc", "stopped"],
      ["dddddddddddd", "stopped"],
    ]);
  });

  test("removes a container whose agent has no volume", async () => {
    const { docker, self, runtime } = engine();
    const stray = docker.add({ name: "jen-agent-eeeeeeeeeeee", labels: { "jen.runtime": "jen", "jen.agent": "eeeeeeeeeeee" } });
    await runtime.startup(self.id);
    expect(docker.containers.has(stray.id)).toBe(false);
  });

  test("deletes a detached agent and its subtree before serving", async () => {
    const { docker, self, runtime } = engine();
    agent(docker, "aaaaaaaaaaaa", "000000000000", "running");
    agent(docker, "bbbbbbbbbbbb", "aaaaaaaaaaaa", "running");
    agent(docker, "cccccccccccc", "bbbbbbbbbbbb");
    agent(docker, "dddddddddddd", null, "running");
    await runtime.startup(self.id);
    expect((await runtime.list(null)).map((a) => a.id)).toEqual(["dddddddddddd"]);
    expect([...docker.volumes.keys()]).toEqual(["jen-agent-dddddddddddd"]);
    expect(container(docker, "aaaaaaaaaaaa")).toBeUndefined();
    expect(container(docker, "bbbbbbbbbbbb")).toBeUndefined();
  });

  test("ignores volumes and containers of other runtimes and unlabelled volumes", async () => {
    const { docker, self, runtime } = engine();
    docker.volumes.set("jen-state", { name: "jen-state", labels: {} });
    const other = docker.add({ name: "two-agent-aaaaaaaaaaaa", state: "exited", labels: { "jen.runtime": "two", "jen.agent": "aaaaaaaaaaaa" } });
    await runtime.startup(self.id);
    expect(docker.volumes.has("jen-state")).toBe(true);
    expect(docker.containers.has(other.id)).toBe(true);
    expect(await runtime.list(null)).toEqual([]);
  });
});

describe("readiness", () => {
  test("spawn and start wait until the agent accepts connections, at its address", async () => {
    const waited: string[] = [];
    const { docker, runtime } = await setup({ ready: async (url) => void waited.push(url) });
    const root = await runtime.spawn(null, { spawn: false });
    await runtime.stop(null, root.id);
    await runtime.start(null, root.id);
    expect(waited).toEqual([`http://jen-agent-${root.id}:8080`, `http://jen-agent-${root.id}:8080`]);
    expect(container(docker, root.id)!.state).toBe("running");
  });

  test("a spawn whose agent never comes up leaves nothing behind", async () => {
    const { docker, runtime } = await setup({ ready: async () => Promise.reject(new Error("never came up")) });
    const error = await refused(runtime.spawn(null, { spawn: false }), 500);
    expect(error.message).toContain("never came up");
    expect(docker.volumes.size).toBe(0);
    expect(docker.containers.size).toBe(1);
  });

  test("a start whose agent never comes up leaves it stopped with its state", async () => {
    let up = true;
    const { docker, runtime, as } = await setup({ ready: async () => (up ? undefined : Promise.reject(new Error("never came up"))) });
    const root = await runtime.spawn(null, { spawn: false });
    await runtime.stop(null, root.id);
    up = false;
    await refused(runtime.start(null, root.id), 500);
    expect(container(docker, root.id)).toBeUndefined();
    expect(docker.volumes.has(`jen-agent-${root.id}`)).toBe(true);
    expect((await runtime.get(null, root.id)).state).toBe("stopped");
  });

  test("waitForConnection resolves once something listens, even if it starts late", async () => {
    const server = http.createServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    await new Promise((resolve) => server.close(resolve));
    const waiting = waitForConnection(`http://127.0.0.1:${port}`, 5_000);
    await new Promise((resolve) => setTimeout(resolve, 300));
    await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
    await waiting;
    await new Promise((resolve) => server.close(resolve));
  });

  test("waitForConnection gives up when nothing listens", async () => {
    const server = http.createServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    await new Promise((resolve) => server.close(resolve));
    await expect(waitForConnection(`http://127.0.0.1:${port}`, 300)).rejects.toThrow("didn't accept connections within 0.3 seconds");
  });
});
