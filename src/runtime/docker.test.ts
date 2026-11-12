import { mkdtempSync, rmSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createDocker, DockerError, type Docker } from "./docker.ts";

type Seen = { method: string; url: string; body: any };
type Reply = { status: number; body?: unknown; raw?: string };

let dir: string;
let server: http.Server;
let seen: Seen[];
let replies: Reply[];
let docker: Docker;

// A stub engine on a Unix socket: records each request and answers with the
// next queued reply, or 204 when none is queued.
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "jen-docker-"));
  seen = [];
  replies = [];
  server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const text = Buffer.concat(chunks).toString("utf8");
    seen.push({ method: req.method!, url: req.url!, body: text === "" ? undefined : JSON.parse(text) });
    const reply = replies.shift() ?? { status: 204 };
    const payload = reply.raw ?? (reply.body === undefined ? "" : JSON.stringify(reply.body));
    res.writeHead(reply.status, { "Content-Type": "application/json" }).end(payload);
  });
  const socket = join(dir, "docker.sock");
  await new Promise<void>((resolve) => server.listen(socket, resolve));
  docker = createDocker(socket);
});
afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
  rmSync(dir, { recursive: true, force: true });
});

const labelFilter = (labels: string[]) => encodeURIComponent(JSON.stringify({ label: labels }));

test("creates a volume with its labels", async () => {
  replies.push({ status: 201, body: { Name: "v" } });
  await docker.createVolume("v", { "jen.agent": "a1" });
  expect(seen).toEqual([{ method: "POST", url: "/v1.47/volumes/create", body: { Name: "v", Labels: { "jen.agent": "a1" } } }]);
});

test("lists volumes by label", async () => {
  replies.push({ status: 200, body: { Volumes: [{ Name: "v", Labels: { a: "1" } }, { Name: "w", Labels: null }] } });
  const volumes = await docker.listVolumes(["jen.runtime=jen", "jen.agent"]);
  expect(seen[0].url).toBe(`/v1.47/volumes?filters=${labelFilter(["jen.runtime=jen", "jen.agent"])}`);
  expect(volumes).toEqual([
    { name: "v", labels: { a: "1" } },
    { name: "w", labels: {} },
  ]);
});

test("removing a volume that doesn't exist succeeds", async () => {
  replies.push({ status: 404, body: { message: "no such volume" } });
  await docker.removeVolume("gone");
  expect(seen[0]).toMatchObject({ method: "DELETE", url: "/v1.47/volumes/gone" });
});

test("creates a container with its fixed settings and returns its ID", async () => {
  replies.push({ status: 201, body: { Id: "c1", Warnings: [] } });
  const id = await docker.createContainer("jen-agent-a1", {
    image: "jen",
    env: ["A=1"],
    labels: { "jen.agent": "a1" },
    volume: { name: "jen-agent-a1", path: "/state" },
    network: "jen",
    restart: { maxRetries: 3 },
  });
  expect(id).toBe("c1");
  expect(seen[0]).toEqual({
    method: "POST",
    url: "/v1.47/containers/create?name=jen-agent-a1",
    body: {
      Image: "jen",
      Env: ["A=1"],
      Labels: { "jen.agent": "a1" },
      HostConfig: {
        Mounts: [{ Type: "volume", Source: "jen-agent-a1", Target: "/state" }],
        NetworkMode: "jen",
        RestartPolicy: { Name: "on-failure", MaximumRetryCount: 3 },
      },
    },
  });
});

test("creates a sandboxed container with every setting it's given", async () => {
  replies.push({ status: 201, body: { Id: "c2" } });
  await docker.createContainer("jen-workspace-a1", {
    image: "jen-workspace",
    env: [],
    labels: { "jen.workspace": "a1" },
    volume: { name: "jen-workspace-a1", path: "/home/agent" },
    network: "none",
    restart: "unless-stopped",
    sandbox: { user: "agent", tmp: { path: "/tmp", bytes: 512 * 2 ** 20 }, shmBytes: 64 * 2 ** 20, memoryBytes: 2 * 2 ** 30, nanoCpus: 2e9, pids: 512 },
  });
  expect(seen[0]!.body).toEqual({
    Image: "jen-workspace",
    Env: [],
    Labels: { "jen.workspace": "a1" },
    User: "agent",
    HostConfig: {
      Mounts: [{ Type: "volume", Source: "jen-workspace-a1", Target: "/home/agent" }],
      NetworkMode: "none",
      RestartPolicy: { Name: "unless-stopped" },
      Tmpfs: { "/tmp": "rw,exec,nosuid,nodev,size=536870912" },
      ShmSize: 67108864,
      IpcMode: "private",
      CapDrop: ["ALL"],
      SecurityOpt: ["no-new-privileges"],
      ReadonlyRootfs: true,
      Init: true,
      PidsLimit: 512,
      Memory: 2147483648,
      NanoCpus: 2000000000,
    },
  });
});

