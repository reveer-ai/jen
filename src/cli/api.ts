// The owner's client of the runtime's API. The runtime's refusals are shown
// as it words them.

import type { Item } from "../agent/model/port.ts";
import type { Agent, Grant } from "../runtime/runtime.ts";

export type { Agent, Item };

// The runtime answered with an error status.
export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

// The runtime couldn't be reached at all.
export class Unanswered extends Error {
  constructor(cause: unknown) {
    super(`the runtime didn't answer: ${cause instanceof Error ? (cause.cause instanceof Error ? cause.cause.message : cause.message) : String(cause)}`);
    this.name = "Unanswered";
  }
}

// One Server-Sent Event: an item with its position, a synced event, an error
// event, or one jen doesn't know.
export type StreamEvent =
  | { type: "item"; seq: number; item: Item }
  | { type: "synced"; seq: number }
  // gaveUp marks a root's notice that it stopped trying after its model kept
  // failing.
  | { type: "error"; message: string; gaveUp: boolean }
  | { type: "other"; event: string };

export class Api {
  readonly base: string;
  readonly token: string;
  readonly #fetch: typeof fetch;

  constructor(base: string, token: string, fetcher: typeof fetch = globalThis.fetch) {
    this.base = base;
    this.token = token;
    this.#fetch = fetcher;
  }

  async #call(path: string, init: RequestInit = {}): Promise<Response> {
    let res: Response;
    try {
      res = await this.#fetch(`${this.base}${path}`, { ...init, headers: { authorization: `Bearer ${this.token}`, ...(init.headers as Record<string, string>) } });
    } catch (error) {
      if (init.signal?.aborted) throw error;
      throw new Unanswered(error);
    }
    if (res.ok) return res;
    const text = await res.text().catch(() => "");
    let message = text || `${res.status} ${res.statusText}`;
    try {
      message = JSON.parse(text).error ?? message;
    } catch {}
    throw new ApiError(res.status, message);
  }

  async #json<T>(path: string, init: RequestInit = {}): Promise<T> {
    return (await (await this.#call(path, init)).json()) as T;
  }

  spawn(name: string, grant: Partial<Grant>): Promise<Agent> {
    return this.#json("/agents", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ grant, name }) });
  }
  list(): Promise<Agent[]> {
    return this.#json("/agents");
  }
  get(id: string): Promise<Agent> {
    return this.#json(`/agents/${id}`);
  }
  start(id: string): Promise<Agent> {
    return this.#json(`/agents/${id}/start`, { method: "POST" });
  }
  stop(id: string): Promise<Agent> {
    return this.#json(`/agents/${id}/stop`, { method: "POST" });
  }
  async post(id: string, text: string): Promise<void> {
    const res = await this.#call(`/agents/${id}/messages`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) });
    await res.body?.cancel();
  }

  // The agent's event stream, after lastEventId when given, until it ends or
  // signal fires.
  async events(id: string, { lastEventId, signal }: { lastEventId?: number; signal?: AbortSignal } = {}): Promise<AsyncIterable<StreamEvent>> {
    const headers: Record<string, string> = { accept: "text/event-stream" };
    if (lastEventId !== undefined) headers["last-event-id"] = String(lastEventId);
    const res = await this.#call(`/agents/${id}/events`, { headers, signal });
    return parseEvents(res.body!);
  }
}

// Reads Server-Sent Events from body. A stream cut off mid-event drops the
// partial event, so a reader resuming after the last whole one misses nothing.
export async function* parseEvents(body: ReadableStream<Uint8Array<ArrayBuffer>>): AsyncIterable<StreamEvent> {
  const reader = body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  let event = "message";
  let id: string | undefined;
  let data: string[] = [];
  try {
    for (;;) {
      let chunk;
      try {
        chunk = await reader.read();
      } catch {
        // A connection cut off, or closed by the reader, ends the stream.
        return;
      }
      if (chunk.done) return;
      buffer += chunk.value;
      const lines = buffer.split(/\r\n|\n|\r(?!$)/);
      buffer = lines.pop()!;
      for (const line of lines) {
        if (line === "") {
          if (data.length > 0) yield toEvent(event, id, data.join("\n"));
          event = "message";
          id = undefined;
          data = [];
          continue;
        }
        if (line.startsWith(":")) continue;
        const colon = line.indexOf(":");
        const field = colon < 0 ? line : line.slice(0, colon);
        let value = colon < 0 ? "" : line.slice(colon + 1);
        if (value.startsWith(" ")) value = value.slice(1);
        if (field === "event") event = value;
        else if (field === "id") id = value;
        else if (field === "data") data.push(value);
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }
}

function toEvent(event: string, id: string | undefined, data: string): StreamEvent {
  try {
    const parsed = JSON.parse(data);
    if (event === "item" && id !== undefined) return { type: "item", seq: Number(id), item: parsed };
    if (event === "synced" && Number.isSafeInteger(parsed?.seq)) return { type: "synced", seq: parsed.seq };
    if (event === "error") return { type: "error", message: String(parsed?.message ?? data), gaveUp: parsed?.gaveUp === true };
  } catch {}
  return { type: "other", event };
}
