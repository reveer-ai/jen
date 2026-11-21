import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import type { Runner } from "./docker.ts";
import { harness } from "./harness.ts";
import { QUESTION, uninstall } from "./uninstall.ts";

let dir: string;
let close: (() => Promise<void>) | undefined;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "jen-uninstall-"));
});
afterEach(async () => {
  await close?.();
  rmSync(dir, { recursive: true, force: true });
});

// A global npm folder in dir, with jen-ai installed in it, and a checkout.
function folders() {
  const root = join(dir, "lib", "node_modules");
  const installed = join(root, "jen-ai", "cli", "main.js");
  const checkout = join(dir, "checkout", "src", "cli", "main.ts");
  for (const file of [installed, checkout]) {
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, "");
  }
  // npm link puts a symlink to the checkout in the global folder.
  symlinkSync(join(dir, "checkout"), join(root, "jen"));
  return { root, installed, linked: join(root, "jen", "src", "cli", "main.ts"), checkout };
}

function stubNpm(root: string) {
  const calls: string[][] = [];
  const npm: Runner = async (_, args) => {
    calls.push(args);
    return { code: 0, stdout: args[0] === "root" ? `${root}\n` : "", stderr: "" };
  };
  return { calls, npm };
}

// jen with two roots, a sub-agent and a workspace, the runtime, its network
// and the settings.
async function populated(answers: string[]) {
  const h = await harness({ answers });
  close = () => h.api.close();
  const { docker } = h;
  docker.add({ name: "jen-runtime", labels: { "jen.runtime": "jen" } });
  for (const id of ["home", "work", "sub"]) {
    docker.add({ name: `jen-agent-${id}`, labels: { "jen.runtime": "jen", "jen.agent": id }, volumes: [`jen-agent-${id}`] });
    docker.volumes_.set(`jen-agent-${id}`, { labels: { "jen.runtime": "jen", "jen.agent": id }, files: new Map() });
  }
  docker.add({ name: "jen-workspace-home", labels: { "jen.runtime": "jen", "jen.workspace": "home" }, volumes: ["jen-workspace-home"] });
  docker.volumes_.set("jen-workspace-home", { labels: { "jen.runtime": "jen", "jen.workspace": "home" }, files: new Map() });
  docker.networks.add("jen");
  // Someone else's, which stays.
  docker.add({ name: "postgres", labels: {}, volumes: ["pgdata"] });
  docker.volumes_.set("pgdata", { labels: {}, files: new Map() });
  docker.images.set("postgres", "sha256:pg");
  return h;
}

test("on y, every container, volume and network of jen's goes, with the settings and the images, and nothing else", async () => {
  const { docker, ctx, asked, out } = await populated(["y"]);
  const { root, checkout } = folders();
  const { npm } = stubNpm(root);
  expect(await uninstall(ctx, { mainPath: checkout, npm })).toBe(0);
  expect(asked).toEqual([{ question: QUESTION, hidden: false }]);
  expect([...docker.containers_.values()].map((c) => c.name)).toEqual(["postgres"]);
  expect([...docker.volumes_.keys()]).toEqual(["pgdata"]);
  expect(docker.networks.size).toBe(0);
  expect([...docker.images.keys()]).toEqual(["postgres"]);
  expect(out[0]).toBe("removed 3 agents with their conversations and files, the runtime, the settings and the images jen-runtime, jen-agent, jen-workspace.");
});

test("the runtime is removed before any agent", async () => {
  const { docker, ctx } = await populated(["y"]);
  const removed: string[] = [];
  docker.onRemove = async (c) => void removed.push(c.name);
  await uninstall(ctx, { mainPath: "/nowhere", npm: stubNpm("/none").npm });
  expect(removed[0]).toBe("jen-runtime");
});

test.each(["n", "", "yes", "Y "])("answering %j removes nothing", async (answer) => {
  const { docker, ctx, out } = await populated([answer]);
  const before = [docker.containers_.size, docker.volumes_.size, docker.images.size];
  expect(await uninstall(ctx, { mainPath: "/nowhere", npm: stubNpm("/none").npm })).toBe(1);
  expect([docker.containers_.size, docker.volumes_.size, docker.images.size]).toEqual(before);
  expect(out).toEqual(["nothing was removed."]);
});

