import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { EngineError, type Runner } from "./docker.ts";
import { harness, SETTINGS } from "./harness.ts";
import { Machine, machineFiles, PLATFORM_PACKAGE, START_MS, type MachineHost } from "./machine.ts";
import { parse, run, type Deps } from "./main.ts";
import { QUESTION } from "./uninstall.ts";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "jen-machine-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

// The machine's files as a package holds them, at system version.
function files(version = "a1") {
  const system = join(dir, "pkg", "machine");
  mkdirSync(system, { recursive: true });
  writeFileSync(join(system, "version"), `${version}\n`);
  return { system, launcher: join(dir, "pkg", "bin", "jen-machine"), docker: join(dir, "pkg", "bin", "docker") };
}

// A Mac with a stand-in launcher: launching it records the process and the
// system it boots, and its engine answers bootPolls checks later. A clock that
// sleep moves on.
function mac({ bootPolls = 3, arm64 = true, version = "a1" } = {}) {
  const pkg = files(version);
  const launches: string[][] = [];
  const signals: [number, string | 0][] = [];
  const said: string[] = [];
  let clock = 0;
  let nextPid = 4000;
  // The running launcher's process and how many more checks until its engine
  // answers, or undefined.
  let launcher: { pid: number; polls: number; exited: boolean } | undefined;
  // Other running processes, such as a jen holding the start lock.
  const others = new Set<number>();
  const run: Runner = async (program, args, options) => {
    if (program === "sysctl") return { code: 0, stdout: arm64 ? "1\n" : "0\n", stderr: "" };
    expect(program).toBe(pkg.docker);
    expect(options?.env?.DOCKER_HOST).toBe(`unix://${machine.folder}/engine.sock`);
    if (launcher && !launcher.exited && launcher.polls-- <= 0) return { code: 0, stdout: "29.9.3\n", stderr: "" };
    return { code: 1, stdout: "", stderr: "Cannot connect to the Docker daemon" };
  };
  const host: Partial<MachineHost> = {
    home: join(dir, "home"),
    files: () => pkg,
    run,
    launch: (program, args) => {
      launches.push([program, ...args]);
      launcher = { pid: nextPid++, polls: bootPolls, exited: false };
      writeFileSync(join(args[0]!, "launcher.pid"), `${launcher.pid}\n`);
      writeFileSync(join(args[0]!, "version"), readFileSync(join(args[1]!, "version")));
      const started = launcher;
      return { exitCode: () => (started.exited ? 1 : null) };
    },
    lookup: async (pid) => (launcher && !launcher.exited && launcher.pid === pid ? "jen-machine" : others.has(pid) || pid === process.pid ? "node" : undefined),
    kill: (pid, signal) => {
      signals.push([pid, signal]);
      if (signal === 0) return others.has(pid) || pid === process.pid || launcher?.pid === pid;
      if (launcher?.pid !== pid || launcher.exited) return false;
      launcher.exited = true;
      return true;
    },
  };
  const machine = new Machine("jen", host);
  const options = { start: true, say: (line: string) => said.push(line), sleep: async (ms: number) => void (clock += ms), now: () => clock };
  return {
    machine,
    host,
    pkg,
    options,
    launches,
    signals,
    said,
    others,
    elapsed: () => clock,
    get launcher() {
      return launcher;
    },
    crash: () => launcher && (launcher.exited = true),
  };
}

