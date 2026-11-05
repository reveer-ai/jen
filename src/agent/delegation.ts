// What an agent needs to work in a tree: who it is, the tools it uses to work
// with other agents through the runtime's API, and the system instructions
// that tell its model how. Every call to the runtime carries the agent's own
// token, and the runtime enforces what the agent may do.

import http from "node:http";
import type { Json } from "./model/port.ts";
import type { Tool } from "./loop.ts";

export interface Grant {
  spawn: boolean;
}

export interface Identity {
  id: string;
  // The parent's agent ID, or "owner" for a root agent.
  parent: string;
  grant: Grant;
  // JEN_WAKE, when the runtime started the agent to deliver messages.
  wake?: string;
}

// Reads the agent's identity from its environment, and throws an error naming
// the first variable that's missing, empty or malformed.
export function readIdentity(env: NodeJS.ProcessEnv): Identity {
  for (const name of ["JEN_AGENT_ID", "JEN_PARENT", "JEN_GRANT"]) {
    if (!env[name]) throw new Error(`${name} is not set`);
  }
  let grant: unknown;
  try {
    grant = JSON.parse(env.JEN_GRANT!);
  } catch {
    // Reported below, as any other text that isn't a grant.
  }
  if (!isGrant(grant)) throw new Error('JEN_GRANT must be a grant, such as {"spawn":false}');
  if (env.JEN_WAKE === "") throw new Error("JEN_WAKE is set but empty");
  return { id: env.JEN_AGENT_ID!, parent: env.JEN_PARENT!, grant: { spawn: grant.spawn }, wake: env.JEN_WAKE };
}

function isGrant(value: unknown): value is Grant {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.length === 1 && keys[0] === "spawn" && typeof (value as Grant).spawn === "boolean";
}

export const DELIVERED = "delivered";
const OWNER_NOT_DELIVERED = "Error: interrupted before it was sent, so it wasn't delivered.";

// The runtime's API, called with the agent's own token. A refusal throws an
// error with the runtime's status and message.
export class RuntimeClient {
  readonly #url: string;
  readonly #token: string;

  constructor(url: string, token: string) {
    this.#url = url;
    this.#token = token;
  }

  // The answer's body, parsed when it's JSON.
  request(method: string, path: string, body?: Json, signal?: AbortSignal): Promise<Json | undefined> {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    return new Promise((resolve, reject) => {
      const headers: http.OutgoingHttpHeaders = { authorization: `Bearer ${this.#token}` };
      if (payload !== undefined) Object.assign(headers, { "content-type": "application/json", "content-length": Buffer.byteLength(payload) });
      const req = http.request(new URL(path, this.#url), { method, headers, signal }, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("error", reject);
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let parsed: Json | undefined;
          try {
            parsed = text === "" ? undefined : JSON.parse(text);
          } catch {
            parsed = text;
          }
          const status = res.statusCode ?? 0;
          if (status < 400) return resolve(parsed);
          const message = typeof parsed === "object" && parsed !== null && "error" in parsed ? parsed.error : parsed;
          reject(new Error(`the runtime answered ${status}: ${typeof message === "string" ? message : JSON.stringify(message)}`));
        });
      });
      req.on("error", reject);
      req.end(payload);
    });
  }
}