test("without a terminal it fails, removing nothing", async () => {
  const h = await harness({ interactive: false });
  close = () => h.api.close();
  await expect(uninstall(h.ctx, { mainPath: "/nowhere", npm: stubNpm("/none").npm })).rejects.toThrow(/needs a terminal/);
  expect(h.docker.volumes_.size).toBe(1);
});

test("with the runtime's image missing, everything else still goes", async () => {
  const { docker, ctx } = await populated(["y"]);
  docker.images.delete("jen-runtime");
  expect(await uninstall(ctx, { mainPath: "/nowhere", npm: stubNpm("/none").npm })).toBe(0);
  expect([...docker.volumes_.keys()]).toEqual(["pgdata"]);
  expect([...docker.images.keys()]).toEqual(["postgres"]);
});

test("a failure is reported at the end, every other step still runs, and the command is kept to retry with", async () => {
  const { docker, ctx, err } = await populated(["y"]);
  const remove = docker.removeVolume.bind(docker);
  docker.removeVolume = async (name) => {
    if (name === "jen-agent-work") throw new Error("volume is busy");
    return remove(name);
  };
  const { root, installed } = folders();
  const { calls, npm } = stubNpm(root);
  expect(await uninstall(ctx, { mainPath: installed, npm })).toBe(1);
  expect([...docker.volumes_.keys()].sort()).toEqual(["jen-agent-work", "pgdata"]);
  expect([...docker.images.keys()]).toEqual(["postgres"]);
  // A blank line after the answer, then the failure.
  expect(err.slice(0, 2)).toEqual(["", "jen: removing volume jen-agent-work: volume is busy"]);
  expect(calls).toEqual([]);
});

test("installed globally with npm, the jen-ai package is uninstalled too", async () => {
  const { ctx, out } = await populated(["y"]);
  const { root, installed } = folders();
  const { calls, npm } = stubNpm(root);
  expect(await uninstall(ctx, { mainPath: installed, npm })).toBe(0);
  expect(calls).toEqual([["root", "-g"], ["uninstall", "-g", "jen-ai"]]);
  expect(out.at(-1)).toBe("uninstalled the jen-ai package. jen is gone.");
});

test("every version of the registry's images goes, with an earlier version's, and none another image's", async () => {
  const h = await harness({ answers: ["y"], version: "0.1.1" });
  close = () => h.api.close();
  const { docker, ctx, out } = h;
  for (const image of ["runtime:0.1.1", "agent:0.1.1", "workspace:0.1.1", "agent:0.1.0", "workspace:0.1.0"]) docker.build(`ghcr.io/reveer-ai/jen-${image}`);
  docker.build("ghcr.io/reveer-ai/jen-other:0.1.0");
  docker.build("postgres");
  expect(await uninstall(ctx, { mainPath: "/nowhere", npm: stubNpm("/none").npm })).toBe(0);
  expect([...docker.images.keys()].sort()).toEqual(["ghcr.io/reveer-ai/jen-other:0.1.0", "postgres"]);
  expect(out[0]).toMatch(/the images ghcr\.io\/reveer-ai\/jen-runtime:0\.1\.1, .*jen-agent:0\.1\.0/);
});

test("images the environment names are removed by those names, leaving the registry's", async () => {
  const h = await harness({ answers: ["y"], version: "0.1.1", env: { JEN_RUNTIME_IMAGE: "r:t", JEN_AGENT_IMAGE: "a:t", JEN_WORKSPACE_IMAGE: "w:t" } });
  close = () => h.api.close();
  const { docker, ctx } = h;
  for (const image of ["r:t", "a:t", "w:t", "ghcr.io/reveer-ai/jen-agent:0.1.1"]) docker.build(image);
  expect(await uninstall(ctx, { mainPath: "/nowhere", npm: stubNpm("/none").npm })).toBe(0);
  expect([...docker.images.keys()]).toEqual(["ghcr.io/reveer-ai/jen-agent:0.1.1"]);
});

test("run through npm link from a checkout, the checkout is left and jen says how the command remains", async () => {
  const { ctx, out } = await populated(["y"]);
  const { root, linked } = folders();
  const { calls, npm } = stubNpm(root);
  expect(await uninstall(ctx, { mainPath: linked, npm })).toBe(0);
  expect(calls).toEqual([["root", "-g"]]);
  expect(out.at(-1)).toMatch(/wasn't installed with npm install -g.*npm unlink -g jen/);
});