test("starts, renames and force-removes a container", async () => {
  await docker.startContainer("c1");
  await docker.renameContainer("c1", "jen-runtime");
  await docker.removeContainer("c1");
  expect(seen.map(({ method, url }) => `${method} ${url}`)).toEqual([
    "POST /v1.47/containers/c1/start",
    "POST /v1.47/containers/c1/rename?name=jen-runtime",
    "DELETE /v1.47/containers/c1?force=true",
  ]);
});

test("removing a container that doesn't exist succeeds", async () => {
  replies.push({ status: 404, body: { message: "No such container: c1" } });
  await docker.removeContainer("c1");
});

test("lists every container by label, without the leading slash", async () => {
  replies.push({ status: 200, body: [{ Id: "c1", Names: ["/jen-agent-a1"], State: "exited", Labels: { x: "y" } }] });
  const containers = await docker.listContainers(["jen.runtime=jen"]);
  expect(seen[0].url).toBe(`/v1.47/containers/json?all=true&filters=${labelFilter(["jen.runtime=jen"])}`);
  expect(containers).toEqual([{ id: "c1", name: "jen-agent-a1", state: "exited", labels: { x: "y" } }]);
});

test("inspects a container", async () => {
  replies.push({
    status: 200,
    body: {
      Id: "c1",
      Name: "/jen-runtime",
      State: { Status: "running" },
      Config: { Env: ["A=1"], Labels: { x: "y" } },
      NetworkSettings: { Networks: { bridge: {}, jen: {} } },
    },
  });
  expect(await docker.inspectContainer("c1")).toEqual({
    id: "c1",
    name: "jen-runtime",
    state: "running",
    labels: { x: "y" },
    env: ["A=1"],
    networks: ["bridge", "jen"],
  });
  expect(seen[0].url).toBe("/v1.47/containers/c1/json");
});

test("inspecting a container that doesn't exist gives undefined", async () => {
  replies.push({ status: 404, body: { message: "No such container: c1" } });
  expect(await docker.inspectContainer("c1")).toBeUndefined();
});

test("creates, inspects and connects networks", async () => {
  replies.push({ status: 201, body: { Id: "n1" } }, { status: 200, body: { Name: "jen", Id: "n1" } }, { status: 200 });
  await docker.createNetwork("jen", { "jen.runtime": "jen" });
  expect(await docker.inspectNetwork("jen")).toEqual({ name: "jen" });
  await docker.connectNetwork("jen", "c1", ["runtime"]);
  expect(seen).toEqual([
    { method: "POST", url: "/v1.47/networks/create", body: { Name: "jen", Driver: "bridge", Labels: { "jen.runtime": "jen" } } },
    { method: "GET", url: "/v1.47/networks/jen", body: undefined },
    { method: "POST", url: "/v1.47/networks/jen/connect", body: { Container: "c1", EndpointConfig: { Aliases: ["runtime"] } } },
  ]);
});

test("inspecting a network that doesn't exist gives undefined", async () => {
  replies.push({ status: 404, body: { message: "network jen not found" } });
  expect(await docker.inspectNetwork("jen")).toBeUndefined();
});

test("an engine error becomes a DockerError with its status and message", async () => {
  replies.push({ status: 409, body: { message: "Conflict. The container name is already in use" } });
  const error = await docker.renameContainer("c1", "jen-runtime").catch((e) => e);
  expect(error).toBeInstanceOf(DockerError);
  expect(error).toMatchObject({ status: 409, message: "Conflict. The container name is already in use" });
});

test("an error that isn't JSON keeps its text", async () => {
  replies.push({ status: 500, raw: "engine on fire\n" });
  await expect(docker.startContainer("c1")).rejects.toMatchObject({ status: 500, message: "engine on fire" });
});

test("a 404 is an error everywhere but removal and inspection", async () => {
  replies.push({ status: 404, body: { message: "No such image: jen" } });
  await expect(docker.startContainer("c1")).rejects.toMatchObject({ status: 404 });
});

test("names are encoded in paths", async () => {
  await docker.removeVolume("a/b");
  expect(seen[0].url).toBe("/v1.47/volumes/a%2Fb");
});

test("watches containers' exits by label, across chunks, and reconnects when the stream ends", async () => {
  const socket = join(dir, "events.sock");
  const paths: string[] = [];
  const responses: http.ServerResponse[] = [];
  const engine = http.createServer((req, res) => {
    paths.push(req.url!);
    responses.push(res);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.flushHeaders();
  });
  await new Promise<void>((resolve) => engine.listen(socket, resolve));
  const exits: string[] = [];
  const stop = createDocker(socket).watchExits(["jen.runtime=jen", "jen.agent"], (id) => exits.push(id));
  await vi.waitFor(() => expect(responses).toHaveLength(1));
  const die = JSON.stringify({ Type: "container", Action: "die", Actor: { ID: "c1", Attributes: { exitCode: "1" } } });
  responses[0]!.write(die.slice(0, 10));
  responses[0]!.write(`${die.slice(10)}\n${JSON.stringify({ Type: "container", Action: "start", Actor: { ID: "c2" } })}\n`);
  await vi.waitFor(() => expect(exits).toEqual(["c1"]));
  responses[0]!.end();
  await vi.waitFor(() => expect(responses).toHaveLength(2), { timeout: 3_000 });
  responses[1]!.write(`${JSON.stringify({ Type: "container", Action: "die", Actor: { ID: "c3" } })}\n`);
  await vi.waitFor(() => expect(exits).toEqual(["c1", "c3"]));
  expect(paths[0]).toBe(
    `/v1.47/events?filters=${encodeURIComponent(JSON.stringify({ type: ["container"], event: ["die"], label: ["jen.runtime=jen", "jen.agent"] }))}`,
  );
  stop();
  engine.closeAllConnections();
  await new Promise((resolve) => engine.close(resolve));
});

