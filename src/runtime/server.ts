// The runtime's API over HTTP. Every request carries a bearer token: the
// owner's, or the current token of a running agent. The caller is whoever the
// token belongs to, and every route that names an agent acts only on the
// caller's descendants, except that a caller may also message its parent. The
// runtime checks the token again when it acts, so one that stops being
// current while its request waits is refused then. Requests to an agent's
// protocol are relayed to it with its own token, which never leaves the
// runtime, and a message with its sender in Jen-From.

import { createHash, timingSafeEqual } from "node:crypto";
import http from "node:http";
import { pipeline } from "node:stream";
import { RuntimeError, type Address, type Caller, type Grant, type Runtime } from "./runtime.ts";

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

export function createRuntimeServer({ runtime, ownerToken }: RuntimeServerOptions): http.Server {
  const owner = digest(`Bearer ${ownerToken}`);

  // The caller, or undefined when the token belongs to no one.
  async function authenticate(header: string | undefined): Promise<Caller | undefined> {
    if (timingSafeEqual(digest(header ?? ""), owner)) return null;
    const token = header?.match(/^Bearer (\S+)$/)?.[1];
    return token === undefined ? undefined : runtime.identify(token);
  }

  async function spawn(req: http.IncomingMessage, res: http.ServerResponse, caller: Caller) {
    const body = await readBody(req);
    if (body === undefined) return tooLarge(res);
    let grant: unknown;
    try {
      grant = JSON.parse(body)?.grant;
    } catch {
      return json(res, 400, { error: "the body is not JSON" });
    }
    if (!isGrant(grant)) return json(res, 400, { error: 'grant must be {"spawn": <boolean>}' });
    json(res, 201, await runtime.spawn(caller, grant));
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
    const path = (req.url ?? "/").split("?")[0];
    const [empty, agents, id, action, ...rest] = path.split("/");
    const method = req.method;
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

// Exactly {"spawn": <boolean>}. Unknown capabilities are refused, so nothing
// unchecked is stored as a grant.
function isGrant(value: unknown): value is Grant {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.length === 1 && keys[0] === "spawn" && typeof (value as Grant).spawn === "boolean";
}

// Hashing both sides gives them equal lengths for timingSafeEqual.
function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

// The body, or undefined once it would pass MAX_BODY: a declared length is
// refused unread, and a chunked one stops being read where it crosses.
function readBody(req: http.IncomingMessage): Promise<string | undefined> {
  if (Number(req.headers["content-length"] ?? 0) > MAX_BODY) return Promise.resolve(undefined);
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const done = (body: string | undefined) => {
      req.off("data", data).off("end", end).off("error", reject);
      resolve(body);
    };
    const data = (chunk: Buffer) => {
      size += chunk.length;
      if (size <= MAX_BODY) return void chunks.push(chunk);
      req.pause();
      done(undefined);
    };
    const end = () => done(Buffer.concat(chunks).toString("utf8"));
    req.on("data", data).on("end", end).on("error", reject);
  });
}

// Closing the connection leaves the rest of the upload unread.
function tooLarge(res: http.ServerResponse) {
  res.setHeader("Connection", "close");
  json(res, 413, { error: `the body is larger than ${MAX_BODY} bytes` });
}

function json(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(body));
}
