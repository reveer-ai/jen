// The runtime's API over HTTP. Every request carries a bearer token: the
// owner's, or the current token of a running agent. The caller is whoever the
// token belongs to, and every route that names an agent acts only on the
// caller's descendants, except that a caller may also message its parent. The
// runtime checks the token again when it acts, so one that stops being
// current while its request waits is refused then. Requests to an agent's
// protocol are relayed to it with its own token, which never leaves the
// runtime, and a message with its sender in Jen-From. POST /workspace/commands
// runs a command in the caller's own workspace, and in no other, and GET and
// PUT /workspace/files?path=<path> read and write a file's raw bytes there.

import { createHash, timingSafeEqual } from "node:crypto";
import http from "node:http";
import { pipeline } from "node:stream";
import { MAX_FILE, MAX_TIMEOUT, RuntimeError, type Address, type Caller, type Grant, type Runtime } from "./runtime.ts";

export interface RuntimeServerOptions {
  runtime: Runtime;
  ownerToken: string;
}

// Response headers that belong to one connection, not to the response.
const HOP_BY_HOP = new Set(["connection", "keep-alive", "transfer-encoding", "proxy-connection", "upgrade"]);
// Request headers the relay passes to the agent. Its token replaces the caller's.
const FORWARDED = ["content-type", "content-length", "accept", "last-event-id"];
// The most a spawn body may hold. A grant is a few dozen bytes; the bound keeps
// any caller from making the shared runtime buffer an arbitrary upload.
export const MAX_BODY = 16 * 1024;
// The most a command's body may hold. It stays under Linux's 128 KiB limit on
// one argument, which the command becomes. Agents write files through the
// file route, but nothing is gained by shrinking it, and a short heredoc
// still fits.
export const MAX_COMMAND_BODY = 64 * 1024;
// The longest path the file route takes, in bytes. Linux's own is 4096.
export const MAX_PATH = 4096;
// A command's timeout when the body names none, in seconds.
const DEFAULT_TIMEOUT = 120;