// The tools the agent's grant allows: send_message always, and the tools that
// manage sub-agents only with spawn.
export function delegationTools(identity: Identity, runtime: RuntimeClient): Tool[] {
  const root = identity.parent === "owner";
  const toOwner = (input: Json) => root && field(input, "to") === "owner";
  const agentPath = (input: Json, action = "") => `/agents/${encodeURIComponent(text(input, "id"))}${action}`;
  const answer = (value: Json | undefined) => (value === undefined ? "done" : JSON.stringify(value));

  const send: Tool = {
    name: "send_message",
    description:
      "Send a message to another agent by its ID: your parent, or one of your sub-agents. " +
      (root ? 'Your parent is the user, whose ID is "owner". ' : "") +
      "Set urgent only when waiting for the receiver's current batch of work would cause harm or waste: it cancels the receiver's work in flight.",
    inputSchema: {
      type: "object",
      properties: {
        to: { type: "string", description: "The receiver's ID." },
        text: { type: "string", description: "The message." },
        urgent: { type: "boolean", description: "Cancel the receiver's work in flight so it reads this at once." },
      },
      required: ["to", "text"],
    },
    async run(input, signal) {
      const to = text(input, "to");
      const message = text(input, "text");
      const urgent = field(input, "urgent");
      if (urgent !== undefined && typeof urgent !== "boolean") throw new Error("urgent must be a boolean");
      // The owner reads a root's event stream, where this call's result is the
      // delivery.
      if (toOwner(input)) return DELIVERED;
      await runtime.request("POST", `/agents/${encodeURIComponent(to)}/messages`, urgent ? { text: message, urgent } : { text: message }, signal);
      return DELIVERED;
    },
    // A send to the owner has no effect until its result is saved.
    interrupted: (input) => (toOwner(input) ? OWNER_NOT_DELIVERED : undefined),
  };
  if (!identity.grant.spawn) return [send];

  const byId = { type: "object", properties: { id: { type: "string", description: "The sub-agent's ID." } }, required: ["id"] };
  return [
    send,
    {
      name: "spawn_agent",
      description:
        "Start a new sub-agent of your own, and get its ID. With spawn true in its grant it may start sub-agents of its own; it can't have more than you. It starts with an empty conversation, so send it its task.",
      inputSchema: {
        type: "object",
        properties: { grant: { type: "object", properties: { spawn: { type: "boolean" } }, required: ["spawn"] } },
        required: ["grant"],
      },
      run: async (input, signal) => answer(await runtime.request("POST", "/agents", { grant: field(input, "grant") ?? null }, signal)),
    },
    {
      name: "list_agents",
      description: "List your sub-agents and theirs, with each one's parent, grant and state.",
      inputSchema: { type: "object", properties: {} },
      run: async (_input, signal) => answer(await runtime.request("GET", "/agents", undefined, signal)),
    },
    {
      name: "stop_agent",
      description: "Stop a sub-agent and everything under it, keeping their conversations. Messaging a stopped agent starts it again.",
      inputSchema: byId,
      run: async (input, signal) => answer(await runtime.request("POST", agentPath(input, "/stop"), undefined, signal)),
    },
    {
      name: "start_agent",
      description: "Start a stopped sub-agent from its conversation. Its own sub-agents stay stopped.",
      inputSchema: byId,
      run: async (input, signal) => answer(await runtime.request("POST", agentPath(input, "/start"), undefined, signal)),
    },
    {
      name: "delete_agent",
      description: "Delete a sub-agent and everything under it, with their conversations. This can't be undone.",
      inputSchema: byId,
      run: async (input, signal) => answer(await runtime.request("DELETE", agentPath(input), undefined, signal)),
    },
  ];
}

// The system instructions: who the agent is, and how agents work together.
export function instructions({ id, parent, grant }: Identity): string {
  const parentLine =
    parent === "owner" ? 'Your parent is the user, whose ID is "owner".' : `Your parent is agent ${parent}.`;
  return [
    `You are agent ${id}, one of a tree of agents. ${parentLine} Your grant is ${JSON.stringify(grant)}${grant.spawn ? ", so you may start sub-agents of your own" : ", so you can't start sub-agents"}.`,
    "Your text output reaches no one. Anything meant for another agent, the user included, must be sent with send_message, and that includes answering a question.",
    'Messages from others arrive as user messages that start with "From: <sender>". Messages from "runtime" report what happened to the tree of agents.',
    "To wait for an answer, end your turn. The answer will wake you.",
    "When your work is done, send your parent the result.",
    "Every message wakes its receiver and costs it a model call, so send only what the receiver needs, such as a question, a decision or a result. Don't narrate your progress, don't acknowledge, and don't reply to a message that needs no reply.",
    "A plain message reaches a busy receiver after its current batch of work. An urgent one cancels its work in flight and makes it re-plan, so mark a message urgent only when waiting would cause harm or waste, such as a call that must be stopped.",
  ].join("\n\n");
}

function field(input: Json, name: string): Json | undefined {
  return typeof input === "object" && input !== null && !Array.isArray(input) ? input[name] : undefined;
}

function text(input: Json, name: string): string {
  const value = field(input, name);
  if (typeof value !== "string" || value === "") throw new Error(`${name} must be a non-empty string`);
  return value;
}
