// The agent's protocol over HTTP. POST /messages runs a turn and answers with
// its reply. GET /events streams the conversation's saved items as
// Server-Sent Events, resuming after Last-Event-ID. Every request needs the
// agent's bearer token.

import { createHash, timingSafeEqual } from "node:crypto";
import http from "node:http";
import { respond } from "./agent/respond.ts";
import type { Store } from "./agent/store.ts";
import type { Model } from "./model/port.ts";

const KEEPALIVE_MS = 15_000;

export function createServer({ store, model, token }: { store: Store; model: Model; token: string }): http.Server {
  const expected = digest(`Bearer ${token}`);
  // Each open stream, with the position of the last item it was sent.
  const streams = new Map<http.ServerResponse, number>();
  let busy = false;

  // Sends each stream the items saved since its last one. Called when a
  // stream opens and after each saved turn; the store is synchronous, so no
  // turn can be saved partway through.
  function deliver(res: http.ServerResponse) {
    let last = streams.get(res)!;
    for (const { seq, item } of store.after(last)) {
      res.write(`id: ${seq}\nevent: item\ndata: ${JSON.stringify(item)}\n\n`);
      last = seq;
    }
    streams.set(res, last);
  }

  async function messages(req: http.IncomingMessage, res: http.ServerResponse) {
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
    deliver(res);
    const keepalive = setInterval(() => res.write(": keepalive\n\n"), KEEPALIVE_MS);
    res.on("close", () => {
      clearInterval(keepalive);
      streams.delete(res);
    });
  }

  return http.createServer((req, res) => {
    const given = digest(req.headers.authorization ?? "");
    if (!timingSafeEqual(given, expected)) {
      res.setHeader("WWW-Authenticate", "Bearer");
      return json(res, 401, { error: "a valid bearer token is required" });
    }
    const path = new URL(req.url ?? "/", "http://agent").pathname;
    if (req.method === "POST" && path === "/messages") return void messages(req, res);
    if (req.method === "GET" && path === "/events") return events(req, res);
    json(res, 404, { error: `no route for ${req.method} ${path}` });
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
