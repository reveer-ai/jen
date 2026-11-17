import { createHash } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, test, vi } from "vitest";
import { DockerError } from "./docker.ts";
import { FakeDocker, type FakeExec } from "./fake-docker.ts";
import { postMessage, Runtime, RuntimeError, waitForConnection, type RuntimeOptions } from "./runtime.ts";
import { MAX_FILE, READ_SCRIPT, WRITE_SCRIPT, type CommandResult } from "./workspace.ts";

const model = "m";

// A runtime on a fake engine, started from its own container. sent records
// each message the runtime sends, by the container it was sent to.
async function setup(options: Partial<RuntimeOptions> = {}) {
  const docker = new FakeDocker();
  const self = docker.add({ name: "jen-runtime" });
  const sent: { to: string; text: string; wake?: string }[] = [];
  const send = async (url: string, token: string, text: string) => {
    const c = [...docker.containers.values()].find((c) => url === `http://${c.name}:8080` && c.env.includes(`JEN_TOKEN=${token}`))!;
    sent.push({ to: c.labels["jen.agent"]!, text, wake: envOf(c.env, "JEN_WAKE") });
  };
  const runtime = new Runtime({ docker, name: "jen", image: "jen", workspaceImage: "jen-workspace", model, maxDepth: 3, maxAgents: 10, ready: async () => {}, send, ...options });
  await runtime.startup(self.id);
  // An agent as a caller, with its current token.
  const as = (id: string) => ({ id, credential: sha256(tokenOf(docker, id)) });
  return { docker, runtime, self, as, sent };
}

