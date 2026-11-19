import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { harness } from "./harness.ts";
import { parse, run, USAGE, type Deps } from "./main.ts";

test.each([
  [["new", "home"], { kind: "new", name: "home" }],
  [["list"], { kind: "list" }],
  [["stop", "@home"], { kind: "stop", name: "home" }],
  [["stop", "all"], { kind: "stop-all" }],
  [["config"], { kind: "config" }],
  [["uninstall"], { kind: "uninstall" }],
  [["help"], { kind: "help" }],
  [["@home", "open"], { kind: "open", name: "home" }],
  [["@home", "what", "is", "up?"], { kind: "query", name: "home", text: "what is up?" }],
  [["@home", "open", "the", "notes"], { kind: "query", name: "home", text: "open the notes" }],
  [["@home", "Reply with just the word heron."], { kind: "query", name: "home", text: "Reply with just the word heron." }],
])("%j parses as %j", (args, command) => {
  expect(parse(args)).toEqual(command);
});

test.each([[[]], [["start"]], [["new"]], [["new", "a", "b"]], [["list", "x"]], [["stop"]], [["stop", "home"]], [["@home"]], [["@"]], [["help", "me"]]])("%j prints the usage", (args) => {
  expect(parse(args)).toEqual({ kind: "usage" });
});

let close: (() => Promise<void>) | undefined;
afterEach(() => close?.());

async function deps(): Promise<{ deps: Deps; out: string[]; err: string[]; h: Awaited<ReturnType<typeof harness>> }> {
  const h = await harness();
  close = () => h.api.close();
  const out: string[] = [];
  const err: string[] = [];
  return {
    h,
    out,
    err,
    deps: {
      docker: h.docker,
      env: {},
      terminal: h.ctx.terminal,
      stdout: (t) => out.push(t),
      stderr: (t) => err.push(t),
      fetch: globalThis.fetch,
      sleep: h.ctx.sleep,
      now: Date.now,
      columns: 80,
      interrupt: new AbortController().signal,
      mainPath: "/nowhere",
      npm: async () => ({ code: 1, stdout: "", stderr: "" }),
      open: async () => true,
    },
  };
}

test("jen help prints the usage, pointing to jen uninstall, and exits 0 without Docker", async () => {
  const { deps: d, out, h } = await deps();
  h.docker.reachable = false;
  expect(await run({ kind: "help" }, d)).toBe(0);
  expect(out.join("")).toBe(`${USAGE}\n`);
  expect(USAGE).toMatch(/To remove jen, run jen uninstall/);
});

test("jen start prints the usage to stderr and exits 2", async () => {
  const { deps: d, err } = await deps();
  expect(await run(parse(["start"]), d)).toBe(2);
  expect(err.join("")).toBe(`${USAGE}\n`);
});

test("without Docker, every other command fails saying Docker isn't reachable, having changed nothing", async () => {
  const { deps: d, err, h } = await deps();
  h.docker.reachable = false;
  for (const command of [parse(["list"]), parse(["new", "home"]), parse(["config"]), parse(["uninstall"]), parse(["@home", "hi"])]) {
    expect(await run(command, d)).toBe(1);
  }
  expect(err.every((line) => /^jen: Docker isn't reachable/.test(line))).toBe(true);
  expect(h.docker.calls.filter((c) => c !== "ping")).toEqual([]);
});

test("a missing image fails naming it and its docker build command", async () => {
  const { deps: d, err, h } = await deps();
  h.docker.images.delete("jen-workspace");
  expect(await run(parse(["list"]), d)).toBe(1);
  expect(err.join("")).toMatch(/jen-workspace.*docker build --target workspace -t jen-workspace \./);
});

test("a command's result goes to stdout", async () => {
  const { deps: d, out } = await deps();
  expect(await run(parse(["new", "home"]), d)).toBe(0);
  expect(await run(parse(["list"]), d)).toBe(0);
  expect(out.join("")).toBe("Created @home. Talk to it with: jen @home <query>\n@home  running\n");
});

test("the runtime's refusal is shown and exits 1", async () => {
  const { deps: d, err } = await deps();
  await run(parse(["new", "home"]), d);
  expect(await run(parse(["new", "home"]), d)).toBe(1);
  expect(err.join("")).toBe("jen: a root agent is already named home\n");
});

test("src/cli imports only types from src/runtime and src/agent", () => {
  const dir = join(import.meta.dirname);
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))) {
    const source = readFileSync(join(dir, file), "utf8");
    for (const [, statement] of source.matchAll(/^(import [^;]*?from "\.\.\/(?:runtime|agent)\/[^"]+";)$/gms)) {
      expect(statement, `${file}: ${statement}`).toMatch(/^import type /);
    }
  }
});

test("main.ts runs as jen from node, with no arguments printing the usage and exiting 2", () => {
  const main = join(import.meta.dirname, "main.ts");
  expect(readFileSync(main, "utf8").startsWith("#!/usr/bin/env node\n")).toBe(true);
  const help = spawnSync(process.execPath, [main, "help"], { encoding: "utf8" });
  expect([help.status, help.stdout]).toEqual([0, `${USAGE}\n`]);
  const none = spawnSync(process.execPath, [main], { encoding: "utf8" });
  expect([none.status, none.stderr]).toEqual([2, `${USAGE}\n`]);
});
