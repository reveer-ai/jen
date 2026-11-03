import { mkdtempSync, rmSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
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
    maxRetries: 3,
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
