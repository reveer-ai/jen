// The agent's protocol over HTTP. POST /messages runs a turn and answers with
// its reply. GET /events streams the conversation's saved items as
// Server-Sent Events, resuming after Last-Event-ID. Every request needs the
// agent's bearer token.

import { createHash, timingSafeEqual } from "node:crypto";
import http from "node:http";
import { respond } from "./respond.ts";
import type { Store } from "./store.ts";
import type { Model } from "./model/port.ts";

const KEEPALIVE_MS = 15_000;
// How many items a stream reads from the store at a time.
const PAGE = 100;

export function createServer({ store, model, token }: { store: Store; model: Model; token: string }): http.Server {
  const expected = digest(`Bearer ${token}`);
  // Each open stream, with the position of the last item it was sent.
  const streams = new Map<http.ServerResponse, number>();
  let busy = false;

  // Sends a stream the items saved since its last one. Called when a stream
  // opens, after each saved turn, and when a slow reader's socket drains; the
  // store is synchronous, so no turn can be saved partway through. A stream
  // whose buffer is full gets nothing more until it drains, so a reader that
  // stops reading holds at most one item beyond the socket's buffer.
  function deliver(res: http.ServerResponse) {
    while (!res.writableNeedDrain) {
      const page = store.after(streams.get(res)!, PAGE);
      if (page.length === 0) return;
      for (const { seq, item } of page) {
        streams.set(res, seq);
        if (!res.write(`id: ${seq}\nevent: item\ndata: ${JSON.stringify(item)}\n\n`)) return;
      }
    }
  }

  async function messages(req: http.IncomingMessage, res: http.ServerResponse) {
    // Checked on arrival and again once the body is in, since a body can
    // finish after a turn that started while it was uploading.
    if (busy) return json(res, 409, { error: "a turn is already running" });
    let text: unknown;
    try {
      text = JSON.parse(await readBody(req))?.text;
    } catch {
      return json(res, 400, { error: "the body is not JSON" });
    }
    if (typeof text !== "string" || text === "") {
      return json(res, 400, { error: "text must be a non-empty string" });
    }
    if (busy) return json(res, 409, { error: "a turn is already running" });

    // The turn carries on if the sender hangs up, and is saved all the same.
    busy = true;
    let reply: string;
    try {
      reply = await respond(store, model, text);
    } catch (error) {
      return json(res, 500, { error: error instanceof Error ? error.message : String(error) });
    } finally {
      busy = false;
    }
    for (const stream of streams.keys()) deliver(stream);
    json(res, 200, { reply });
  }

  function events(req: http.IncomingMessage, res: http.ServerResponse) {
    const lastEventId = Number(req.headers["last-event-id"]);
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
    // An empty conversation writes nothing yet, so send the headers now.
    res.flushHeaders();
    streams.set(res, Number.isSafeInteger(lastEventId) && lastEventId > 0 ? lastEventId : 0);
    res.on("drain", () => deliver(res));
    deliver(res);
    // A stream waiting to drain is still alive, and has data queued anyway.
    const keepalive = setInterval(() => res.writableNeedDrain || res.write(": keepalive\n\n"), KEEPALIVE_MS);
    res.on("close", () => {
      clearInterval(keepalive);
      streams.delete(res);
    });
  }

  async function route(req: http.IncomingMessage, res: http.ServerResponse) {
    const given = digest(req.headers.authorization ?? "");
    if (!timingSafeEqual(given, expected)) {
      res.setHeader("WWW-Authenticate", "Bearer");
      return json(res, 401, { error: "a valid bearer token is required" });
    }
    // The path is the request target up to its query. Parsing it as a URL
    // would read a target such as "//" as a host, and throw.
    const path = (req.url ?? "/").split("?")[0];
    if (req.method === "POST" && path === "/messages") return messages(req, res);
    if (req.method === "GET" && path === "/events") return events(req, res);
    json(res, 404, { error: `no route for ${req.method} ${path}` });
  }

  // A request that fails unexpectedly ends with that request, never the agent.
  return http.createServer((req, res) => {
    route(req, res).catch((error) => {
      if (res.headersSent) return void res.destroy();
      json(res, 500, { error: error instanceof Error ? error.message : String(error) });
    });
  });
}

// Hashing both sides gives them equal lengths for timingSafeEqual.
function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

async function readBody(req: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

function json(res: http.ServerResponse, status: number, body: object) {
  res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(body));
}
