import { afterEach, describe, expect, test } from "vitest";
import { harness, SETTINGS } from "./harness.ts";
import { config, ensureRuntime, READY_MS, stopAll } from "./runtime.ts";
import { MissingImage, Refusal } from "./settings.ts";

let close: (() => Promise<void>) | undefined;
async function setup(options: Parameters<typeof harness>[0] = {}) {
  const h = await harness(options);
  close = () => h.api.close();
  return h;
}
afterEach(() => close?.());

const runtimeRuns = (docker: Awaited<ReturnType<typeof harness>>["docker"]) => docker.runs.filter((r) => r.args[0] === "-d");

describe("ensureRuntime", () => {
  test.each([
    ["jen-runtime", "runtime"],
    ["jen-agent", "agent"],
    ["jen-workspace", "workspace"],
  ])("a missing %s is named with its docker build command, and nothing is started", async (image, target) => {
    const { docker, ctx } = await setup();
    docker.images.delete(image);
    const error = await ensureRuntime(ctx).catch((e) => e);
    expect(error).toBeInstanceOf(MissingImage);
    expect(error.message).toContain(`docker build --target ${target} -t ${image} .`);
    expect(docker.runs).toEqual([]);
  });

  test("starts the runtime published on 127.0.0.1 with the settings passed by name, and saves the port Docker chose", async () => {
    const { docker, ctx, api } = await setup();
    const client = await ensureRuntime(ctx);
    const [run] = runtimeRuns(docker);
    expect(run!.args).toEqual([
      "-d", "--name", "jen-runtime", "--label", "jen.runtime=jen", "-v", "/var/run/docker.sock:/var/run/docker.sock", "-p", "127.0.0.1::8080",
      "-e", "JEN_OWNER_TOKEN", "-e", "JEN_MODEL", "-e", "JEN_API_KEY", "-e", "JEN_BASE_URL", "-e", "JEN_RUNTIME_NAME", "-e", "JEN_AGENT_IMAGE", "-e", "JEN_WORKSPACE_IMAGE",
      "jen-runtime",
    ]);
    expect(run!.options.secrets).toEqual({ JEN_OWNER_TOKEN: SETTINGS.ownerToken, JEN_API_KEY: SETTINGS.apiKey });
    expect(run!.options.env).toMatchObject({ JEN_MODEL: "gpt-x", JEN_BASE_URL: "", JEN_RUNTIME_NAME: "jen", JEN_AGENT_IMAGE: "jen-agent", JEN_WORKSPACE_IMAGE: "jen-workspace" });
    expect(client.base).toBe(`http://127.0.0.1:${api.port}`);
    expect(docker.settings().port).toBe(api.port);
    expect(docker.find("jen-runtime")!.state).toBe("running");
  });

  test("the runtime is published again on the port it had", async () => {
    const { docker, ctx } = await setup();
    const first = await ensureRuntime(ctx);
    await docker.remove("jen-runtime");
    const second = await ensureRuntime(ctx);
    expect(second.base).toBe(first.base);
    expect(runtimeRuns(docker)[1]!.args).toContain(`127.0.0.1:${new URL(first.base).port}:8080`);
  });

  test("a saved port that's taken is retried once on a port Docker chooses, which is saved", async () => {
    const { docker, ctx, api } = await setup({ settings: { ...SETTINGS, port: 4321 } });
    docker.taken.add(4321);
    await ensureRuntime(ctx);
    expect(runtimeRuns(docker).map((r) => r.args[8])).toEqual(["127.0.0.1:4321:8080", "127.0.0.1::8080"]);
    expect(docker.settings().port).toBe(api.port);
  });

  test("a running runtime is reached with no container started", async () => {
    const { docker, ctx } = await setup();
    await ensureRuntime(ctx);
    const before = docker.runs.length;
    await ensureRuntime(ctx);
    expect(docker.runs.length).toBe(before);
  });

  test("a name conflict means another jen is starting it, and this one waits for it", async () => {
    const { docker, ctx, api } = await setup();
    docker.beforeRuntime = () => {
      // The other jen's runtime, published a moment later.
      const other = docker.add({ name: "jen-runtime", state: "created", env: [`JEN_OWNER_TOKEN=${SETTINGS.ownerToken}`] });
      setTimeout(async () => {
        api.token = SETTINGS.ownerToken;
        other.port = await api.listen();
        other.state = "running";
      }, 50);
      return { code: 125, stdout: "", stderr: 'docker: Error response from daemon: Conflict. The container name "/jen-runtime" is already in use by container "x".' };
    };
    const client = await ensureRuntime(ctx);
    expect(client.base).toBe(`http://127.0.0.1:${api.port}`);
    expect(docker.containers_.size).toBe(1);
  });

  test("a runtime that exits as it starts fails, showing its last lines", async () => {
    const { docker, ctx } = await setup();
    docker.onRuntime = async (container) => {
      container.state = "exited";
      docker.logs_.set("jen-runtime", "jen-runtime: JEN_API_KEY is not set");
      return undefined;
    };
    const error = await ensureRuntime(ctx).catch((e) => e);
    expect(error).toBeInstanceOf(Refusal);
    expect(error.message).toMatch(/exited as it started:\njen-runtime: JEN_API_KEY is not set/);
  });

  test("a runtime that never answers fails after the time a start may take", async () => {
    const { docker, ctx } = await setup();
    docker.onRuntime = async () => 1;
    let now = 0;
    ctx.now = () => (now += READY_MS / 4);
    await expect(ensureRuntime(ctx)).rejects.toThrow(/didn't answer within 15 seconds/);
  });

  test("with no settings and a terminal, it asks, saves them and starts", async () => {
    const { docker, ctx, asked } = await setup({ settings: null, answers: ["gpt-z", "", "sk-z-123456789"] });
    await ensureRuntime(ctx);
    expect(asked).toHaveLength(3);
    expect(docker.settings()).toMatchObject({ model: "gpt-z", apiKey: "sk-z-123456789", ownerToken: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(docker.volumes_.get("jen-settings")!.labels).toEqual({ "jen.runtime": "jen", "jen.settings": "" });
  });

  test("with no settings and no terminal, it fails saying to run jen config, and starts nothing", async () => {
    const { docker, ctx } = await setup({ settings: null, interactive: false });
    await expect(ensureRuntime(ctx)).rejects.toThrow(/Run jen config/);
    expect(runtimeRuns(docker)).toEqual([]);
  });

  test("the runtime's name and images come from the environment, and the agent images are passed on", async () => {
    const env = { JEN_RUNTIME_NAME: "jt", JEN_RUNTIME_IMAGE: "r:t", JEN_AGENT_IMAGE: "a:t", JEN_WORKSPACE_IMAGE: "w:t" };
    const { docker, ctx } = await setup({ env });
    for (const image of ["r:t", "a:t", "w:t"]) docker.build(image);
    await ensureRuntime(ctx);
    const [run] = runtimeRuns(docker);
    expect(run!.args.slice(0, 5)).toEqual(["-d", "--name", "jt-runtime", "--label", "jen.runtime=jt"]);
    expect(run!.args.at(-1)).toBe("r:t");
    expect(run!.options.env).toMatchObject({ JEN_RUNTIME_NAME: "jt", JEN_AGENT_IMAGE: "a:t", JEN_WORKSPACE_IMAGE: "w:t" });
    expect(docker.settings("jt")).toBeDefined();
  });
});

describe("a new image", () => {
  test("a rebuilt agent image stops every running root through the runtime, and says so", async () => {
    const { docker, ctx, api, err } = await setup();
    await ensureRuntime(ctx);
    const home = api.add({ name: "home" });
    const work = api.add({ name: "work" });
    docker.add({ name: `jen-agent-${home.id}`, image: docker.images.get("jen-agent")!, labels: { "jen.runtime": "jen", "jen.agent": home.id } });
    docker.build("jen-agent");
    await ensureRuntime(ctx);
    expect(api.requests.filter((r) => r.includes("/stop")).sort()).toEqual([`POST /agents/${home.id}/stop`, `POST /agents/${work.id}/stop`].sort());
    expect(err.join("\n")).toMatch(/jen-agent changed, so jen stopped every agent\. Each agent starts on the new image at its next message\./);
    // A second command finds nothing stale.
    api.requests.length = 0;
    docker.containers_.delete(docker.find(`jen-agent-${home.id}`)!.id);
    await ensureRuntime(ctx);
    expect(api.requests.filter((r) => r.includes("/stop"))).toEqual([]);
  });

  test("a rebuilt runtime image stops every root before the runtime is removed, then starts it on the new image", async () => {
    const { docker, ctx, api, err } = await setup();
    await ensureRuntime(ctx);
    const home = api.add({ name: "home" });
    const order: string[] = [];
    api.onMessage = () => {};
    const removed = docker.onRemove;
    docker.onRemove = async (c) => {
      order.push(`remove ${c.name}`);
      await removed(c);
    };
    const intercept = api.intercept;
    api.intercept = (method, path) => {
      if (path.endsWith("/stop")) order.push("stop");
      return intercept(method, path);
    };
    const id = docker.build("jen-runtime");
    await ensureRuntime(ctx);
    expect(order).toEqual(["stop", "remove jen-runtime"]);
    expect(docker.find("jen-runtime")!.image).toBe(id);
    expect(api.agents.get(home.id)!.state).toBe("stopped");
    expect(err.join("\n")).toMatch(/jen-runtime changed, so jen stopped every agent and restarted the runtime/);
  });

  test("agents on an old image without a runtime are stopped through one started first", async () => {
    const { docker, ctx, api } = await setup();
    const home = api.add({ name: "home" });
    docker.add({ name: `jen-agent-${home.id}`, image: "sha256:old", labels: { "jen.runtime": "jen", "jen.agent": home.id } });
    await ensureRuntime(ctx);
    expect(api.agents.get(home.id)!.state).toBe("stopped");
    expect(runtimeRuns(docker)).toHaveLength(1);
  });

  test("a stale workspace counts as well", async () => {
    const { docker, ctx, api, err } = await setup();
    const home = api.add({ name: "home" });
    docker.add({ name: `jen-workspace-${home.id}`, image: "sha256:old", labels: { "jen.runtime": "jen", "jen.workspace": home.id } });
    await ensureRuntime(ctx);
    expect(api.agents.get(home.id)!.state).toBe("stopped");
    expect(err.join("\n")).toMatch(/jen-workspace changed/);
  });
});

describe("jen config", () => {
  test("first settings are saved in a labelled volume with an owner token", async () => {
    const { docker, ctx } = await setup({ settings: null, answers: ["gpt-y", "", "sk-y-123456789"] });
    await config(ctx);
    expect(docker.volumes_.get("jen-settings")!.labels).toEqual({ "jen.runtime": "jen", "jen.settings": "" });
    expect(docker.settings()).toEqual({ model: "gpt-y", baseURL: "", apiKey: "sk-y-123456789", ownerToken: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(runtimeRuns(docker)).toEqual([]);
  });

  test("an empty key keeps the key and the token", async () => {
    const { docker, ctx } = await setup({ answers: ["gpt-new", "", ""] });
    await config(ctx);
    expect(docker.settings()).toEqual({ ...SETTINGS, model: "gpt-new" });
  });

  test("without a terminal it fails, and the settings are unchanged", async () => {
    const { docker, ctx } = await setup({ interactive: false });
    await expect(config(ctx)).rejects.toThrow(/needs a terminal/);
    expect(docker.settings()).toEqual(SETTINGS);
    expect(docker.runs).toEqual([]);
  });

  test("without the runtime's image it fails naming it", async () => {
    const { docker, ctx } = await setup({ answers: ["", "", ""] });
    docker.images.delete("jen-runtime");
    await expect(config(ctx)).rejects.toThrow("docker build --target runtime -t jen-runtime .");
  });

  test("a running runtime is replaced with one that has the new settings, and no agent is stopped", async () => {
    const { docker, ctx, api } = await setup({ answers: ["gpt-new", "", ""] });
    await ensureRuntime(ctx);
    const home = api.add({ name: "home" });
    const before = docker.find("jen-runtime")!.id;
    await config(ctx);
    const after = docker.find("jen-runtime")!;
    expect(after.id).not.toBe(before);
    expect(after.env).toContain("JEN_MODEL=gpt-new");
    expect(api.requests.filter((r) => r.includes("/stop"))).toEqual([]);
    expect(api.agents.get(home.id)!.state).toBe("running");
  });
});

describe("jen stop all", () => {
  test("with nothing running, it says so", async () => {
    const { docker, ctx, out } = await setup();
    await stopAll(ctx);
    expect(out).toEqual(["Nothing of jen's is running."]);
    expect(docker.runs).toEqual([]);
  });

  test("stops every root through the runtime, then removes it, keeping every volume", async () => {
    const { docker, ctx, api, out } = await setup();
    await ensureRuntime(ctx);
    api.add({ name: "home" });
    api.add({ name: "work", state: "stopped" });
    docker.volumes_.set("jen-agent-x", { labels: { "jen.runtime": "jen", "jen.agent": "x" }, files: new Map() });
    await stopAll(ctx);
    expect([...api.agents.values()].map((a) => a.state)).toEqual(["stopped", "stopped"]);
    expect(api.requests.filter((r) => r.includes("/stop"))).toHaveLength(1);
    expect(docker.find("jen-runtime")).toBeUndefined();
    expect([...docker.volumes_.keys()].sort()).toEqual(["jen-agent-x", "jen-settings"]);
    expect(out.at(-1)).toBe("Stopped 1 root agent and everything under it, and the runtime. Their conversations and files are kept.");
  });

  test("more than one root stopped is counted as them", async () => {
    const { ctx, api, out } = await setup();
    await ensureRuntime(ctx);
    api.add({ name: "home" });
    api.add({ name: "work" });
    await stopAll(ctx);
    expect(out.at(-1)).toBe("Stopped 2 root agents and everything under them, and the runtime. Their conversations and files are kept.");
  });

  test("agents running without a runtime are stopped through one started for it", async () => {
    const { docker, ctx, api } = await setup();
    const home = api.add({ name: "home" });
    docker.add({ name: `jen-agent-${home.id}`, image: docker.images.get("jen-agent")!, labels: { "jen.runtime": "jen", "jen.agent": home.id } });
    await stopAll(ctx);
    expect(runtimeRuns(docker)).toHaveLength(1);
    expect(api.agents.get(home.id)!.state).toBe("stopped");
    expect(docker.find("jen-runtime")).toBeUndefined();
  });
});