describe("exec", () => {
  // An engine whose exec start answers with the frames start writes, on a
  // stream it keeps open until start ends it.
  async function engine(start: (res: http.ServerResponse) => void) {
    const socket = join(dir, "exec.sock");
    const requests: Seen[] = [];
    const closed: string[] = [];
    const server = http.createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      requests.push({ method: req.method!, url: req.url!, body: JSON.parse(Buffer.concat(chunks).toString("utf8") || "null") });
      if (req.url!.endsWith("/exec")) return void res.writeHead(201, { "Content-Type": "application/json" }).end(JSON.stringify({ Id: "e1" }));
      res.socket!.on("close", () => closed.push(req.url!));
      res.writeHead(200, { "Content-Type": "application/vnd.docker.multiplexed-stream" });
      res.flushHeaders();
      start(res);
    });
    await new Promise<void>((resolve) => server.listen(socket, resolve));
    return { docker: createDocker(socket), requests, closed, close: () => (server.closeAllConnections(), new Promise((resolve) => server.close(resolve))) };
  }
  const frame = (stream: number, text: string) => {
    const payload = Buffer.from(text);
    const header = Buffer.alloc(8);
    header[0] = stream;
    header.writeUInt32BE(payload.length, 4);
    return Buffer.concat([header, payload]);
  };
  const spec = { user: "agent", workdir: "/home/agent", cmd: ["bash", "-c", "echo hi"] };

  test("creates the exec with stdin closed, and decodes stdout's frames across chunks", async () => {
    const { docker, requests, close } = await engine((res) => {
      const bytes = Buffer.concat([frame(1, "hello "), frame(2, "ignored"), frame(1, "world")]);
      res.write(bytes.subarray(0, 3));
      res.write(bytes.subarray(3, 20));
      res.end(bytes.subarray(20));
    });
    const out: Buffer[] = [];
    const end = await docker.exec("c1", spec, { bound: 1024, signal: new AbortController().signal, onOutput: (chunk) => out.push(Buffer.from(chunk)) });
    expect(end).toBe("ended");
    expect(Buffer.concat(out).toString()).toBe("hello world");
    expect(requests).toEqual([
      {
        method: "POST",
        url: "/v1.47/containers/c1/exec",
        body: { AttachStdin: false, AttachStdout: true, AttachStderr: false, Tty: false, User: "agent", WorkingDir: "/home/agent", Cmd: ["bash", "-c", "echo hi"] },
      },
      { method: "POST", url: "/v1.47/exec/e1/start", body: { Detach: false, Tty: false } },
    ]);
    await close();
  });

  test("stops reading past the bound and closes the stream", async () => {
    const { docker, closed, close } = await engine((res) => {
      res.write(frame(1, "a".repeat(100)));
      res.write(frame(1, "b".repeat(100)));
    });
    const out: Buffer[] = [];
    const end = await docker.exec("c1", spec, { bound: 150, signal: new AbortController().signal, onOutput: (chunk) => out.push(Buffer.from(chunk)) });
    expect(end).toBe("bound");
    expect(Buffer.concat(out).toString()).toBe("a".repeat(100));
    await vi.waitFor(() => expect(closed).toEqual(["/v1.47/exec/e1/start"]));
    await close();
  });

  test("an abort closes a stream that never ends", async () => {
    const { docker, closed, close } = await engine((res) => res.write(frame(1, "first")));
    const abort = new AbortController();
    const out: string[] = [];
    const reading = docker.exec("c1", spec, { bound: 1024, signal: abort.signal, onOutput: (chunk) => out.push(chunk.toString()) });
    await vi.waitFor(() => expect(out).toEqual(["first"]));
    abort.abort();
    expect(await reading).toBe("aborted");
    await vi.waitFor(() => expect(closed).toHaveLength(1));
    await close();
  });

  test("an exec in a container that isn't running is a DockerError", async () => {
    replies.push({ status: 409, body: { message: "container c1 is not running" } });
    await expect(docker.exec("c1", spec, { bound: 1024, signal: new AbortController().signal, onOutput: () => {} })).rejects.toMatchObject({ status: 409 });
  });
});
