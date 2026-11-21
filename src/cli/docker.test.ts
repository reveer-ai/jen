import { expect, test } from "vitest";
import { createDocker, DockerError, EngineError, runProcess, START_MS, type EngineOptions, type Output, type Runner } from "./docker.ts";

// A runner that answers each call with answer, and records it.
function stub(answer: (args: string[], program: string) => Partial<Output> = () => ({}), platform: NodeJS.Platform = "darwin") {
  const calls: { program: string; args: string[]; env?: Record<string, string>; input?: string }[] = [];
  const runner: Runner = async (program, args, options = {}) => {
    calls.push({ program, args, ...options });
    return { code: 0, stdout: "", stderr: "", ...answer(args, program) };
  };
  return { calls, docker: createDocker(runner, platform) };
}

// The engine's options, on a clock that sleep moves on, recording what's said.
function engine(start = true) {
  let clock = 0;
  const said: string[] = [];
  const options: EngineOptions = { start, say: (line) => said.push(line), sleep: async (ms) => void (clock += ms), now: () => clock };
  return { options, said, elapsed: () => clock };
}

const version = ["version", "--format", "{{.Server.Version}}"];
const down = { code: 1, stderr: "failed to connect to the docker API at unix:///x.sock" };
const isVersion = (args: string[]) => args.join(" ") === version.join(" ");

test("an engine of 28.0 or later answers, starting nothing", async () => {
  for (const found of ["28.0.0", "28.0.4", "29.4.1", "30.0.0-rc.1"]) {
    const { docker, calls } = stub(() => ({ stdout: `${found}\n` }));
    const { options, said } = engine();
    expect(await docker.ensureEngine(options)).toBe(true);
    expect(calls.map((c) => c.args)).toEqual([version]);
    expect(said).toEqual([]);
  }
});

test.each([
  ["darwin", /no docker command\. Install Docker Desktop: https:\/\/docs\.docker\.com\/desktop\/setup\/install\/mac-install\/\. jen needs Docker Engine 28\.0 or later\./],
  ["linux", /no docker command\. Install Docker Engine: https:\/\/docs\.docker\.com\/engine\/install\/\. jen needs Docker Engine 28\.0 or later\./],
] as const)("on %s, a missing docker command is named with what to install", async (platform, message) => {
  const { docker, calls } = stub(() => ({ code: -1, stderr: "spawn docker ENOENT" }), platform);
  const error = await docker.ensureEngine(engine().options).catch((e) => e);
  expect(error).toBeInstanceOf(EngineError);
  expect(error.message).toMatch(message);
  expect(calls).toHaveLength(1);
});

test("an engine that doesn't answer is started with Docker Desktop's CLI, and waited for", async () => {
  let answers = 0;
  const { docker, calls } = stub((args) => (isVersion(args) ? (++answers > 3 ? { stdout: "29.4.1" } : down) : {}));
  const { options, said, elapsed } = engine();
  expect(await docker.ensureEngine(options)).toBe(true);
  expect(said).toEqual(["starting docker..."]);
  expect(calls.map((c) => [c.program, ...c.args])).toEqual([["docker", ...version], ["docker", "desktop", "start", "--detach"], ...Array(3).fill(["docker", ...version])]);
  expect(elapsed()).toBe(2_000);
});

test("on macOS without Docker Desktop's CLI, Docker is opened instead", async () => {
  let started = false;
  const { docker, calls } = stub((args, program) => {
    if (program === "open") return (started = true), {};
    if (args[0] === "desktop") return { code: 1, stderr: "docker: unknown command: docker desktop" };
    return started ? { stdout: "28.1.1" } : down;
  });
  expect(await docker.ensureEngine(engine().options)).toBe(true);
  expect(calls.map((c) => [c.program, ...c.args])).toContainEqual(["open", "-a", "Docker"]);
});

test("an engine that doesn't answer within 120 seconds of starting fails saying how to start Docker by hand", async () => {
  const { docker } = stub((args) => (isVersion(args) ? down : args[0] === "context" ? { stdout: "desktop-linux\n" } : {}));
  const { options, elapsed } = engine();
  const error = await docker.ensureEngine(options).catch((e) => e);
  expect(error).toBeInstanceOf(EngineError);
  expect(error.message).toBe("docker isn't running, and jen couldn't start it within 120 seconds. Start Docker Desktop and try again.");
  expect(elapsed()).toBe(START_MS);
});

test("on Linux with Docker Engine stopped, it fails at once saying how to start the engine", async () => {
  const { docker, calls } = stub((args) => (isVersion(args) ? down : args[0] === "desktop" ? { code: 1, stderr: "docker: 'desktop' is not a docker command." } : { stdout: "default\n" }), "linux");
  const error = await docker.ensureEngine(engine().options).catch((e) => e);
  expect(error.message).toBe("docker isn't running, and jen couldn't start it. Start Docker Desktop, or Docker Engine with: sudo systemctl start docker. Then try again.");
  expect(calls.some((c) => c.program === "open")).toBe(false);
});

test("an engine of a context that isn't Docker's own is named by its context", async () => {
  const { docker } = stub((args, program) => (isVersion(args) ? down : args[0] === "context" ? { stdout: "colima\n" } : program === "open" || args[0] === "desktop" ? { code: 1 } : {}));
  const error = await docker.ensureEngine(engine().options).catch((e) => e);
  expect(error.message).toBe("docker isn't running, and jen couldn't start it. docker's context is colima, so start its engine and try again.");
});

