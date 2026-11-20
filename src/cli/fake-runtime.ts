// A stand-in of the runtime's API for the command's tests, served in-process.
// It keeps a tree of agents and each one's conversation, and streams events as
// an agent does: the saved items after Last-Event-ID, then synced, then each
// later step's items followed by synced.

import { randomBytes } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { Item } from "../agent/model/port.ts";
import type { Agent, Grant } from "../runtime/runtime.ts";

const NAME = /^[a-z][a-z0-9-]{0,31}$/;

export class FakeRuntime {
  token: string;
  readonly agents = new Map<string, Agent>();
  readonly conversations = new Map<string, Item[]>();
  // Every request, as "<method> <path>", in order.
  readonly requests: string[] = [];
  // Every message posted, in order.
  readonly messages: { id: string; text: string }[] = [];
  // The Last-Event-ID of each stream opened, or undefined.
  readonly opened: (string | undefined)[] = [];
  // Called after a message is accepted.
  onMessage: (id: string, text: string) => void = () => {};
  // A root's notice that it gave up, which a stream gets when it opens,
  // after the saved items, as an agent sends it.
  readonly gaveUp = new Map<string, string>();
  // Answers a request before it's routed, when it returns a status.
  intercept: (method: string, path: string) => number | undefined = () => undefined;
  readonly #streams = new Map<http.ServerResponse, { id: string; seq: number }>();
  #server?: http.Server;
  port = 0;

  constructor(token = randomBytes(32).toString("hex")) {
    this.token = token;
  }

  async listen(port = 0): Promise<number> {
    this.#server = http.createServer((req, res) => this.#route(req, res));
    await new Promise<void>((resolve) => this.#server!.listen(port, "127.0.0.1", resolve));
    this.port = (this.#server.address() as AddressInfo).port;
    return this.port;
  }

  async close() {
    if (!this.#server) return;
    this.#server.closeAllConnections();
    await new Promise((resolve) => this.#server!.close(resolve));
    this.#server = undefined;
  }

  // Adds an agent directly.
  add(agent: Partial<Agent> & { name?: string | null } = {}): Agent {
    const added: Agent = { id: randomBytes(6).toString("hex"), parent: null, name: null, grant: { spawn: true, workspace: true }, state: "running", ...agent };
    this.agents.set(added.id, added);
    this.conversations.set(added.id, []);
    return added;
  }

  // Saves one step's items to an agent's conversation and sends them to every
  // stream open on it, then synced. With partly, only that many of the items
  // reach the streams, and no synced, as when a stream is cut mid-step.
  save(id: string, items: Item[], { partly }: { partly?: number } = {}) {
    this.conversations.get(id)!.push(...items);
    for (const [res, stream] of this.#streams) if (stream.id === id) this.#deliver(res, stream, partly === undefined ? undefined : stream.seq + partly);
  }

  // Sends an error event to every stream open on the agent, marked as its
  // notice that it gave up when gaveUp is true.
  error(id: string, message: string, { gaveUp = false } = {}) {
    for (const [res, stream] of this.#streams) if (stream.id === id) res.write(errorEvent(message, gaveUp));
  }

  // Ends every stream open on the agent, as its container stopping does,
  // once what was written to it has gone.
  cut(id: string) {
    for (const [res, stream] of this.#streams) if (stream.id === id) res.end();
  }

  streams(id: string) {
    return [...this.#streams.values()].filter((s) => s.id === id).length;
  }

  #deliver(res: http.ServerResponse, stream: { id: string; seq: number }, upTo?: number) {
    const items = this.conversations.get(stream.id)!;
    for (; stream.seq < (upTo ?? items.length); stream.seq++) res.write(`id: ${stream.seq + 1}\nevent: item\ndata: ${JSON.stringify(items[stream.seq])}\n\n`);
    if (upTo === undefined) res.write(`event: synced\ndata: ${JSON.stringify({ seq: stream.seq })}\n\n`);
  }

  async #route(req: http.IncomingMessage, res: http.ServerResponse) {
    const json = (status: number, body: unknown) => res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
    const path = (req.url ?? "/").split("?")[0]!;
    const method = req.method!;
    this.requests.push(`${method} ${path}`);
    if (req.headers.authorization !== `Bearer ${this.token}`) return json(401, { error: "a valid bearer token is required" });
    const status = this.intercept(method, path);
    if (status !== undefined) return json(status, { error: `intercepted with ${status}` });
    let body = "";
    for await (const chunk of req) body += chunk;
    const [, , id, action] = path.split("/");
    const agent = id === undefined ? undefined : this.agents.get(id);
    if (path === "/agents" && method === "GET") return json(200, [...this.agents.values()]);
    if (path === "/agents" && method === "POST") {
      const { grant, name } = JSON.parse(body) as { grant: Grant; name?: string };
      if (typeof name !== "string" || !NAME.test(name)) return json(400, { error: "a root agent's name must be 1 to 32 lowercase letters, digits and hyphens, starting with a letter" });
      if ([...this.agents.values()].some((a) => a.parent === null && a.name === name)) return json(409, { error: `a root agent is already named ${name}` });
      return json(201, this.add({ name, grant: { spawn: !!grant.spawn, workspace: !!grant.workspace } }));
    }
    if (!agent) return json(404, { error: `no agent ${id}` });
    if (action === undefined && method === "GET") return json(200, agent);
    if (action === "start" && method === "POST") {
      agent.state = "running";
      return json(200, agent);
    }
    if (action === "stop" && method === "POST") {
      for (const a of this.agents.values()) if (a.id === agent.id || a.parent === agent.id) a.state = "stopped";
      this.cut(agent.id);
      return json(200, agent);
    }
    if (action === "messages" && method === "POST") {
      agent.state = "running";
      const { text } = JSON.parse(body) as { text: string };
      this.messages.push({ id: agent.id, text });
      res.writeHead(202).end();
      this.onMessage(agent.id, text);
      return;
    }
    if (action === "events" && method === "GET") {
      if (agent.state !== "running") return json(409, { error: `agent ${agent.id} is stopped` });
      const last = req.headers["last-event-id"] as string | undefined;
      this.opened.push(last);
      res.writeHead(200, { "content-type": "text/event-stream" });
      const stream = { id: agent.id, seq: last === undefined ? 0 : Number(last) };
      this.#streams.set(res, stream);
      res.on("close", () => this.#streams.delete(res));
      const notice = this.gaveUp.get(agent.id);
      if (notice === undefined) return this.#deliver(res, stream);
      this.#deliver(res, stream, this.conversations.get(agent.id)!.length);
      res.write(errorEvent(notice, true));
      res.write(`event: synced\ndata: ${JSON.stringify({ seq: stream.seq })}\n\n`);
      return;
    }
    json(404, { error: `no route for ${method} ${path}` });
  }
}

function errorEvent(message: string, gaveUp: boolean): string {
  return `event: error\ndata: ${JSON.stringify(gaveUp ? { message, gaveUp } : { message })}\n\n`;
}