describe("starting", () => {
  test("a stopped machine is started, said, and waited for", async () => {
    const m = mac();
    expect(await m.machine.ensure(m.options)).toBe(true);
    expect(m.said).toEqual(["starting jen's machine..."]);
    expect(m.launches).toEqual([[m.pkg.launcher, m.machine.folder, m.pkg.system]]);
    expect(m.machine.folder).toBe(join(dir, "home", ".jen", "machines", "jen"));
    expect(existsSync(join(m.machine.folder, "start.lock"))).toBe(false);
  });

  test("a machine whose engine answers is left as it is", async () => {
    const m = mac({ bootPolls: 0 });
    await m.machine.ensure(m.options);
    m.said.length = 0;
    expect(await m.machine.ensure(m.options)).toBe(true);
    expect(m.launches).toHaveLength(1);
    expect(m.said).toEqual([]);
  });

  test("two commands at once start one machine, and both carry on with it", async () => {
    const m = mac({ bootPolls: 5 });
    expect(await Promise.all([m.machine.ensure(m.options), m.machine.ensure(m.options)])).toEqual([true, true]);
    expect(m.launches).toHaveLength(1);
  });

  test("a start lock whose jen is gone is taken", async () => {
    const m = mac();
    mkdirSync(m.machine.folder, { recursive: true });
    writeFileSync(join(m.machine.folder, "start.lock"), "99999\n");
    expect(await m.machine.ensure(m.options)).toBe(true);
    expect(m.launches).toHaveLength(1);
  });

  test("a start lock another running jen holds is waited on, starting nothing", async () => {
    const m = mac();
    mkdirSync(m.machine.folder, { recursive: true });
    writeFileSync(join(m.machine.folder, "start.lock"), "777\n");
    m.others.add(777);
    const error = await m.machine.ensure(m.options).catch((e) => e);
    expect(error).toBeInstanceOf(EngineError);
    expect(error.message).toBe(`jen's machine didn't answer within 60 seconds. Its console is in ${m.machine.folder}/console.log`);
    expect(m.launches).toEqual([]);
  });

  test("a start lock older than any start takes is stale, even when its process ID is running, as after a reboot reused it", async () => {
    const m = mac();
    mkdirSync(m.machine.folder, { recursive: true });
    const lock = join(m.machine.folder, "start.lock");
    writeFileSync(lock, "777\n");
    m.others.add(777);
    const then = (Date.now() - 2 * START_MS - 1_000) / 1000;
    utimesSync(lock, then, then);
    expect(await m.machine.ensure(m.options)).toBe(true);
    expect(m.launches).toHaveLength(1);
  });

  test("a start lock from before the Mac last started is stale, however young", async () => {
    const m = mac();
    mkdirSync(m.machine.folder, { recursive: true });
    const lock = join(m.machine.folder, "start.lock");
    writeFileSync(lock, "777\n");
    m.others.add(777);
    const then = (Date.now() - 30_000) / 1000;
    utimesSync(lock, then, then);
    const machine = new Machine("jen", { ...m.host, booted: () => Date.now() - 10_000 });
    expect(await machine.ensure(m.options)).toBe(true);
    expect(m.launches).toHaveLength(1);
  });

  test("a launcher.pid that no running jen-machine holds, as after a reboot, is stale", async () => {
    const m = mac();
    mkdirSync(m.machine.folder, { recursive: true });
    writeFileSync(join(m.machine.folder, "launcher.pid"), `${process.pid}\n`);
    expect(await m.machine.launcher()).toBeUndefined();
    expect(await m.machine.ensure(m.options)).toBe(true);
    expect(m.launches).toHaveLength(1);
  });

  test("a running launcher whose engine doesn't answer yet is waited for, not started again", async () => {
    const m = mac({ bootPolls: 50 });
    await m.machine.ensure(m.options);
    m.launcher!.polls = 10;
    expect(await m.machine.ensure(m.options)).toBe(true);
    expect(m.launches).toHaveLength(1);
  });

  test("an engine that doesn't answer within 60 seconds fails naming the console's log, and the launcher is stopped", async () => {
    const m = mac({ bootPolls: Infinity });
    const error = await m.machine.ensure(m.options).catch((e) => e);
    expect(error).toBeInstanceOf(EngineError);
    expect(error.message).toBe(`jen's machine didn't answer within 60 seconds. Its console is in ${m.machine.folder}/console.log`);
    expect(m.elapsed()).toBeGreaterThanOrEqual(START_MS);
    expect(m.signals).toContainEqual([m.launcher!.pid, "SIGTERM"]);
    expect(existsSync(join(m.machine.folder, "start.lock"))).toBe(false);
  });

  test("a launcher that exits as it starts fails at once naming the console's log", async () => {
    const m = mac({ bootPolls: Infinity });
    const launch = m.host.launch!;
    m.host.launch = (...args) => {
      const started = launch(...args);
      m.crash();
      return started;
    };
    const error = await new Machine("jen", m.host).ensure(m.options).catch((e) => e);
    expect(error.message).toBe(`jen's machine stopped as it started. Its console is in ${m.machine.folder}/console.log`);
    expect(m.elapsed()).toBeLessThan(START_MS);
  });

  test("without start, a machine that doesn't answer answers false, starting nothing", async () => {
    const m = mac();
    expect(await m.machine.ensure({ ...m.options, start: false })).toBe(false);
    expect(m.launches).toEqual([]);
    expect(m.said).toEqual([]);
    expect(existsSync(m.machine.folder)).toBe(false);
  });

  test("each runtime name has a machine of its own", () => {
    const m = mac();
    expect(new Machine("jen-live-1a2b", m.host).folder).toBe(join(dir, "home", ".jen", "machines", "jen-live-1a2b"));
  });
});