test.each([
  ["darwin", "27.5.1", "this engine is 27.5.1. Update Docker Desktop to its latest version."],
  ["linux", "27.5.1", "this engine is 27.5.1. Update Docker Engine: https://docs.docker.com/engine/install/."],
  ["linux", "4.9.4-podman", "this engine is 4.9.4-podman. Update Docker Engine"],
  ["linux", "28", 'this engine is "28", which isn\'t Docker\'s.'],
  ["darwin", "unknown", 'this engine is "unknown", which isn\'t Docker\'s.'],
] as const)("on %s, engine %s is refused", async (platform, found, message) => {
  const { docker } = stub(() => ({ stdout: `${found}\n` }), platform);
  const error = await docker.ensureEngine(engine().options).catch((e) => e);
  expect(error).toBeInstanceOf(EngineError);
  expect(error.message).toContain(`jen needs Docker Engine 28.0 or later, and ${message}`);
});

test("without start, a missing docker or an engine that doesn't answer answers false, starting nothing", async () => {
  for (const answer of [{ code: -1, stderr: "spawn docker ENOENT" }, down]) {
    const { docker, calls } = stub(() => answer);
    const { options, said } = engine(false);
    expect(await docker.ensureEngine(options)).toBe(false);
    expect(calls).toHaveLength(1);
    expect(said).toEqual([]);
  }
});

test("the real runner reports a program that doesn't exist as code -1", async () => {
  const output = await runProcess("jen-no-such-program-7f3a", []);
  expect(output.code).toBe(-1);
});

test("the real runner passes env and stdin, and leaves them out of the arguments", async () => {
  const output = await runProcess("sh", ["-c", 'printf "%s|" "$JEN_SECRET"; cat'], { env: { JEN_SECRET: "s3cret" }, input: "from stdin" });
  expect(output).toEqual({ code: 0, stdout: "s3cret|from stdin", stderr: "" });
});

test("secrets and settings reach docker run only through its environment and stdin", async () => {
  const { docker, calls } = stub();
  await docker.run(["-d", "-e", "JEN_API_KEY", "-e", "JEN_MODEL", "jen-runtime"], { env: { JEN_MODEL: "m" }, secrets: { JEN_API_KEY: "sk-live-7f3a" }, input: '{"apiKey":"sk-live-7f3a"}' });
  expect(calls[0]).toEqual({
    program: "docker",
    args: ["run", "-d", "-e", "JEN_API_KEY", "-e", "JEN_MODEL", "jen-runtime"],
    env: { JEN_MODEL: "m", JEN_API_KEY: "sk-live-7f3a" },
    input: '{"apiKey":"sk-live-7f3a"}',
  });
  for (const call of calls) for (const arg of call.args) expect(arg).not.toContain("sk-live-7f3a");
});

test("a secret in an argument is refused before docker runs", async () => {
  const { docker, calls } = stub();
  await expect(docker.run(["-e", "JEN_API_KEY=sk-live-7f3a", "jen-runtime"], { secrets: { JEN_API_KEY: "sk-live-7f3a" } })).rejects.toThrow(/secret/);
  expect(calls).toEqual([]);
});

test("a missing image, container or volume reads as absent, and removing one that's gone succeeds", async () => {
  const { docker } = stub((args) => ({ code: 1, stderr: `Error response from daemon: No such ${args[0] === "image" ? "image" : args[0] === "volume" ? "volume" : "object"}: x` }));
  expect(await docker.imageId("jen-agent")).toBeUndefined();
  expect(await docker.inspect("jen-runtime")).toBeUndefined();
  expect(await docker.volumeExists("jen-settings")).toBe(false);
  await docker.remove("jen-runtime");
  await docker.removeVolume("jen-settings");
  await docker.removeImage("jen-agent");
});

test("any other failure is Docker's own message", async () => {
  const { docker } = stub(() => ({ code: 1, stderr: "no space left on device" }));
  const error = await docker.removeVolume("v").catch((e) => e);
  expect(error).toBeInstanceOf(DockerError);
  expect(error.message).toMatch(/no space left on device/);
});

test("containers are listed by every label and read with their image, state, environment and labels", async () => {
  const inspected = [{ Id: "abc", Name: "/jen-runtime", Image: "sha256:1", State: { Status: "running" }, Config: { Env: ["JEN_OWNER_TOKEN=t"], Labels: { "jen.runtime": "jen" } } }];
  const { docker, calls } = stub((args) => (args[0] === "ps" ? { stdout: "abc\n" } : { stdout: JSON.stringify(inspected) }));
  expect(await docker.containers(["jen.runtime=jen", "jen.agent"])).toEqual([
    { id: "abc", name: "jen-runtime", image: "sha256:1", state: "running", env: ["JEN_OWNER_TOKEN=t"], labels: { "jen.runtime": "jen" } },
  ]);
  expect(calls[0]!.args).toEqual(["ps", "-aq", "--no-trunc", "--filter", "label=jen.runtime=jen", "--filter", "label=jen.agent"]);
  expect(calls[1]!.args).toEqual(["inspect", "--type", "container", "abc"]);
});

test("a published port is read back from docker port", async () => {
  const { docker } = stub(() => ({ stdout: "127.0.0.1:54321\n" }));
  expect(await docker.port("jen-runtime")).toBe(54321);
});

test("a volume is created with its labels, a bare label without a value", async () => {
  const { docker, calls } = stub();
  await docker.createVolume("jen-settings", { "jen.runtime": "jen", "jen.settings": "" });
  expect(calls[0]!.args).toEqual(["volume", "create", "--label", "jen.runtime=jen", "--label", "jen.settings", "jen-settings"]);
});