export function createRuntimeServer({ runtime, ownerToken }: RuntimeServerOptions): http.Server {
  const owner = digest(`Bearer ${ownerToken}`);

  // The caller, or undefined when the token belongs to no one.
  async function authenticate(header: string | undefined): Promise<Caller | undefined> {
    if (timingSafeEqual(digest(header ?? ""), owner)) return null;
    const token = header?.match(/^Bearer (\S+)$/)?.[1];
    return token === undefined ? undefined : runtime.identify(token);
  }

  async function spawn(req: http.IncomingMessage, res: http.ServerResponse, caller: Caller) {
    const body = await readBody(req, MAX_BODY);
    if (body === undefined) return tooLarge(res, MAX_BODY);
    let grant: unknown;
    try {
      grant = JSON.parse(body)?.grant;
    } catch {
      return json(res, 400, { error: "the body is not JSON" });
    }
    if (!isGrant(grant)) return json(res, 400, { error: 'grant must be an object of "spawn" and "workspace", each a boolean, such as {"spawn": true}' });
    json(res, 201, await runtime.spawn(caller, grant));
  }

  // Runs a command in the caller's own workspace. A caller that hangs up
  // before the answer kills it: that's the response closing unfinished, not
  // the request closing, which happens as soon as the body has been read.
  async function command(req: http.IncomingMessage, res: http.ServerResponse, caller: Caller) {
    const hangUp = new AbortController();
    res.on("close", () => {
      if (!res.writableFinished) hangUp.abort();
    });
    const body = await readBody(req, MAX_COMMAND_BODY);
    if (body === undefined) return tooLarge(res, MAX_COMMAND_BODY);
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      return json(res, 400, { error: "the body is not JSON" });
    }
    const { command, timeout = DEFAULT_TIMEOUT } = (typeof parsed === "object" && parsed !== null ? parsed : {}) as { command?: unknown; timeout?: unknown };
    if (typeof command !== "string") return json(res, 400, { error: "command must be a string" });
    if (typeof timeout !== "number" || !(timeout >= 1 && timeout <= MAX_TIMEOUT)) return json(res, 400, { error: `timeout must be a number of seconds from 1 to ${MAX_TIMEOUT}` });
    // A caller that hung up while its body arrived gets nothing run.
    if (hangUp.signal.aborted) return;
    const { exitCode, output, timedOut, cut } = await runtime.runCommand(caller, command, timeout, hangUp.signal);
    json(res, 200, cut === undefined ? { exitCode, output, timedOut } : { exitCode, output, timedOut, cut });
  }

  // Reads or writes a file in the caller's own workspace, as raw bytes. A
  // caller that hangs up before the answer aborts the call, as for commands.
  async function file(req: http.IncomingMessage, res: http.ServerResponse, caller: Caller, query: string) {
    const hangUp = new AbortController();
    res.on("close", () => {
      if (!res.writableFinished) hangUp.abort();
    });
    const path = new URLSearchParams(query).get("path");
    if (path === null || path === "") return json(res, 400, { error: "path is required, as /workspace/files?path=<path>" });
    if (path.includes("\0")) return json(res, 400, { error: "path must not hold a NUL" });
    if (Buffer.byteLength(path) > MAX_PATH) return json(res, 400, { error: `path must be at most ${MAX_PATH} bytes` });
    if (req.method === "GET") {
      const bytes = await runtime.readFile(caller, path, hangUp.signal);
      return void res.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Length": bytes.length }).end(bytes);
    }
    const body = await readBytes(req, MAX_FILE);
    if (body === undefined) return tooLarge(res, MAX_FILE);
    // A caller that hung up while its body arrived gets nothing written.
    if (hangUp.signal.aborted) return;
    await runtime.writeFile(caller, path, body, hangUp.signal);
    res.writeHead(204).end();
  }

  // Relays a message or an event stream. A message carries its true sender,
  // and a stopped agent is started for it, then sent the runtime's notice, if
  // any, once the message is saved.
  async function relay(req: http.IncomingMessage, res: http.ServerResponse, caller: Caller, id: string, path: "/messages" | "/events") {
    const target: Address & { notice?: string } = path === "/messages" ? await runtime.messageTarget(caller, id) : await runtime.target(caller, id);
    // A caller that hung up while the target was looked up gets nothing opened
    // for it. From here on, its close handler is in place before any wait.
    if (res.destroyed) return;
    const headers: http.OutgoingHttpHeaders = { authorization: `Bearer ${target.token}` };
    for (const name of FORWARDED) if (req.headers[name] !== undefined) headers[name] = req.headers[name];
    if (path === "/messages") headers["jen-from"] = caller === null ? "owner" : caller.id;
    const upstream = http.request(new URL(path, target.url), { method: req.method, headers });
    upstream.on("response", (answer) => {
      const { notice } = target;
      if (notice !== undefined && answer.statusCode === 202) {
        runtime.notify(target, notice).catch((error) => process.stderr.write(`jen-runtime: agent ${id} wasn't sent its notice: ${error.message}\n`));
      }
      const passed = Object.entries(answer.headers).filter(([name]) => !HOP_BY_HOP.has(name));
      res.writeHead(answer.statusCode ?? 502, Object.fromEntries(passed));
      // An event stream may stay empty for a while, so send the headers now.
      res.flushHeaders();
      // An agent that stops or crashes mid-response cuts the caller's
      // response off too, so its stream ends and it can reconnect.
      pipeline(answer, res, () => {});
    });
    upstream.on("error", (error) => {
      if (res.headersSent) return void res.destroy();
      json(res, 502, { error: `agent ${id} could not be reached: ${error.message}` });
    });
    // A caller that hangs up ends the relayed request. A message the agent
    // saved stays saved.
    res.on("close", () => upstream.destroy());
    req.pipe(upstream);
  }

  async function route(req: http.IncomingMessage, res: http.ServerResponse) {
    const caller = await authenticate(req.headers.authorization);
    if (caller === undefined) throw new RuntimeError(401, "a valid bearer token is required");
    // The path is the request target up to its query. Parsing it as a URL
    // would read a target such as "//" as a host, and throw.
    const [path, query = ""] = (req.url ?? "/").split(/\?(.*)/s);
    const [empty, agents, id, action, ...rest] = path.split("/");
    const method = req.method;
    if (path === "/workspace/commands" && method === "POST") return command(req, res, caller);
    if (path === "/workspace/files" && (method === "GET" || method === "PUT")) return file(req, res, caller, query);
    if (empty === "" && agents === "agents" && rest.length === 0) {
      if (id === undefined) {
        if (method === "POST") return spawn(req, res, caller);
        if (method === "GET") return json(res, 200, await runtime.list(caller));
      } else if (id !== "" && action === undefined) {
        if (method === "GET") return json(res, 200, await runtime.get(caller, id));
        if (method === "DELETE") {
          await runtime.delete(caller, id);
          return void res.writeHead(204).end();
        }
      } else if (id !== "") {
        if (method === "POST" && action === "stop") return json(res, 200, await runtime.stop(caller, id));
        if (method === "POST" && action === "start") return json(res, 200, await runtime.start(caller, id));
        if (method === "POST" && action === "messages") return relay(req, res, caller, id, "/messages");
        if (method === "GET" && action === "events") return relay(req, res, caller, id, "/events");
      }
    }
    json(res, 404, { error: `no route for ${method} ${path}` });
  }

  // A request that fails ends with that request, never the runtime.
  return http.createServer((req, res) => {
    route(req, res).catch((error) => {
      if (res.headersSent) return void res.destroy();
      if (error instanceof RuntimeError) {
        if (error.status === 401) res.setHeader("WWW-Authenticate", "Bearer");
        return json(res, error.status, error.agent === undefined ? { error: error.message } : { error: error.message, agent: error.agent });
      }
      json(res, 500, { error: error instanceof Error ? error.message : String(error) });
    });
  });
}

// An object of known capabilities with boolean values, any of them missing,
// which the runtime reads as false. Unknown capabilities are refused, so
// nothing unchecked is stored as a grant.
function isGrant(value: unknown): value is Partial<Grant> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  return Object.entries(value).every(([key, granted]) => (key === "spawn" || key === "workspace") && typeof granted === "boolean");
}

// Hashing both sides gives them equal lengths for timingSafeEqual.
function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

// The body as text, or undefined once it would pass bound.
async function readBody(req: http.IncomingMessage, bound: number): Promise<string | undefined> {
  return (await readBytes(req, bound))?.toString("utf8");
}

// The body, or undefined once it would pass bound: a declared length is
// refused unread, and a chunked one stops being read where it crosses.
function readBytes(req: http.IncomingMessage, bound: number): Promise<Buffer | undefined> {
  if (Number(req.headers["content-length"] ?? 0) > bound) return Promise.resolve(undefined);
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const done = (body: Buffer | undefined) => {
      req.off("data", data).off("end", end).off("error", reject);
      resolve(body);
    };
    const data = (chunk: Buffer) => {
      size += chunk.length;
      if (size <= bound) return void chunks.push(chunk);
      req.pause();
      done(undefined);
    };
    const end = () => done(Buffer.concat(chunks));
    req.on("data", data).on("end", end).on("error", reject);
  });
}

// Closing the connection leaves the rest of the upload unread.
function tooLarge(res: http.ServerResponse, bound: number) {
  res.setHeader("Connection", "close");
  json(res, 413, { error: `the body is larger than ${bound} bytes` });
}

function json(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(body));
}
