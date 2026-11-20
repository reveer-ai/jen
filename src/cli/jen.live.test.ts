// Runs the jen command against real Docker and a real model, under a runtime
// name and image tags of its own, so it touches nothing of the user's jen. It
// sets the settings with jen config, creates a root, gets a reply and a tool
// call's progress line, opens the UI with no browser and fetches its page,
// lists, stops the root, stops everything and uninstalls, then finds nothing
// of its runtime left. jen config and jen uninstall ask in a terminal, so they
// run in-process with a scripted one; every other command runs as the real
// jen. Skipped when the key or model is missing; with them set, a missing
// Docker fails the check.

import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { expect, test } from "vitest";
import { createDocker, runProcess } from "./docker.ts";
import { fakeTerminal } from "./harness.ts";
import { parse, run, type Deps } from "./main.ts";

const apiKey = process.env.JEN_LIVE_API_KEY;
const model = process.env.JEN_LIVE_MODEL;
// jen asks for a base URL, so OpenAI's is given when none is set.
const baseURL = process.env.JEN_LIVE_BASE_URL || "https://api.openai.com/v1";
const main = join(import.meta.dirname, "main.ts");
const checkout = join(import.meta.dirname, "../..");

test.skipIf(!apiKey || !model)("jen creates, talks to, opens, lists, stops and uninstalls a root", { timeout: 900_000 }, async () => {
  const tag = `live-${randomBytes(4).toString("hex")}`;
  const name = `jen-${tag}`;
  const images = { runtime: `jen-runtime:${tag}`, agent: `jen-agent:${tag}`, workspace: `jen-workspace:${tag}` };
  for (const [target, image] of Object.entries(images)) {
    docker(["build", "-q", "--target", target, "-t", `jen-${target}`, checkout], 300_000);
    docker(["tag", `jen-${target}`, image]);
  }
  const env: NodeJS.ProcessEnv = { ...process.env, JEN_RUNTIME_NAME: name, JEN_RUNTIME_IMAGE: images.runtime, JEN_AGENT_IMAGE: images.agent, JEN_WORKSPACE_IMAGE: images.workspace };
  // No browser is opened: on Linux there's no display, and on macOS, where
  // open would launch one, the opener fails, which leaves the printed URL too.
  delete env.DISPLAY;
  delete env.WAYLAND_DISPLAY;
  if (process.platform === "darwin") env.BROWSER = "false";
  else delete env.BROWSER;

  // jen as the user runs it.
  const jen = (args: string[], timeoutMs = 300_000) =>
    new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
      const child = spawn(process.execPath, [main, ...args], { env, stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      child.stdout.setEncoding("utf8").on("data", (c: string) => (stdout += c));
      child.stderr.setEncoding("utf8").on("data", (c: string) => (stderr += c));
      const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
      child.on("close", (code) => {
        clearTimeout(timer);
        resolve({ code, stdout, stderr });
      });
    });
  // jen in-process, answering its questions from answers.
  const scripted = async (args: string[], answers: string[]) => {
    const out: string[] = [];
    const err: string[] = [];
    const deps: Deps = {
      docker: createDocker(),
      env,
      terminal: fakeTerminal(answers).terminal,
      stdout: (t) => out.push(t),
      stderr: (t) => err.push(t),
      fetch: globalThis.fetch,
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      now: Date.now,
      columns: 120,
      interrupt: new AbortController().signal,
      mainPath: main,
      npm: runProcess,
    };
    return { code: await run(parse(args), deps), stdout: out.join(""), stderr: err.join("") };
  };
  const left = () => ({
    containers: docker(["ps", "-aq", "--filter", `label=jen.runtime=${name}`]).trim() + docker(["ps", "-aq", "--filter", `name=^${name}-runtime$`]).trim(),
    volumes: docker(["volume", "ls", "-q", "--filter", `label=jen.runtime=${name}`]).trim(),
    network: docker(["network", "ls", "-q", "--filter", `name=^${name}$`]).trim(),
    images: Object.values(images).filter((image) => spawnSync("docker", ["image", "inspect", image], { timeout: 30_000 }).status === 0),
  });

  try {
    const configured = await scripted(["config"], [model!, baseURL, apiKey!]);
    expect(configured, configured.stderr).toMatchObject({ code: 0 });
    expect(docker(["volume", "inspect", "-f", "{{json .Labels}}", `${name}-settings`]).trim()).toBe(JSON.stringify({ "jen.runtime": name, "jen.settings": "" }));

    const created = await jen(["new", "live"]);
    expect(created, created.stderr).toMatchObject({ code: 0, stdout: "created @live. Talk to it with: jen @live <query>\n" });
    expect((await jen(["new", "live"])).code).toBe(1);

    const heron = await jen(["@live", "Reply with just the word heron."]);
    expect(heron.code, heron.stderr).toBe(0);
    expect(heron.stdout.endsWith("\n")).toBe(true);
    expect(heron.stdout.trim().toLowerCase().replace(/[.!*"]/g, "")).toBe("heron");
    // The runtime keeps running after the reply.
    expect(docker(["inspect", "-f", "{{.State.Status}}", `${name}-runtime`]).trim()).toBe("running");

    const command = await jen(["@live", "Use run_command to run `uname -s` in your workspace, then reply with just its output."]);
    expect(command.code, command.stderr).toBe(0);
    expect(command.stderr).toMatch(/^→ run_command /m);
    expect(command.stdout).toMatch(/linux/i);
    // Nothing of the first query's turn is written again.
    expect(command.stdout).not.toMatch(/heron/i);

    const opened = await jen(["@live", "open"]);
    expect(opened.code, opened.stderr).toBe(0);
    const url = opened.stdout.trim();
    expect(url).toMatch(new RegExp(`^http://127\\.0\\.0\\.1:\\d+/agents/[0-9a-f]{12}/page#token=[0-9a-f]{64}$`));
    const page = await fetch(url.split("#")[0]!);
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toMatch(/^text\/html/);

    expect(await jen(["list"])).toMatchObject({ code: 0, stdout: "@live  running\n" });
    expect(await jen(["stop", "@live"])).toMatchObject({ code: 0 });
    expect(await jen(["list"])).toMatchObject({ code: 0, stdout: "@live  stopped\n" });

    const port = docker(["port", `${name}-runtime`, "8080/tcp"]).trim();
    expect(await jen(["stop", "all"])).toMatchObject({ code: 0 });
    expect(left().containers).toBe("");
    expect(left().volumes).not.toBe("");
    // The next command starts the runtime again, on the port it had.
    expect(await jen(["list"])).toMatchObject({ code: 0, stdout: "@live  stopped\n" });
    expect(docker(["port", `${name}-runtime`, "8080/tcp"]).trim()).toBe(port);
    expect(await jen(["stop", "all"])).toMatchObject({ code: 0 });
    expect(await jen(["stop", "all"])).toMatchObject({ code: 0, stdout: "nothing of jen's is running.\n" });

    const uninstalled = await scripted(["uninstall"], ["y"]);
    expect(uninstalled.code, uninstalled.stderr).toBe(0);
    expect(uninstalled.stdout).toMatch(/^removed 1 agent with/);
    expect(uninstalled.stdout).toMatch(/wasn't installed with npm install -g/);
    expect(left()).toEqual({ containers: "", volumes: "", network: "", images: [] });
  } finally {
    const quiet = (args: string[]) => spawnSync("docker", args, { encoding: "utf8", timeout: 60_000 });
    const ids = (args: string[]) => quiet(args).stdout.split("\n").filter(Boolean);
    const containers = ids(["ps", "-aq", "--filter", `label=jen.runtime=${name}`]);
    quiet(["rm", "-f", `${name}-runtime`, ...containers]);
    const volumes = ids(["volume", "ls", "-q", "--filter", `label=jen.runtime=${name}`]);
    if (volumes.length > 0) quiet(["volume", "rm", ...volumes]);
    quiet(["network", "rm", name]);
    quiet(["image", "rm", ...Object.values(images)]);
  }
});

function docker(args: string[], timeout = 60_000): string {
  const result = spawnSync("docker", args, { encoding: "utf8", timeout });
  if (result.status !== 0) throw new Error(`docker ${args.join(" ")} failed: ${result.stderr || result.error?.message}`);
  return result.stdout;
}