const envOf = (env: string[], name: string) => env.find((e) => e.startsWith(`${name}=`))?.slice(name.length + 1);
const wakeOf = (docker: FakeDocker, id: string) => envOf(container(docker, id)!.env, "JEN_WAKE");

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
    expect(agent).toEqual({ id: expect.stringMatching(/^[0-9a-f]{12}$/), parent: null, grant: { spawn: true, workspace: false }, state: "running" });

    expect(docker.volumes.get(`jen-agent-${agent.id}`)!.labels).toEqual({
      "jen.runtime": "jen",
      "jen.agent": agent.id,
      "jen.parent": "",
      "jen.grant": '{"spawn":true,"workspace":false}',
    });
    const c = container(docker, agent.id)!;
    const token = tokenOf(docker, agent.id);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(c.state).toBe("running");
    expect(c.spec).toEqual({
      image: "jen",
      env: [
        "JEN_MODEL=m",
        `JEN_TOKEN=${token}`,
        "JEN_RUNTIME_URL=http://runtime:8080",
        `JEN_AGENT_ID=${agent.id}`,
        "JEN_PARENT=owner",
        'JEN_GRANT={"spawn":true,"workspace":false}',
      ],
      labels: { "jen.runtime": "jen", "jen.agent": agent.id, "jen.credential": sha256(token) },
      volume: { name: `jen-agent-${agent.id}`, path: "/state" },
      network: "jen",
      restart: { maxRetries: 3 },
    });
  });

  test("no agent is given the model's key or endpoint", async () => {
    vi.stubEnv("JEN_API_KEY", "sk-owner-key-7f3a");
    vi.stubEnv("JEN_BASE_URL", "https://provider.example.test/v1");
    try {
      const { docker, runtime, as } = await setup();
      const root = await runtime.spawn(null, { spawn: true, workspace: true });
      await runtime.spawn(as(root.id), { spawn: false });
      const agents = [...docker.containers.values()].filter((c) => c.labels["jen.agent"]);
      expect(agents).toHaveLength(2);
      for (const c of agents) {
        const config = JSON.stringify([c.env, c.spec]);
        for (const held of ["sk-owner-key-7f3a", "provider.example.test", "JEN_API_KEY", "JEN_BASE_URL"]) expect(config).not.toContain(held);
      }
    } finally {
      vi.unstubAllEnvs();
    }
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

  test("a caller without workspace can't pass it on, and nothing is created", async () => {
    const { docker, runtime, as } = await setup();
    const root = await runtime.spawn(null, { spawn: true });
    const before = [docker.volumes.size, docker.containers.size];
    const error = await refused(runtime.spawn(as(root.id), { workspace: true }), 403);
    expect(error.message).toBe("the grant exceeds the caller's: workspace");
    expect([docker.volumes.size, docker.containers.size]).toEqual(before);
  });

  test("a caller with workspace passes it on, and a missing capability is false", async () => {
    const { runtime, as } = await setup();
    const root = await runtime.spawn(null, { spawn: true, workspace: true });
    expect(root.grant).toEqual({ spawn: true, workspace: true });
    expect((await runtime.spawn(as(root.id), { workspace: true })).grant).toEqual({ spawn: false, workspace: true });
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
    expect(await runtime.list(null)).toEqual([{ id: error.agent, parent: null, grant: { spawn: false, workspace: false }, state: "stopped" }]);
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
      await refused(runtime.messageTarget(stale, child.id), 401);
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
      const runtime = new Runtime({ docker, name, image: "jen", workspaceImage: "jen-workspace", model, maxDepth: 3, maxAgents: 10, ready: async () => {} });
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
    const runtime = new Runtime({ docker, name: "jen", image: "jen", workspaceImage: "jen-workspace", model, maxDepth: 3, maxAgents: 10, ready: async () => {} });
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
    // Internal, with no IPv6 and an isolated gateway: agents on it reach
    // nothing but the runtime and each other.
    expect(docker.networks.get("jen")).toMatchObject({ labels: { "jen.runtime": "jen" }, internal: true, enableIPv6: false, gatewayModeIPv4: "isolated" });
    expect(docker.networks.get("jen")!.aliases.get(self.id)).toEqual(["runtime"]);
  });

  test("a restarted runtime that already holds its name and network changes nothing", async () => {
    const { docker, self, runtime } = engine();
    await runtime.startup(self.id);
    const connect = vi.spyOn(docker, "connectNetwork");
    const rename = vi.spyOn(docker, "renameContainer");
    await new Runtime({ docker, name: "jen", image: "jen", workspaceImage: "jen-workspace", model, maxDepth: 3, maxAgents: 10, ready: async () => {} }).startup(self.id);
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

  test("an agent stored before workspaces recovers without one", async () => {
    const { docker, self, runtime } = engine();
    agent(docker, "aaaaaaaaaaaa", null, "running");
    await runtime.startup(self.id);
    expect((await runtime.get(null, "aaaaaaaaaaaa")).grant).toEqual({ spawn: true, workspace: false });
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

describe("each agent is told who it is", () => {
  test("a sub-agent's container has its ID, its parent's and its grant", async () => {
    const { docker, runtime, as } = await setup();
    const root = await runtime.spawn(null, { spawn: true });
    const child = await runtime.spawn(as(root.id), { spawn: false });
    const env = container(docker, child.id)!.env;
    expect(envOf(env, "JEN_AGENT_ID")).toBe(child.id);
    expect(envOf(env, "JEN_PARENT")).toBe(root.id);
    expect(envOf(env, "JEN_GRANT")).toBe('{"spawn":false,"workspace":false}');
    expect(envOf(env, "JEN_WAKE")).toBeUndefined();
  });

  test("a restarted agent is told again", async () => {
    const { docker, runtime } = await setup();
    const root = await runtime.spawn(null, { spawn: false });
    await runtime.stop(null, root.id);
    await runtime.start(null, root.id);
    expect(envOf(container(docker, root.id)!.env, "JEN_PARENT")).toBe("owner");
  });
});

describe("the owner and the runtime have reserved IDs", () => {
  test("no route reaches owner or runtime", async () => {
    const { runtime, as } = await setup();
    const root = await runtime.spawn(null, { spawn: true });
    for (const id of ["owner", "runtime"]) {
      for (const caller of [null, as(root.id)]) {
        await refused(runtime.messageTarget(caller, id), 404);
        await refused(runtime.target(caller, id), 404);
        await refused(runtime.get(caller, id), 404);
        await refused(runtime.stop(caller, id), 404);
      }
    }
  });
});

describe("an agent can message its parent", () => {
  test("a child reaches its parent to message it, and nothing else of it", async () => {
    const { runtime, as } = await setup();
    const root = await runtime.spawn(null, { spawn: true });
    const child = await runtime.spawn(as(root.id), { spawn: false });
    expect(await runtime.messageTarget(as(child.id), root.id)).toMatchObject({ url: `http://jen-agent-${root.id}:8080` });
    await refused(runtime.stop(as(child.id), root.id), 404);
    await refused(runtime.target(as(child.id), root.id), 404);
    await refused(runtime.get(as(child.id), root.id), 404);
    expect((await runtime.get(null, root.id)).state).toBe("running");
  });

  test("a grandchild can't message its grandparent, and a sibling can't message a sibling", async () => {
    const { runtime, as } = await setup();
    const root = await runtime.spawn(null, { spawn: true });
    const child = await runtime.spawn(as(root.id), { spawn: true });
    const grandchild = await runtime.spawn(as(child.id), { spawn: false });
    const sibling = await runtime.spawn(as(root.id), { spawn: false });
    await refused(runtime.messageTarget(as(grandchild.id), root.id), 404);
    await refused(runtime.messageTarget(as(sibling.id), child.id), 404);
    await refused(runtime.messageTarget(as(root.id), root.id), 404);
  });
});

describe("a message to a stopped agent starts it", () => {
  test("a child's question wakes its stopped parent, held for the message, with no notice when nothing else is stopped", async () => {
    const { docker, runtime, as, sent } = await setup();
    const root = await runtime.spawn(null, { spawn: true });
    const child = await runtime.spawn(as(root.id), { spawn: false });
    // The root's crash restarts ran out while its child kept running.
    container(docker, root.id)!.state = "exited";
    const target = await runtime.messageTarget(as(child.id), root.id);
    expect((await runtime.get(null, root.id)).state).toBe("running");
    expect(target).toEqual({ url: `http://jen-agent-${root.id}:8080`, token: tokenOf(docker, root.id), notice: undefined });
    expect(wakeOf(docker, root.id)).toMatch(/^[0-9a-f]{32}$/);
    expect(sent).toEqual([]);
  });

  test("a woken agent with stopped children is told which, to send after the message, and they stay stopped", async () => {
    const { docker, runtime, as } = await setup();
    const root = await runtime.spawn(null, { spawn: true });
    const child = await runtime.spawn(as(root.id), { spawn: false });
    await runtime.stop(null, root.id);
    const target = await runtime.messageTarget(null, root.id);
    expect(target.notice).toBe(`You were stopped and have been started again. Your sub-agents ${child.id} are still stopped. Messaging one starts it.`);
    expect(wakeOf(docker, root.id)).toBeDefined();
    expect((await runtime.get(null, child.id)).state).toBe("stopped");
  });

  test("each wake gets a new wake ID, and a running target is reached without a start", async () => {
    const { docker, runtime } = await setup();
    const root = await runtime.spawn(null, { spawn: false });
    await runtime.stop(null, root.id);
    await runtime.messageTarget(null, root.id);
    const first = wakeOf(docker, root.id);
    const running = container(docker, root.id)!.id;
    await runtime.messageTarget(null, root.id);
    expect(container(docker, root.id)!.id).toBe(running);
    await runtime.stop(null, root.id);
    await runtime.messageTarget(null, root.id);
    expect(wakeOf(docker, root.id)).not.toBe(first);
  });

  test("a wake whose start fails fails as a start does, leaving the agent stopped", async () => {
    const { docker, runtime } = await setup();
    const root = await runtime.spawn(null, { spawn: false });
    await runtime.stop(null, root.id);
    vi.spyOn(docker, "startContainer").mockRejectedValueOnce(new DockerError(500, "cannot start"));
    const error = await refused(runtime.messageTarget(null, root.id), 500);
    expect(error.message).toContain("starting failed");
    expect((await runtime.get(null, root.id)).state).toBe("stopped");
  });

  test("watching a stopped agent doesn't wake it", async () => {
    const { runtime } = await setup();
    const root = await runtime.spawn(null, { spawn: false });
    await runtime.stop(null, root.id);
    await refused(runtime.target(null, root.id), 409);
    expect((await runtime.get(null, root.id)).state).toBe("stopped");
  });
});

describe("a start tells an agent its sub-agents are stopped", () => {
  test("a plain start, with no stopped children, sets no wake ID and sends nothing", async () => {
    const { docker, runtime, sent } = await setup();
    const root = await runtime.spawn(null, { spawn: false });
    await runtime.stop(null, root.id);
    await runtime.start(null, root.id);
    expect(wakeOf(docker, root.id)).toBeUndefined();
    expect(sent).toEqual([]);
  });

  test("an explicit start with a stopped child holds the agent and sends the notice as its only message", async () => {
    const { docker, runtime, as, sent } = await setup();
    const root = await runtime.spawn(null, { spawn: true });
    const child = await runtime.spawn(as(root.id), { spawn: false });
    await runtime.stop(null, root.id);
    await runtime.start(null, root.id);
    const wake = wakeOf(docker, root.id);
    expect(wake).toBeDefined();
    expect(sent).toEqual([
      { to: root.id, text: `You were stopped and have been started again. Your sub-agents ${child.id} are still stopped. Messaging one starts it.`, wake },
    ]);
    expect((await runtime.get(null, child.id)).state).toBe("stopped");
  });
});

describe("the runtime tells a parent its child's restarts ran out", () => {
  test("a child whose restarts ran out is reported to its running parent, from the runtime", async () => {
    const { docker, runtime, as, sent } = await setup();
    const stop = runtime.watch();
    const root = await runtime.spawn(null, { spawn: true });
    const child = await runtime.spawn(as(root.id), { spawn: false });
    docker.exit(`jen-agent-${child.id}`, { restart: false });
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({
      to: root.id,
      text: `Your sub-agent ${child.id} stopped: its process kept exiting and its restarts ran out. Message it to start it again.`,
    });
    stop();
  });

  test("a crash the engine restarts, and a root whose restarts ran out, send nothing", async () => {
    const { docker, runtime, as, sent } = await setup();
    runtime.watch();
    const root = await runtime.spawn(null, { spawn: true });
    const child = await runtime.spawn(as(root.id), { spawn: false });
    docker.exit(`jen-agent-${child.id}`, { restart: true });
    docker.exit(`jen-agent-${root.id}`, { restart: false });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(sent).toEqual([]);
    expect((await runtime.get(null, root.id)).state).toBe("stopped");
  });

  test("a stopped parent is started for the report, then told its sub-agents are stopped", async () => {
    const { docker, runtime, as, sent } = await setup();
    runtime.watch();
    const root = await runtime.spawn(null, { spawn: true });
    const a = await runtime.spawn(as(root.id), { spawn: false });
    // The root's own restarts ran out first, which isn't reported to the owner.
    docker.exit(`jen-agent-${root.id}`, { restart: false });
    docker.exit(`jen-agent-${a.id}`, { restart: false });
    await vi.waitFor(() => expect(sent).toHaveLength(2));
    const wake = wakeOf(docker, root.id);
    expect(wake).toBeDefined();
    expect(sent).toEqual([
      { to: root.id, text: `Your sub-agent ${a.id} stopped: its process kept exiting and its restarts ran out. Message it to start it again.`, wake },
      { to: root.id, text: `You were stopped and have been started again. Your sub-agents ${a.id} are still stopped. Messaging one starts it.`, wake },
    ]);
  });

  test("an exit handled after a queued stop doesn't start the stopped parent again", async () => {
    let hold: Promise<void> | undefined;
    const { docker, runtime, as, sent } = await setup({ ready: () => hold ?? Promise.resolve() });
    runtime.watch();
    const root = await runtime.spawn(null, { spawn: true });
    const child = await runtime.spawn(as(root.id), { spawn: false });
    let release!: () => void;
    hold = new Promise((resolve) => (release = resolve));
    // A spawn held in the queue, then a stop queued behind it, then the exit.
    const spawning = runtime.spawn(null, { spawn: false });
    const stopping = runtime.stop(null, root.id);
    docker.exit(`jen-agent-${child.id}`, { restart: false });
    await new Promise((resolve) => setTimeout(resolve, 20));
    hold = undefined;
    release();
    await spawning;
    expect((await stopping).state).toBe("stopped");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect((await runtime.get(null, root.id)).state).toBe("stopped");
    expect(sent).toEqual([]);
  });

  test("an exit of a container since replaced isn't reported", async () => {
    let hold: Promise<void> | undefined;
    const { docker, runtime, as, sent } = await setup({ ready: () => hold ?? Promise.resolve() });
    runtime.watch();
    const root = await runtime.spawn(null, { spawn: true });
    const child = await runtime.spawn(as(root.id), { spawn: false });
    let release!: () => void;
    hold = new Promise((resolve) => (release = resolve));
    const spawning = runtime.spawn(null, { spawn: false });
    // The child's restarts run out, and a start of it is queued before the
    // engine's exit event arrives.
    const old = container(docker, child.id)!.id;
    container(docker, child.id)!.state = "exited";
    const starting = runtime.start(null, child.id);
    docker.exit(old, { restart: false });
    hold = undefined;
    release();
    await spawning;
    await starting;
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(container(docker, child.id)!.id).not.toBe(old);
    expect(sent).toEqual([]);
  });
});

describe("a notice from the runtime can't hold the queue", () => {
  test("postMessage fails when the agent takes the message and never answers", async () => {
    const server = http.createServer((req) => req.resume());
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    await expect(postMessage(`http://127.0.0.1:${port}`, "t", "hello", 200)).rejects.toThrow();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  test("a start whose notice is never answered still returns, and the next operation runs", async () => {
    const server = http.createServer((req) => req.resume());
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    const { runtime, as } = await setup({ send: (_url, token, text) => postMessage(`http://127.0.0.1:${port}`, token, text, 200) });
    const root = await runtime.spawn(null, { spawn: true });
    await runtime.spawn(as(root.id), { spawn: false });
    await runtime.stop(null, root.id);
    vi.spyOn(process.stderr, "write").mockImplementationOnce(() => true);
    expect((await runtime.start(null, root.id)).state).toBe("running");
    expect((await runtime.stop(null, root.id)).state).toBe("stopped");
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
});

describe("the workspace follows what's done to its agent", () => {
  const ws = (id: string) => `jen-workspace-${id}`;
  const agentName = (id: string) => `jen-agent-${id}`;
  // Records each engine call that creates, starts or removes something, in order.
  function record(docker: FakeDocker) {
    const calls: string[] = [];
    for (const method of ["createVolume", "createContainer", "startContainer", "removeContainer", "removeVolume"] as const) {
      const original = (docker[method] as (...args: any[]) => Promise<unknown>).bind(docker);
      vi.spyOn(docker, method).mockImplementation((async (...args: any[]) => {
        calls.push(`${method} ${args[0]}`);
        return original(...args);
      }) as any);
    }
    return calls;
  }

  test("spawning creates the record, then the workspace volume, starts the workspace, then the agent", async () => {
    const { docker, runtime } = await setup();
    const calls = record(docker);
    const agent = await runtime.spawn(null, { workspace: true });
    const id = agent.id;
    expect(calls).toEqual([
      `createVolume ${agentName(id)}`,
      `createVolume ${ws(id)}`,
      `createContainer ${ws(id)}`,
      `startContainer ${ws(id)}`,
      `createContainer ${agentName(id)}`,
      `startContainer ${agentName(id)}`,
    ]);
    expect(docker.volumes.get(ws(id))!.labels).toEqual({ "jen.runtime": "jen", "jen.workspace": id });
    const c = docker.find(ws(id))!;
    expect(c.state).toBe("running");
    expect(c.labels).toEqual({ "jen.runtime": "jen", "jen.workspace": id });
    expect(c.spec).toEqual({
      image: "jen-workspace",
      env: [],
      labels: { "jen.runtime": "jen", "jen.workspace": id },
      volume: { name: ws(id), path: "/home/agent" },
      network: "none",
      restart: "unless-stopped",
      sandbox: { user: "agent", tmp: { path: "/tmp", bytes: 512 * 2 ** 20 }, shmBytes: 64 * 2 ** 20, memoryBytes: 2 * 2 ** 30, nanoCpus: 2e9, pids: 512 },
    });
    expect(envOf(container(docker, id)!.env, "JEN_GRANT")).toBe('{"spawn":false,"workspace":true}');
  });

  test("an agent without workspace touches no workspace object", async () => {
    const { docker, runtime, as } = await setup();
    const calls = record(docker);
    const root = await runtime.spawn(null, { spawn: true });
    await runtime.spawn(as(root.id), { spawn: false });
    await runtime.stop(null, root.id);
    await runtime.start(null, root.id);
    await runtime.delete(null, root.id);
    expect(calls.some((c) => c.includes("workspace"))).toBe(false);
    expect(calls.length).toBeGreaterThan(0);
  });

  test("starting starts the workspace first, and stopping removes the agent, then its workspace, deepest first", async () => {
    const { docker, runtime, as } = await setup();
    const root = await runtime.spawn(null, { spawn: true, workspace: true });
    const child = await runtime.spawn(as(root.id), { workspace: true });
    const calls = record(docker);
    await runtime.stop(null, root.id);
    expect(calls.splice(0)).toEqual([
      `removeContainer ${agentName(child.id)}`,
      `removeContainer ${ws(child.id)}`,
      `removeContainer ${agentName(root.id)}`,
      `removeContainer ${ws(root.id)}`,
    ]);
    expect(docker.volumes.has(ws(root.id)) && docker.volumes.has(ws(child.id))).toBe(true);
    await runtime.start(null, root.id);
    expect(calls.splice(0)).toEqual([
      `removeContainer ${agentName(root.id)}`,
      `removeContainer ${ws(root.id)}`,
      `createContainer ${ws(root.id)}`,
      `startContainer ${ws(root.id)}`,
      `createContainer ${agentName(root.id)}`,
      `startContainer ${agentName(root.id)}`,
    ]);
    expect(docker.find(ws(root.id))!.spec!.volume.name).toBe(ws(root.id));
    expect(docker.find(ws(child.id))).toBeUndefined();
  });

  test("deleting removes both containers, then the workspace volume, then the record", async () => {
    const { docker, runtime } = await setup();
    const root = await runtime.spawn(null, { workspace: true });
    const calls = record(docker);
    await runtime.delete(null, root.id);
    expect(calls).toEqual([`removeContainer ${agentName(root.id)}`, `removeContainer ${ws(root.id)}`, `removeVolume ${ws(root.id)}`, `removeVolume ${agentName(root.id)}`]);
    expect(docker.volumes.size).toBe(0);
    expect(docker.containers.size).toBe(1);
  });

  test("an interrupted delete still finds the agent by its record, and repeating it finishes", async () => {
    const { docker, runtime } = await setup();
    const root = await runtime.spawn(null, { workspace: true });
    vi.spyOn(docker, "removeVolume").mockRejectedValueOnce(new DockerError(500, "interrupted"));
    await expect(runtime.delete(null, root.id)).rejects.toThrow("interrupted");
    expect((await runtime.list(null)).map((a) => a.id)).toEqual([root.id]);
    await runtime.delete(null, root.id);
    expect(docker.volumes.size).toBe(0);
  });

  test.each([
    ["creating the workspace volume", "createVolume"],
    ["creating the workspace container", "createContainer"],
    ["starting the workspace container", "startContainer"],
  ] as const)("a spawn that fails %s leaves no container, volume or list entry", async (_step, method) => {
    const { docker, runtime } = await setup();
    const original = (docker[method] as (...args: any[]) => Promise<unknown>).bind(docker);
    vi.spyOn(docker, method).mockImplementation((async (...args: any[]) => {
      if (String(args[0]).includes("workspace")) throw new DockerError(500, "cannot");
      return original(...args);
    }) as any);
    await refused(runtime.spawn(null, { workspace: true }), 500);
    expect(await runtime.list(null)).toEqual([]);
    expect(docker.volumes.size).toBe(0);
    expect(docker.containers.size).toBe(1);
  });

  test("a spawn whose workspace start is lost, or whose agent fails after the workspace started, leaves nothing", async () => {
    for (const fail of ["workspace", "agent"]) {
      const { docker, runtime } = await setup();
      const start = docker.startContainer.bind(docker);
      vi.spyOn(docker, "startContainer").mockImplementation(async (name) => {
        await start(name);
        if (name.includes(fail)) throw new Error("socket hang up");
      });
      await refused(runtime.spawn(null, { workspace: true }), 500);
      expect(await runtime.list(null)).toEqual([]);
      expect(docker.volumes.size).toBe(0);
      expect(docker.containers.size).toBe(1);
    }
  });

  test("a start whose workspace fails leaves the agent stopped, with no workspace running", async () => {
    const { docker, runtime } = await setup();
    const root = await runtime.spawn(null, { workspace: true });
    await runtime.stop(null, root.id);
    vi.spyOn(docker, "startContainer").mockRejectedValueOnce(new DockerError(500, "cannot start"));
    await refused(runtime.start(null, root.id), 500);
    expect(docker.find(ws(root.id))).toBeUndefined();
    expect(docker.find(agentName(root.id))).toBeUndefined();
    expect(docker.volumes.has(ws(root.id))).toBe(true);
    expect((await runtime.get(null, root.id)).state).toBe("stopped");
  });

  test("an exhausted root and an exhausted child each lose their workspace container and keep its volume", async () => {
    const { docker, runtime, as, sent } = await setup();
    runtime.watch();
    const root = await runtime.spawn(null, { spawn: true, workspace: true });
    const child = await runtime.spawn(as(root.id), { workspace: true });
    docker.exit(agentName(root.id), { restart: false });
    await vi.waitFor(() => expect(docker.find(ws(root.id))).toBeUndefined());
    expect(sent).toEqual([]);
    // The root is started again for the report, with a workspace.
    docker.exit(agentName(child.id), { restart: false });
    await vi.waitFor(() => expect(sent).toHaveLength(2));
    expect(docker.find(ws(child.id))).toBeUndefined();
    expect(docker.find(ws(root.id))!.state).toBe("running");
    expect(docker.volumes.has(ws(root.id)) && docker.volumes.has(ws(child.id))).toBe(true);
  });

  test("a crash the engine restarts leaves the agent's workspace running", async () => {
    const { docker, runtime, as } = await setup();
    runtime.watch();
    const root = await runtime.spawn(null, { spawn: true, workspace: true });
    const child = await runtime.spawn(as(root.id), { workspace: true });
    const before = [root.id, child.id].map((id) => docker.find(ws(id))!.id);
    docker.exit(agentName(root.id), { restart: true });
    docker.exit(agentName(child.id), { restart: true });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect([root.id, child.id].map((id) => docker.find(ws(id))?.id)).toEqual(before);
    expect([root.id, child.id].map((id) => docker.find(ws(id))!.state)).toEqual(["running", "running"]);
  });

  test("a workspace container's exit sends nothing and changes no state", async () => {
    const { docker, runtime, as, sent } = await setup();
    runtime.watch();
    const root = await runtime.spawn(null, { spawn: true, workspace: true });
    const child = await runtime.spawn(as(root.id), { workspace: true });
    docker.exit(ws(child.id), { restart: false });
    docker.exit(ws(child.id), { restart: true });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(sent).toEqual([]);
    expect((await runtime.get(null, child.id)).state).toBe("running");
    expect((await runtime.get(null, root.id)).state).toBe("running");
  });

  test("startup removes workspaces left behind, and keeps a running agent's", async () => {
    const docker = new FakeDocker();
    const self = docker.add({ name: "eager_turing" });
    const runtime = new Runtime({ docker, name: "jen", image: "jen", workspaceImage: "jen-workspace", model, maxDepth: 3, maxAgents: 10, ready: async () => {} });
    const labels = (id: string) => ({ "jen.runtime": "jen", "jen.workspace": id });
    const agentVolume = (id: string) =>
      docker.volumes.set(agentName(id), { name: agentName(id), labels: { "jen.runtime": "jen", "jen.agent": id, "jen.parent": "", "jen.grant": '{"spawn":false,"workspace":true}' } });
    const workspace = (id: string, state = "running") => {
      docker.volumes.set(ws(id), { name: ws(id), labels: labels(id) });
      return docker.add({ name: ws(id), state, labels: labels(id), volume: ws(id) });
    };
    // Running, with its workspace.
    agentVolume("aaaaaaaaaaaa");
    docker.add({ name: agentName("aaaaaaaaaaaa"), labels: { "jen.runtime": "jen", "jen.agent": "aaaaaaaaaaaa", "jen.credential": "x" }, volume: agentName("aaaaaaaaaaaa") });
    const kept = workspace("aaaaaaaaaaaa");
    // Stopped, with its workspace container left running.
    agentVolume("bbbbbbbbbbbb");
    const stopped = workspace("bbbbbbbbbbbb");
    // Gone, with its workspace volume and container left.
    const orphan = workspace("cccccccccccc", "exited");
    await runtime.startup(self.id);
    expect(docker.containers.has(kept.id)).toBe(true);
    expect(docker.volumes.has(ws("aaaaaaaaaaaa"))).toBe(true);
    expect(docker.containers.has(stopped.id)).toBe(false);
    expect(docker.volumes.has(ws("bbbbbbbbbbbb"))).toBe(true);
    expect(docker.containers.has(orphan.id)).toBe(false);
    expect(docker.volumes.has(ws("cccccccccccc"))).toBe(false);
    expect((await runtime.list(null)).map((a) => [a.id, a.state])).toEqual([
      ["aaaaaaaaaaaa", "running"],
      ["bbbbbbbbbbbb", "stopped"],
    ]);
  });
});

describe("running a command", () => {
  // A runtime with a root agent that has a workspace. Each command exec is
  // driven by run, and each kill is recorded by what it kills.
  async function workspace() {
    const s = await setup();
    const agent = await s.runtime.spawn(null, { workspace: true });
    const kills: string[][] = [];
    const script = { run: (exec: FakeExec) => exec.end() };
    s.docker.onExec = (exec) => {
      if (exec.spec.cmd[0] === "kill") {
        kills.push(exec.spec.cmd.slice(3));
        return exec.end();
      }
      script.run(exec);
    };
    const commands = () => s.docker.execs.filter((e) => e.spec.cmd[0] === "bash");
    return { ...s, agent, caller: s.as(agent.id), kills, script, commands };
  }
  const never = new AbortController().signal;
  // The wrapper's first line, as the wrapper with PID 7 prints it for a
  // command in process group 15.
  const head = (exec: FakeExec) => exec.write("7 15\n");
  const report = (exec: FakeExec, exitCode: number, output: string | Buffer, size = Buffer.byteLength(output)) => {
    exec.write(`${exitCode} ${size}\n`);
    exec.write(output);
  };

  test("the command is the wrapper's argument, never spliced into it, and runs as agent in its home", async () => {
    const { runtime, caller, script, commands } = await workspace();
    script.run = (exec) => (head(exec), report(exec, 0, ""));
    const command = `echo "$HOME" '; rm -rf ~' \\ $(id)`;
    await runtime.runCommand(caller, command, 120, never);
    const [exec] = commands();
    expect(exec!.container).toMatch(/^jen-workspace-[0-9a-f]{12}$/);
    expect(exec!.spec).toEqual({ user: "agent", workdir: "/home/agent", cmd: ["bash", "-c", expect.any(String), "jen", command, expect.stringMatching(/^\/home\/agent\/\.jen\/output\/[0-9a-f]{16}\.log$/)] });
    expect(exec!.spec.cmd[2]).not.toContain(command);
    expect(exec!.spec.cmd[2]).toContain('exec bash -c "$1"');
  });

  test("answers with the exit code and output once the report parses, then closes the stream", async () => {
    const { runtime, caller, script, kills, commands } = await workspace();
    // The stream stays open, as when a background process holds it.
    script.run = (exec) => (head(exec), report(exec, 3, "hi\nerr\n"), exec.write("more from the background"));
    expect(await runtime.runCommand(caller, "echo hi; echo err >&2; exit 3", 120, never)).toEqual({ exitCode: 3, output: "hi\nerr\n", timedOut: false });
    expect(commands()[0]!.stopped).toBe("aborted");
    expect(kills).toEqual([]);
  });

  test("a report that arrives in pieces is read whole", async () => {
    const { runtime, caller, script } = await workspace();
    script.run = (exec) => {
      for (const piece of ["7", " 1", "5\n0 ", "1", "1\nhello", " world"]) setTimeout(() => exec.write(piece), 1);
    };
    expect(await runtime.runCommand(caller, "echo hello world", 120, never)).toEqual({ exitCode: 0, output: "hello world", timedOut: false });
  });

  test("long output comes back as its start and end, with the size and the file that holds it", async () => {
    const { runtime, caller, script, commands } = await workspace();
    script.run = (exec) => (head(exec), report(exec, 0, "a".repeat(2048) + "b".repeat(6144), 100_000));
    const result = await runtime.runCommand(caller, "seq 100000", 120, never);
    expect(result).toEqual({ exitCode: 0, output: "a".repeat(2048) + "b".repeat(6144), timedOut: false, cut: { bytes: 100_000, file: commands()[0]!.spec.cmd[5] } });
  });

  test("a character split by the cut decodes as a replacement character", async () => {
    const { runtime, caller, script } = await workspace();
    const start = Buffer.concat([Buffer.alloc(2047, "a"), Buffer.from("é").subarray(0, 1)]);
    script.run = (exec) => (head(exec), report(exec, 0, Buffer.concat([start, Buffer.alloc(6144, "b")]), 9000));
    expect((await runtime.runCommand(caller, "x", 120, never)).output).toBe("a".repeat(2047) + "\ufffd" + "b".repeat(6144));
  });

  test("a report forged after the first line is answered as given, and kills nothing", async () => {
    const { runtime, caller, script, kills } = await workspace();
    script.run = (exec) => (head(exec), report(exec, 0, "all good"));
    expect(await runtime.runCommand(caller, "printf '0 8\\nall good' > /proc/$PPID/fd/1; sleep 100", 120, never)).toEqual({ exitCode: 0, output: "all good", timedOut: false });
    expect(kills).toEqual([]);
  });

  test("a malformed report gets 502 and kills the command's group", async () => {
    const { runtime, caller, script, kills } = await workspace();
    script.run = (exec) => (head(exec), exec.write("garbage\n"));
    const error = await refused(runtime.runCommand(caller, "x", 120, never), 502);
    expect(error.message).toContain("wrote around its output file");
    expect(kills).toEqual([["-15"]]);
  });

  test("a flood written around the output file closes the stream, kills the group, and gets 502 at once", async () => {
    for (const flood of ["1 " + "9".repeat(20_000), "x".repeat(1 << 20)]) {
      const { runtime, caller, script, kills, commands } = await workspace();
      script.run = (exec) => (head(exec), exec.write(flood));
      await refused(runtime.runCommand(caller, "x", 120, never), 502);
      expect(commands()[0]!.stopped).toBeDefined();
      expect(kills).toEqual([["-15"]]);
    }
  });

  test("the runtime reads no more than its bound, whatever the stream holds", async () => {
    const { docker, runtime, caller, script } = await workspace();
    const exec = vi.spyOn(docker, "exec");
    script.run = (e) => head(e);
    const abort = new AbortController();
    const running = runtime.runCommand(caller, "x", 120, abort.signal).catch(() => {});
    await vi.waitFor(() => expect(exec).toHaveBeenCalled());
    expect(exec.mock.calls[0]![2].bound).toBe(16 * 1024);
    abort.abort();
    await running;
  });

  test("a stream that ends without a report gets 502 while the workspace runs, and 409 once it's gone", async () => {
    const { docker, runtime, caller, script, agent, kills } = await workspace();
    script.run = (exec) => (head(exec), exec.end());
    await refused(runtime.runCommand(caller, "x", 120, never), 502);
    expect(kills).toEqual([["-15"]]);
    script.run = (exec) => head(exec);
    const running = runtime.runCommand(caller, "sleep 100", 120, never);
    await vi.waitFor(() => expect(docker.execs.filter((e) => e.spec.cmd[0] === "bash")).toHaveLength(2));
    await runtime.stop(null, agent.id);
    const error = await refused(running, 409);
    expect(error.message).toBe("the workspace stopped during the command");
  });

  test("a workspace that restarts during the command gets 409", async () => {
    const { docker, runtime, caller, script, agent } = await workspace();
    script.run = (exec) => head(exec);
    const running = runtime.runCommand(caller, "sleep 100", 120, never);
    await vi.waitFor(() => expect(docker.execs.some((e) => e.spec.cmd[0] === "bash")).toBe(true));
    docker.exit(`jen-workspace-${agent.id}`, { restart: true });
    docker.restarted(`jen-workspace-${agent.id}`);
    await refused(running, 409);
  });

  test("a stopped agent's workspace isn't reachable, and a running agent's missing workspace gets 409", async () => {
    const { docker, runtime, caller, agent } = await workspace();
    await docker.removeContainer(`jen-workspace-${agent.id}`);
    await refused(runtime.runCommand(caller, "x", 120, never), 409);
    await runtime.stop(null, agent.id);
    await refused(runtime.runCommand(caller, "x", 120, never), 401);
  });

  test("the owner gets 404, an agent without workspace 403, and a timeout out of range 400, and nothing runs", async () => {
    const { docker, runtime, caller } = await workspace();
    const plain = await runtime.spawn(null, { spawn: true });
    const as = (id: string) => ({ id, credential: sha256(tokenOf(docker, id)) });
    await refused(runtime.runCommand(null, "x", 120, never), 404);
    await refused(runtime.runCommand(as(plain.id), "x", 120, never), 403);
    await refused(runtime.runCommand(caller, "x", 601, never), 400);
    await refused(runtime.runCommand(caller, "x", 0, never), 400);
    expect(docker.execs).toEqual([]);
  });

  test("a command doesn't hold the tree queue", async () => {
    const { runtime, caller, script } = await workspace();
    script.run = (exec) => head(exec);
    const abort = new AbortController();
    const running = runtime.runCommand(caller, "sleep 100", 120, abort.signal).catch((e) => e);
    expect((await runtime.spawn(null, { spawn: false })).state).toBe("running");
    abort.abort();
    await running;
  });

  test("a caller that hangs up kills the command's group", async () => {
    const { runtime, caller, script, kills } = await workspace();
    script.run = (exec) => head(exec);
    const abort = new AbortController();
    const running = runtime.runCommand(caller, "sleep 100", 120, abort.signal);
    await vi.waitFor(() => expect(kills).toEqual([]));
    await new Promise((resolve) => setTimeout(resolve, 5));
    abort.abort();
    await refused(running, 499);
    expect(kills).toEqual([["-15"]]);
  });

  test("a caller that hangs up before the first line kills the group once the line comes", async () => {
    const { runtime, caller, script, kills } = await workspace();
    let started!: FakeExec;
    script.run = (exec) => (started = exec);
    const abort = new AbortController();
    const running = runtime.runCommand(caller, "sleep 100", 120, abort.signal);
    await vi.waitFor(() => expect(started).toBeDefined());
    abort.abort();
    head(started);
    await refused(running, 499);
    expect(kills).toEqual([["-15"]]);
  });

  describe("the deadline", () => {
    afterEach(() => vi.useRealTimers());

    test("at the timeout the group is killed, and the report that follows is answered as timed out", async () => {
      vi.useFakeTimers();
      const { runtime, caller, script, kills } = await workspace();
      let command!: FakeExec;
      script.run = (exec) => ((command = exec), head(exec));
      let result: CommandResult | undefined;
      void runtime.runCommand(caller, "sleep 100", 2, never).then((r) => (result = r));
      await vi.advanceTimersByTimeAsync(1_999);
      expect(kills).toEqual([]);
      await vi.advanceTimersByTimeAsync(1);
      expect(kills).toEqual([["-15"]]);
      report(command, 137, "partial");
      await vi.advanceTimersByTimeAsync(0);
      expect(result).toEqual({ exitCode: null, output: "partial", timedOut: true });
    });

    test("a first line that comes after the timeout gets its group killed, during the grace or after the answer", async () => {
      for (const late of [1_000, 6_000]) {
        vi.useFakeTimers();
        const { runtime, caller, script, kills } = await workspace();
        let command!: FakeExec;
        script.run = (exec) => (command = exec);
        let result: CommandResult | undefined;
        void runtime.runCommand(caller, "sleep 100", 1, never).then((r) => (result = r));
        await vi.advanceTimersByTimeAsync(late);
        head(command);
        await vi.advanceTimersByTimeAsync(6_000 - late);
        expect(result).toEqual({ exitCode: null, output: "", timedOut: true });
        expect(kills[0]).toEqual(late < 6_000 ? ["-15"] : ["-15", "7"]);
        await vi.advanceTimersByTimeAsync(5_000);
        expect(command.stopped).toBe("aborted");
        vi.useRealTimers();
      }
    });

    test("a first line that comes after a hang-up's grace still gets its group killed", async () => {
      vi.useFakeTimers();
      const { runtime, caller, script, kills } = await workspace();
      let command!: FakeExec;
      script.run = (exec) => (command = exec);
      const abort = new AbortController();
      const running = runtime.runCommand(caller, "sleep 100", 120, abort.signal).catch((e) => e);
      await vi.advanceTimersByTimeAsync(10);
      abort.abort();
      await vi.advanceTimersByTimeAsync(5_000);
      expect((await running).status).toBe(499);
      head(command);
      await vi.advanceTimersByTimeAsync(0);
      expect(kills).toEqual([["-15", "7"]]);
    });

    test("a first line that never comes stops being awaited after a second grace", async () => {
      vi.useFakeTimers();
      const { runtime, caller, script } = await workspace();
      let command!: FakeExec;
      script.run = (exec) => (command = exec);
      void runtime.runCommand(caller, "sleep 100", 1, never);
      await vi.advanceTimersByTimeAsync(6_000);
      expect(command.stopped).toBeUndefined();
      await vi.advanceTimersByTimeAsync(5_000);
      expect(command.stopped).toBe("aborted");
    });

    test("a stream that never ends with a wrapper that never reports is answered by its timeout plus 5 seconds", async () => {
      vi.useFakeTimers();
      const { runtime, caller, script, kills, commands } = await workspace();
      script.run = (exec) => head(exec);
      let result: CommandResult | undefined;
      void runtime.runCommand(caller, "kill -STOP $PPID; sleep 100", 1, never).then((r) => (result = r));
      await vi.advanceTimersByTimeAsync(5_999);
      expect(result).toBeUndefined();
      await vi.advanceTimersByTimeAsync(1);
      expect(result).toEqual({ exitCode: null, output: "", timedOut: true });
      expect(kills).toEqual([["-15"], ["7"]]);
      expect(commands()[0]!.stopped).toBe("aborted");
    });
  });
});

describe("reading and writing a file", () => {
  // A runtime with a root agent that has a workspace. Each file exec is
  // driven by script.run.
  async function workspace() {
    const s = await setup();
    const agent = await s.runtime.spawn(null, { workspace: true });
    const script = { run: (exec: FakeExec) => exec.end() };
    s.docker.onExec = (exec) => script.run(exec);
    return { ...s, agent, caller: s.as(agent.id), script };
  }
  const never = new AbortController().signal;
  const bytes = Buffer.from(Array.from({ length: 256 }, (_, i) => i));

  test("a read runs the read script as agent in its home, with the path and the bound as arguments, never spliced in", async () => {
    const { docker, runtime, caller, script } = await workspace();
    script.run = (exec) => (exec.write("ok 0\n"), exec.end());
    const path = `notes/"$HOME" '; rm -rf ~'.md`;
    await runtime.readFile(caller, path, never);
    const [exec] = docker.execs;
    expect(exec!.container).toMatch(/^jen-workspace-[0-9a-f]{12}$/);
    expect(exec!.spec).toEqual({ user: "agent", workdir: "/home/agent", cmd: ["bash", "-c", READ_SCRIPT, "jen", path, String(MAX_FILE)] });
    expect(exec!.input).toBeUndefined();
    expect(READ_SCRIPT).not.toContain(path);
  });

  test("a write runs the write script with the path and the size as arguments, and sends the bytes as input", async () => {
    const { docker, runtime, caller, script } = await workspace();
    script.run = (exec) => (exec.write("ok\n"), exec.end());
    await runtime.writeFile(caller, "data/bytes.bin", bytes, never);
    const [exec] = docker.execs;
    expect(exec!.spec).toEqual({ user: "agent", workdir: "/home/agent", cmd: ["bash", "-c", WRITE_SCRIPT, "jen", "data/bytes.bin", "256"] });
    expect(exec!.input).toEqual(bytes);
  });

  test("a read answers with exactly the bytes reported, across chunks", async () => {
    const { runtime, caller, script } = await workspace();
    script.run = (exec) => {
      const stream = Buffer.concat([Buffer.from("ok 256\n"), bytes]);
      const cuts = [0, 3, 9, 100, stream.length];
      for (let i = 1; i < cuts.length; i++) setTimeout(() => exec.write(stream.subarray(cuts[i - 1], cuts[i])), 1);
      setTimeout(() => exec.end(), 5);
    };
    expect(await runtime.readFile(caller, "data/bytes.bin", never)).toEqual(bytes);
  });

  test("an empty file reads as no bytes", async () => {
    const { runtime, caller, script } = await workspace();
    script.run = (exec) => (exec.write("ok 0\n"), exec.end());
    expect(await runtime.readFile(caller, "empty", never)).toEqual(Buffer.alloc(0));
  });

  test("missing is 404, large 413, and error 400 with the workspace's message", async () => {
    const { runtime, caller, script } = await workspace();
    script.run = (exec) => (exec.write("missing\n"), exec.end());
    expect((await refused(runtime.readFile(caller, "notes/release.md", never), 404)).message).toBe("no file at notes/release.md");
    script.run = (exec) => (exec.write(`large ${17 * 2 ** 20}\n`), exec.end());
    expect((await refused(runtime.readFile(caller, "big.bin", never), 413)).message).toContain(String(17 * 2 ** 20));
    script.run = (exec) => (exec.write("error Is a directory\n"), exec.end());
    expect((await refused(runtime.readFile(caller, "/home/agent", never), 400)).message).toBe("Is a directory");
    script.run = (exec) => (exec.write("error Read-only file system\n"), exec.end());
    expect((await refused(runtime.writeFile(caller, "/etc/jen-probe", bytes, never), 400)).message).toBe("Read-only file system");
  });

  test("a write answers once its status is ok, and closes the stream", async () => {
    const { docker, runtime, caller, script } = await workspace();
    script.run = (exec) => exec.write("ok\n");
    await runtime.writeFile(caller, "a.txt", bytes, never);
    expect(docker.execs[0]!.stopped).toBe("aborted");
  });

  test("a status line that doesn't parse gets 502", async () => {
    for (const line of ["garbage\n", "ok\n", "ok -1\n", `ok ${MAX_FILE + 1}\n`, "large\n", "x".repeat(5000)]) {
      const { runtime, caller, script } = await workspace();
      script.run = (exec) => (exec.write(line), exec.end());
      await refused(runtime.readFile(caller, "a", never), 502);
    }
    for (const line of ["ok 3\n", "missing\n", "garbage\n"]) {
      const { runtime, caller, script } = await workspace();
      script.run = (exec) => (exec.write(line), exec.end());
      await refused(runtime.writeFile(caller, "a", bytes, never), 502);
    }
  });

  test("a status line that never ends is refused once it passes 4 KiB, without waiting for the stream", async () => {
    const { docker, runtime, caller, script } = await workspace();
    script.run = (exec) => exec.write("error " + "x".repeat(5000));
    await refused(runtime.readFile(caller, "a", never), 502);
    expect(docker.execs[0]!.stopped).toBe("aborted");
  });

  test("content longer than reported gets 502 at once, and closes the stream", async () => {
    const { docker, runtime, caller, script } = await workspace();
    script.run = (exec) => (exec.write("ok 3\nabc"), exec.write("d"));
    expect((await refused(runtime.readFile(caller, "a", never), 502)).message).toContain("more than");
    expect(docker.execs[0]!.stopped).toBe("aborted");
  });

  test("content shorter than reported gets 502 while the workspace runs", async () => {
    const { runtime, caller, script } = await workspace();
    script.run = (exec) => (exec.write("ok 10\nabc"), exec.end());
    expect((await refused(runtime.readFile(caller, "a", never), 502)).message).toContain("3 bytes of the 10-byte file");
  });

  test("the runtime reads no more than the file bound plus 64 KiB", async () => {
    const { docker, runtime, caller, script } = await workspace();
    const exec = vi.spyOn(docker, "exec");
    script.run = (e) => (e.write("ok 0\n"), e.end());
    await runtime.readFile(caller, "a", never);
    expect(exec.mock.calls[0]![2].bound).toBe(MAX_FILE + 64 * 1024);
    script.run = (e) => e.write(Buffer.alloc(MAX_FILE + 64 * 1024 + 1));
    await refused(runtime.readFile(caller, "a", never), 502);
  });

  test("a write over 16 MiB gets 413 and nothing runs", async () => {
    const { docker, runtime, caller } = await workspace();
    await refused(runtime.writeFile(caller, "big", Buffer.alloc(MAX_FILE + 1), never), 413);
    expect(docker.execs).toEqual([]);
  });

  test("a workspace that stops during the call gets 409, and one that isn't running gets 409", async () => {
    const { docker, runtime, caller, script, agent } = await workspace();
    script.run = () => {};
    const reading = runtime.readFile(caller, "a", never);
    const writing = runtime.writeFile(caller, "a", bytes, never);
    await vi.waitFor(() => expect(docker.execs).toHaveLength(2));
    docker.exit(`jen-workspace-${agent.id}`, { restart: true });
    docker.restarted(`jen-workspace-${agent.id}`);
    expect((await refused(reading, 409)).message).toBe("the workspace stopped during the read");
    expect((await refused(writing, 409)).message).toBe("the workspace stopped during the write");
    await docker.removeContainer(`jen-workspace-${agent.id}`);
    expect((await refused(runtime.readFile(caller, "a", never), 409)).message).toBe("the workspace isn't running");
  });

  test("an exec the engine refuses because the workspace is gone gets 409", async () => {
    const { docker, runtime, caller } = await workspace();
    vi.spyOn(docker, "exec").mockRejectedValue(new DockerError(409, "container is not running"));
    expect((await refused(runtime.writeFile(caller, "a", bytes, never), 409)).message).toBe("the workspace isn't running");
  });

  test("the owner gets 404 and an agent without workspace 403, and nothing runs", async () => {
    const { docker, runtime, as } = await workspace();
    const plain = await runtime.spawn(null, { spawn: true });
    await refused(runtime.readFile(null, "a", never), 404);
    await refused(runtime.writeFile(null, "a", bytes, never), 404);
    await refused(runtime.readFile(as(plain.id), "a", never), 403);
    await refused(runtime.writeFile(as(plain.id), "a", bytes, never), 403);
    expect(docker.execs).toEqual([]);
  });

  test("a caller that hangs up gets 499, and the stream closes", async () => {
    const { docker, runtime, caller, script } = await workspace();
    script.run = () => {};
    const abort = new AbortController();
    const writing = runtime.writeFile(caller, "a", bytes, abort.signal);
    await vi.waitFor(() => expect(docker.execs).toHaveLength(1));
    abort.abort();
    await refused(writing, 499);
    expect(docker.execs[0]!.stopped).toBe("aborted");
  });

  describe("the deadline", () => {
    afterEach(() => vi.useRealTimers());

    test("a stream that never ends is answered 502 at 30 seconds, and closed", async () => {
      vi.useFakeTimers();
      const { docker, runtime, caller, script } = await workspace();
      script.run = (exec) => exec.write("ok 10\nabc");
      let error: RuntimeError | undefined;
      void runtime.readFile(caller, "a", never).catch((e) => (error = e));
      await vi.advanceTimersByTimeAsync(29_999);
      expect(error).toBeUndefined();
      await vi.advanceTimersByTimeAsync(1);
      expect(error).toMatchObject({ status: 502, message: "the workspace didn't finish the read within 30 seconds" });
      expect(docker.execs[0]!.stopped).toBe("aborted");
    });
  });
});

describe("only a running root with workspace has a page and a UI", () => {
  test("pageTarget gives a running root with workspace's address, and one 404 for anything else, starting nothing", async () => {
    const { docker, runtime, as } = await setup();
    const root = await runtime.spawn(null, { spawn: true, workspace: true });
    expect(await runtime.pageTarget(root.id)).toEqual({ url: `http://jen-agent-${root.id}:8080`, token: tokenOf(docker, root.id) });

    const sub = await runtime.spawn(as(root.id), { spawn: false, workspace: true });
    const bare = await runtime.spawn(null, { spawn: false });
    const stopped = await runtime.spawn(null, { spawn: false, workspace: true });
    await runtime.stop(null, stopped.id);
    const containers = docker.containers.size;
    for (const id of [sub.id, bare.id, stopped.id, "0123456789ab", "owner", "runtime"]) {
      const error = (await runtime.pageTarget(id).catch((e) => e)) as RuntimeError;
      expect(error, id).toBeInstanceOf(RuntimeError);
      expect(error).toMatchObject({ status: 404, message: `no UI for agent ${id}` });
    }
    expect(docker.containers.size).toBe(containers);
    expect((await runtime.get(null, stopped.id)).state).toBe("stopped");
  });

  test("uiTarget needs a caller that reaches the agent, and refuses a sub-agent and a root without workspace with 403", async () => {
    const { docker, runtime, as } = await setup();
    const root = await runtime.spawn(null, { spawn: true, workspace: true });
    const other = await runtime.spawn(null, { spawn: false, workspace: true });
    const sub = await runtime.spawn(as(root.id), { spawn: false, workspace: true });
    const bare = await runtime.spawn(null, { spawn: false });
    expect(await runtime.uiTarget(null, root.id)).toEqual({ url: `http://jen-agent-${root.id}:8080`, token: tokenOf(docker, root.id) });
    await refused(runtime.uiTarget(as(other.id), root.id), 404);
    await refused(runtime.uiTarget(null, sub.id), 403);
    await refused(runtime.uiTarget(as(root.id), sub.id), 403);
    await refused(runtime.uiTarget(null, bare.id), 403);
    await runtime.stop(null, root.id);
    await refused(runtime.uiTarget(null, root.id), 409);
  });
});