describe("stopping, upgrading and removing", () => {
  test("stopping sends the launcher SIGTERM and waits for it to exit", async () => {
    const m = mac();
    await m.machine.ensure(m.options);
    const pid = m.launcher!.pid;
    expect(await m.machine.stop(m.options)).toBe(true);
    expect(m.signals).toContainEqual([pid, "SIGTERM"]);
    expect(await m.machine.launcher()).toBeUndefined();
  });

  test("stopping a machine that isn't running answers false", async () => {
    const m = mac();
    expect(await m.machine.stop(m.options)).toBe(false);
    expect(m.signals.filter(([, s]) => s !== 0)).toEqual([]);
  });

  test("a machine is outdated only while it runs a system other than the package's", async () => {
    const m = mac();
    expect(await m.machine.outdated()).toBe(false);
    await m.machine.ensure(m.options);
    expect(await m.machine.outdated()).toBe(false);
    writeFileSync(join(m.pkg.system, "version"), "b2\n");
    expect(await m.machine.outdated()).toBe(true);
    await m.machine.stop(m.options);
    expect(await m.machine.outdated()).toBe(false);
  });

  test("removing stops the machine and deletes its folder, and only its own", async () => {
    const m = mac();
    await m.machine.ensure(m.options);
    const other = new Machine("jen-live-1a2b", m.host);
    mkdirSync(other.folder, { recursive: true });
    await m.machine.remove(m.options);
    expect(existsSync(m.machine.folder)).toBe(false);
    expect(existsSync(other.folder)).toBe(true);
    expect(m.launcher!.exited).toBe(true);
  });
});

describe("the machine's files", () => {
  test("an installed jen's are the platform package's", () => {
    const resolved = machineFiles("0.2.0", (id) => {
      expect(id).toBe(`${PLATFORM_PACKAGE}/package.json`);
      return "/lib/node_modules/jen-ai/node_modules/@jen-ai/darwin-arm64/package.json";
    });
    expect(resolved).toEqual({
      system: "/lib/node_modules/jen-ai/node_modules/@jen-ai/darwin-arm64/machine",
      launcher: "/lib/node_modules/jen-ai/node_modules/@jen-ai/darwin-arm64/bin/jen-machine",
      docker: "/lib/node_modules/jen-ai/node_modules/@jen-ai/darwin-arm64/bin/docker",
    });
  });

  test("an installed jen without the platform package says to reinstall", () => {
    const missing = () => {
      throw new Error("Cannot find module");
    };
    expect(() => machineFiles("0.2.0", missing as never)).toThrow(new RegExp(`npm didn't install its package, ${PLATFORM_PACKAGE}\\. Reinstall jen with: npm install -g jen-ai`));
  });

  test("a checkout's are dist/machine/'s, and a checkout without them names npm run build:machine", () => {
    const built = join(dir, "dist", "machine");
    expect(() => machineFiles(undefined, undefined, built)).toThrow(new EngineError("jen's machine isn't built. Build it from jen's checkout with: npm run build:machine"));
    mkdirSync(built, { recursive: true });
    for (const file of ["jen-machine", "docker", "version"]) writeFileSync(join(built, file), "");
    expect(machineFiles(undefined, undefined, built)).toEqual({ system: built, launcher: join(built, "jen-machine"), docker: join(built, "docker") });
  });
});

// jen's commands on a Mac: the harness's engine, behind the stand-in machine.
async function onMac(options: Parameters<typeof mac>[0] = {}, given: Parameters<typeof harness>[0] = {}) {
  const m = mac(options);
  const h = await harness(given);
  const out: string[] = [];
  const err: string[] = [];
  const d: Deps = {
    docker: h.docker,
    machine: m.machine,
    env: {},
    terminal: h.ctx.terminal,
    stdout: (t) => out.push(t),
    stderr: (t) => err.push(t),
    fetch: globalThis.fetch,
    sleep: m.options.sleep,
    now: m.options.now,
    columns: 80,
    interrupt: new AbortController().signal,
    mainPath: "/nowhere",
    npm: async () => ({ code: 1, stdout: "", stderr: "" }),
  };
  return { m, h, d, out, err };
}

