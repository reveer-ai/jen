import { expect, test } from "vitest";
import { createDocker, DockerError, runProcess, Unreachable, type Output, type Runner } from "./docker.ts";

// A runner that answers each call with answer, and records it.
function stub(answer: (args: string[]) => Partial<Output> = () => ({})) {
  const calls: { program: string; args: string[]; env?: Record<string, string>; input?: string }[] = [];
  const runner: Runner = async (program, args, options = {}) => {
    calls.push({ program, args, ...options });
    return { code: 0, stdout: "", stderr: "", ...answer(args) };
  };
  return { calls, docker: createDocker(runner) };
}

test("a missing docker command is unreachable", async () => {
  const { docker } = stub(() => ({ code: -1, stderr: "spawn docker ENOENT" }));
  const error = await docker.ping().catch((e) => e);
  expect(error).toBeInstanceOf(Unreachable);
  expect(error.message).toMatch(/docker isn't reachable.*ENOENT/);
});

test("an engine that doesn't answer is unreachable", async () => {
  const { docker, calls } = stub(() => ({ code: 1, stderr: "failed to connect to the docker API at unix:///x.sock" }));
  await expect(docker.ping()).rejects.toThrow(/docker isn't reachable.*failed to connect/);
  expect(calls[0]!.args).toEqual(["version", "--format", "{{.Server.Version}}"]);
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
