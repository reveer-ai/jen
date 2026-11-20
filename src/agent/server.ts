// The agent's protocol over HTTP. POST /messages saves a message to the inbox
// and answers 202. GET /events streams the conversation's saved items as
// Server-Sent Events, resuming after Last-Event-ID, along with an error event
// for each failed model call and each notice, marked {"gaveUp": true} when
// it's a root's that it stopped trying, and a synced event, {"seq": <n>}, each time it
// has sent every item saved so far: when it opens, and after each later step.
// n is the position of the last item sent, or 0. GET /page serves jen's fixed page, which runs
// the agent's UI in a sandboxed frame (see ui/page.html), and GET /ui the
// latest UI the agent published, or the textbox, version 0, before it has
// published any. Every request needs the agent's bearer token, and a message
// needs its sender in Jen-From, which only the runtime sets.

import { createHash, timingSafeEqual } from "node:crypto";
import http from "node:http";
import type { Agent } from "./loop.ts";
import type { Store } from "./store.ts";
import { PAGE, TEXTBOX } from "./ui.ts";

const KEEPALIVE_MS = 15_000;
// How many items a stream reads from the store at a time.
const BATCH = 100;
// The most a message body may hold. A child can message its parent, so no
// agent may make another buffer an arbitrary upload.
export const MAX_MESSAGE = 1024 * 1024;
// The page's policy. A srcdoc frame inherits it, so it allows whatever the
// frame needs but network access, which only the page has (connect-src
// 'self'). frame-ancestors 'none' stops another site framing the page.
export const PAGE_POLICY =
  "default-src 'none'; script-src 'unsafe-inline' data:; style-src 'unsafe-inline' data:; img-src data: blob:; font-src data:; " +
  "media-src data: blob:; connect-src 'self'; frame-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

// An error event's data.
type Problem = { message: string; gaveUp?: true };

export function createServer({ store, agent, token }: { store: Store; agent: Agent; token: string }): http.Server {
  const expected = digest(`Bearer ${token}`);
  // Each open stream, with the position of the last item it was sent, the
  // error events waiting until it has every item saved before them, and the
  // position its last synced event named, if it has been sent one.
  const streams = new Map<http.ServerResponse, { seq: number; errors: Problem[]; synced?: number }>();

  // Sends a stream the items saved since its last one, then its waiting error
  // events, then, once it has every item saved so far and has been sent any
  // since its last synced, a synced event naming the last. Called when a
  // stream opens, after each save, after each error, and when a slow reader's
  // socket drains; the store is synchronous, so no step can be saved partway
  // through, and a synced never comes between one step's items. A stream
  // whose buffer is full gets nothing more until it drains, so a reader that
  // stops reading holds at most one event beyond the socket's buffer.
  function deliver(res: http.ServerResponse) {
    const stream = streams.get(res)!;
    let caughtUp = false;
    while (!res.writableNeedDrain) {
      const page = store.after(stream.seq, BATCH);
      if (page.length === 0) {
        caughtUp = true;
        break;
      }
      for (const { seq, item } of page) {
        stream.seq = seq;
        if (!res.write(`id: ${seq}\nevent: item\ndata: ${JSON.stringify(item)}\n\n`)) return;
      }
    }
    while (!res.writableNeedDrain && stream.errors.length > 0) {
      res.write(`event: error\ndata: ${JSON.stringify(stream.errors.shift())}\n\n`);
    }
    if (caughtUp && !res.writableNeedDrain && stream.synced !== stream.seq) {
      stream.synced = stream.seq;
      res.write(`event: synced\ndata: ${JSON.stringify({ seq: stream.seq })}\n\n`);
    }
  }

  const deliverAll = () => {
    for (const res of streams.keys()) deliver(res);
  };
  const sendError = (problem: Problem) => {
    for (const [res, stream] of streams) {
      stream.errors.push(problem);
      deliver(res);
    }
  };
  agent.on("saved", deliverAll);
  agent.on("failure", (message: string) => sendError({ message }));
  agent.on("notice", (message: string) => sendError({ message }));
  agent.on("gaveUp", (message: string) => sendError({ message, gaveUp: true }));

  async function messages(req: http.IncomingMessage, res: http.ServerResponse) {
    const body = await readBody(req);
    if (body === undefined) {
      // Closing the connection leaves the rest of the upload unread.
      res.setHeader("Connection", "close");
      return json(res, 413, { error: `the body is larger than ${MAX_MESSAGE} bytes` });
    }
    const from = req.headers["jen-from"];
    if (typeof from !== "string" || from === "") return json(res, 400, { error: "Jen-From must name the sender" });
    let parsed: { text?: unknown; urgent?: unknown };
    try {
      parsed = JSON.parse(body) ?? {};
    } catch {
      return json(res, 400, { error: "the body is not JSON" });
    }
    const { text, urgent = false } = parsed;
    // Empty text is an empty reply.
    if (typeof text !== "string") return json(res, 400, { error: "text must be a string" });
    if (typeof urgent !== "boolean") return json(res, 400, { error: "urgent must be a boolean" });

    agent.accept({ from, text, urgent });
    res.writeHead(202).end();
  }

  function events(req: http.IncomingMessage, res: http.ServerResponse) {
    const lastEventId = Number(req.headers["last-event-id"]);
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
    // An empty conversation writes nothing yet, so send the headers now.
    res.flushHeaders();
    // A root agent that gave up shows its notice to every watcher, after the
    // saved items.
    const seq = Number.isSafeInteger(lastEventId) && lastEventId > 0 ? lastEventId : 0;
    const { notice } = agent;
    streams.set(res, { seq, errors: notice === undefined ? [] : [agent.gaveUp ? { message: notice, gaveUp: true } : { message: notice }] });
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
    if (req.method === "GET" && path === "/page") {
      return void res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": PAGE_POLICY, "Cache-Control": "no-store" }).end(PAGE);
    }
    // JSON, so no route renders the document at the runtime's origin.
    if (req.method === "GET" && path === "/ui") return json(res, 200, store.latestUi() ?? { version: 0, document: TEXTBOX });
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

// The body, or undefined once it would pass MAX_MESSAGE: a declared length is
// refused unread, and a chunked one stops being read where it crosses.
function readBody(req: http.IncomingMessage): Promise<string | undefined> {
  if (Number(req.headers["content-length"] ?? 0) > MAX_MESSAGE) return Promise.resolve(undefined);
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const done = (body: string | undefined) => {
      req.off("data", data).off("end", end).off("error", reject);
      resolve(body);
    };
    const data = (chunk: Buffer) => {
      size += chunk.length;
      if (size <= MAX_MESSAGE) return void chunks.push(chunk);
      req.pause();
      done(undefined);
    };
    const end = () => done(Buffer.concat(chunks).toString("utf8"));
    req.on("data", data).on("end", end).on("error", reject);
  });
}

function json(res: http.ServerResponse, status: number, body: object) {
  res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(body));
}