describe("jen on a Mac", () => {
  let close: (() => Promise<void>) | undefined;
  afterEach(() => close?.());

  test("an Intel Mac is refused, having done nothing", async () => {
    const { d, err, h, m } = await onMac({ arm64: false });
    close = () => h.api.close();
    for (const args of [["list"], ["new", "home"], ["stop", "all"], ["uninstall"]]) expect(await run(parse(args), d)).toBe(1);
    expect(new Set(err)).toEqual(new Set(["jen: jen needs a Mac with Apple silicon, and this one has an Intel processor.\n"]));
    expect(h.docker.calls).toEqual([]);
    expect(m.launches).toEqual([]);
  });

  test.each([[["stop", "all"]], [["stop", "@home"]]])("jen %j with the machine stopped starts nothing and says nothing of jen's is running", async (args) => {
    const { d, out, h, m } = await onMac();
    close = () => h.api.close();
    // The stand-in machine is the engine: it answers only once launched.
    h.docker.reachable = false;
    expect(await run(parse(args), d)).toBe(0);
    expect(out.join("")).toBe("jen's machine isn't running, so nothing of jen's is.\n");
    expect(m.launches).toEqual([]);
  });

  test("jen stop all stops every agent, the runtime, then the machine", async () => {
    const { d, out, h, m } = await onMac();
    close = () => h.api.close();
    await m.machine.ensure(m.options);
    expect(await run(parse(["new", "home"]), d)).toBe(0);
    expect(await run(parse(["stop", "all"]), d)).toBe(0);
    expect(out.slice(-2)).toEqual(["stopped 1 root agent and everything under it, and the runtime. Their conversations and files are kept.\n", "stopped jen's machine.\n"]);
    expect([...h.api.agents.values()].map((a) => a.state)).toEqual(["stopped"]);
    expect(await m.machine.launcher()).toBeUndefined();
  });

  test("a machine on another system is restarted on the package's, stopping every agent first", async () => {
    const { d, err, h, m } = await onMac();
    close = () => h.api.close();
    await m.machine.ensure(m.options);
    expect(await run(parse(["new", "home"]), d)).toBe(0);
    const before = m.launcher!.pid;
    writeFileSync(join(m.pkg.system, "version"), "b2\n");
    expect(await run(parse(["list"]), d)).toBe(0);
    expect(err).toEqual(["jen's machine has a new system, so jen is restarting it on that.\n", "stopped 1 root agent and everything under it. Each starts again at its next message.\n", "starting jen's machine...\n"]);
    expect(m.signals).toContainEqual([before, "SIGTERM"]);
    expect(m.launches).toHaveLength(2);
    expect(readFileSync(join(m.machine.folder, "version"), "utf8")).toBe("b2\n");
    expect(await m.machine.outdated()).toBe(false);
    expect([...h.api.agents.values()].map((a) => a.state)).toEqual(["stopped"]);
  });

  test("the runtime is published on a port the Mac has free, not a saved one something on the Mac holds, which hears nothing", async () => {
    const heard: string[] = [];
    const other = createServer((req, res) => (heard.push(`${req.method} ${req.url} ${req.headers.authorization ?? ""}`), res.end("{}")));
    const held = await new Promise<number>((resolve) => other.listen(0, "127.0.0.1", () => resolve((other.address() as { port: number }).port)));
    const { d, h } = await onMac({}, { settings: { ...SETTINGS, port: held } });
    close = async () => (await h.api.close(), void other.close());
    expect(await run(parse(["list"]), d)).toBe(0);
    const published = h.docker.runs.flatMap((r) => r.args.filter((arg) => arg.endsWith(":8080")));
    expect(published).toHaveLength(1);
    const port = Number(published[0]!.split(":")[1]);
    expect(port).not.toBe(held);
    expect(h.docker.settings().port).toBe(port);
    expect(heard).toEqual([]);
  });

  test("on a Mac, the runtime's saved port is kept when the Mac has it free", async () => {
    const free = await new Machine("jen").port();
    const { d, h } = await onMac({}, { settings: { ...SETTINGS, port: free } });
    close = () => h.api.close();
    expect(await run(parse(["list"]), d)).toBe(0);
    expect(h.docker.runs.flatMap((r) => r.args.filter((arg) => arg.endsWith(":8080")))).toEqual([`127.0.0.1:${free}:8080`]);
  });

  test("a missing image is named with the command that builds it into the machine", async () => {
    const { d, err, h, m } = await onMac({ bootPolls: 0 });
    close = () => h.api.close();
    h.docker.images.delete("jen-workspace");
    expect(await run(parse(["list"]), d)).toBe(1);
    expect(err.at(-1)).toBe(`jen: the image jen-workspace is missing. Build it from jen's checkout with: DOCKER_HOST=unix://${m.machine.folder}/engine.sock docker build --target workspace -t jen-workspace .\n`);
  });

  test("jen uninstall deletes the machine's folder without starting it, and nothing in its engine one by one", async () => {
    const { d, out, h, m } = await onMac();
    close = () => h.api.close();
    d.terminal = { interactive: true, ask: async (q) => (expect(q).toBe(QUESTION), "y"), askHidden: async () => "" };
    mkdirSync(m.machine.folder, { recursive: true });
    writeFileSync(join(m.machine.folder, "data.img"), "");
    expect(await run(parse(["uninstall"]), d)).toBe(0);
    expect(existsSync(m.machine.folder)).toBe(false);
    expect(m.launches).toEqual([]);
    expect(h.docker.calls).toEqual([]);
    expect(out[0]).toBe("deleted jen's machine, with every agent's conversation and files, the runtime, the settings and the images.\n");
  });
});
