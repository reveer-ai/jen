// What an agent needs to work in a tree: who it is, the tools it uses to work
// with other agents through the runtime's API, and the system instructions
// that tell its model how. Every call to the runtime carries the agent's own
// token, and the runtime enforces what the agent may do.

import http from "node:http";
import type { Json } from "./model/port.ts";
import type { Tool } from "./loop.ts";
import type { Store } from "./store.ts";
import { uiTools } from "./ui.ts";
import { workspaceTools } from "./workspace.ts";

export interface Grant {
  spawn: boolean;
  workspace: boolean;
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
  if (!isGrant(grant)) throw new Error('JEN_GRANT must be a grant, such as {"spawn":false,"workspace":true}');
  if (env.JEN_WAKE === "") throw new Error("JEN_WAKE is set but empty");
  return { id: env.JEN_AGENT_ID!, parent: env.JEN_PARENT!, grant: { spawn: grant.spawn === true, workspace: grant.workspace === true }, wake: env.JEN_WAKE };
}

// Known capabilities with boolean values. One that's missing is false.
function isGrant(value: unknown): value is Partial<Grant> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  return Object.entries(value).every(([key, granted]) => (key === "spawn" || key === "workspace") && typeof granted === "boolean");
}

export const DELIVERED = "delivered. The reply will come to you. Call wait when you have nothing else to do.";
// The error for a send to anyone but a direct sub-agent. It names how to
// answer the parent, since that's what a send to a made-up name like "user"
// is after.
export const notSubAgent = (to: string) => `you have no sub-agent ${to}. To answer your parent, end your turn with your reply.`;

// A refusal from the runtime, with its status.
export class RuntimeRefusal extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(`the runtime answered ${status}: ${message}`);
    this.status = status;
  }
}

// The runtime's API, called with the agent's own token. A refusal throws a
// RuntimeRefusal with the runtime's status and message.
export class RuntimeClient {
  readonly #url: string;
  readonly #token: string;

  constructor(url: string, token: string) {
    this.#url = url;
    this.#token = token;
  }

  // The answer's body, parsed when it's JSON.
  async request(method: string, path: string, body?: Json, signal?: AbortSignal): Promise<Json | undefined> {
    const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    return parse(await this.#send(method, path, payload && { type: "application/json", bytes: payload }, signal));
  }

  // The exact bytes of the file at path in the agent's own workspace.
  readFile(path: string, signal?: AbortSignal): Promise<Buffer> {
    return this.#send("GET", filePath(path), undefined, signal);
  }

  // Writes bytes as the whole file at path in the agent's own workspace.
  async writeFile(path: string, bytes: Buffer, signal?: AbortSignal): Promise<void> {
    await this.#send("PUT", filePath(path), { type: "application/octet-stream", bytes }, signal);
  }

  // The answer's body as sent, or a RuntimeRefusal for a refusal.
  #send(method: string, path: string, body: { type: string; bytes: Buffer } | undefined, signal?: AbortSignal): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const headers: http.OutgoingHttpHeaders = { authorization: `Bearer ${this.#token}` };
      if (body !== undefined) Object.assign(headers, { "content-type": body.type, "content-length": body.bytes.length });
      const req = http.request(new URL(path, this.#url), { method, headers, signal }, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("error", reject);
        res.on("end", () => {
          const answer = Buffer.concat(chunks);
          const status = res.statusCode ?? 0;
          if (status < 400) return resolve(answer);
          const parsed = parse(answer);
          const message = typeof parsed === "object" && parsed !== null && "error" in parsed ? parsed.error : parsed;
          reject(new RuntimeRefusal(status, typeof message === "string" ? message : JSON.stringify(message)));
        });
      });
      req.on("error", reject);
      req.end(body?.bytes);
    });
  }
}

const filePath = (path: string) => `/workspace/files?path=${encodeURIComponent(path)}`;

// A body parsed as JSON, or its text when it isn't, or undefined when empty.
function parse(body: Buffer): Json | undefined {
  const text = body.toString("utf8");
  if (text === "") return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// Every tool the agent's grant allows: the delegation tools with spawn, the
// workspace tools with workspace, and publish_ui for a root with workspace.
export function toolsFor(identity: Identity, runtime: RuntimeClient, store: Pick<Store, "owe" | "clear" | "publish">): Tool[] {
  return [...delegationTools(identity, runtime, store), ...workspaceTools(identity, runtime), ...uiTools(identity, runtime, store)];
}

// The delegation tools: with spawn, message_sub_agent and the tools that
// manage sub-agents, and without it none, since it has no one to send to.
// debts is the record of which sub-agents owe a reply. No result
// shows the model an ID it can't message, such as a sub-agent's parent, which
// is the agent itself.
export function delegationTools(identity: Identity, runtime: RuntimeClient, debts: Pick<Store, "owe" | "clear">): Tool[] {
  if (!identity.grant.spawn) return [];
  const id = (input: Json) => text(input, "id");
  const agentPath = (input: Json, action = "") => `/agents/${encodeURIComponent(id(input))}${action}`;
  const answer = (value: Json | undefined) => (value === undefined ? "done" : JSON.stringify(value));
  const isSubAgent = async (to: string, signal?: AbortSignal) => {
    try {
      return field((await runtime.request("GET", `/agents/${encodeURIComponent(to)}`, undefined, signal)) ?? null, "parent") === identity.id;
    } catch (error) {
      if (error instanceof RuntimeRefusal && error.status === 404) return false;
      throw error;
    }
  };

  const send: Tool = {
    name: "message_sub_agent",
    description:
      "Send a task, or an answer to its question, to one of your sub-agents by its ID. It returns at once, and the sub-agent's reply will come back to you. " +
      "Set urgent only when waiting for the receiver's current batch of work would cause harm or waste: it cancels the receiver's work in flight.",
    inputSchema: {
      type: "object",
      properties: {
        to: { type: "string", description: "The sub-agent's ID." },
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
      // The runtime delivers to the parent and to every descendant, so the
      // tool checks that the receiver is its own sub-agent: a grandchild's
      // reply would go to its own parent, and this agent would wait forever.
      if (!(await isSubAgent(to, signal))) throw new Error(notSubAgent(to));
      // Recorded first, so a reply that comes back fast can't land before its debt.
      const added = debts.owe(to);
      try {
        await runtime.request("POST", `/agents/${encodeURIComponent(to)}/messages`, urgent ? { text: message, urgent } : { text: message }, signal);
      } catch (error) {
        if (added) debts.clear(to);
        if (error instanceof RuntimeRefusal && error.status === 404) throw new Error(notSubAgent(to));
        throw error;
      }
      return DELIVERED;
    },
  };

  const byId = { type: "object", properties: { id: { type: "string", description: "The sub-agent's ID." } }, required: ["id"] };
  // Stopping or deleting a sub-agent ends what it owes.
  const ending = async (input: Json, request: Promise<Json | undefined>) => {
    const value = await request;
    debts.clear(id(input));
    return answer(value === undefined ? undefined : withoutParent(value));
  };
  return [
    send,
    {
      name: "spawn_agent",
      description:
        "Start a new sub-agent of your own, and get its ID. With spawn true in its grant it may start sub-agents of its own; it can't have more than you. It starts with an empty conversation, so send it its task.",
      inputSchema: {
        type: "object",
        properties: { grant: { type: "object", properties: { spawn: { type: "boolean" }, workspace: { type: "boolean" } }, required: ["spawn"] } },
        required: ["grant"],
      },
      run: async (input, signal) => answer(withoutParent(await runtime.request("POST", "/agents", { grant: field(input, "grant") ?? null }, signal))),
    },
    {
      name: "list_agents",
      description: "List your sub-agents, with each one's grant and state.",
      inputSchema: { type: "object", properties: {} },
      run: async (_input, signal) => {
        const all = await runtime.request("GET", "/agents", undefined, signal);
        const mine = Array.isArray(all) ? all.filter((agent) => field(agent, "parent") === identity.id) : [];
        return answer(mine.map(withoutParent));
      },
    },
    {
      name: "stop_agent",
      description: "Stop a sub-agent and everything under it, keeping their conversations. Messaging a stopped agent starts it again.",
      inputSchema: byId,
      run: (input, signal) => ending(input, runtime.request("POST", agentPath(input, "/stop"), undefined, signal)),
    },
    {
      name: "start_agent",
      description: "Start a stopped sub-agent from its conversation. Its own sub-agents stay stopped.",
      inputSchema: byId,
      run: async (input, signal) => answer(withoutParent(await runtime.request("POST", agentPath(input, "/start"), undefined, signal))),
    },
    {
      name: "delete_agent",
      description: "Delete a sub-agent and everything under it, with their conversations. This can't be undone.",
      inputSchema: byId,
      run: (input, signal) => ending(input, runtime.request("DELETE", agentPath(input), undefined, signal)),
    },
  ];
}

// The system instructions: how agents work together. They name no agent ID,
// so the only IDs the model knows are its sub-agents'. They say nothing of a
// UI: publish_ui's description says what the agent needs (ui.ts).
export function instructions({ parent, grant }: Identity): string {
  const them = parent === "owner" ? "the user" : "your parent";
  const lines = [
    `You are an agent in a tree of agents. Your parent is ${parent === "owner" ? "the user" : "the agent that started you"}. Your grant is ${JSON.stringify(grant)}${grant.spawn ? ", so you may start sub-agents of your own" : ", so you can't start sub-agents"}.`,
    `You work in turns. A turn begins when messages arrive and ends when you reply without calling a tool. That reply goes to ${them}, and it's the only way to answer: when ${them} asks you to send or report something, reply with it. So end your turn only when you have something for ${them}: your finished result, complete, in one reply, or a question only ${them} can answer. If the messages that woke you need nothing from you, end your turn with an empty reply.`,
    `Messages from others arrive as user messages that start with "From: <sender>", except messages from ${them}, which have no sender line${grant.spawn ? ", or as the result of wait" : ""}. Messages from "runtime" report what happened to the tree of agents.`,
  ];
  if (grant.spawn) {
    lines.push(
      "Hand each piece of work to a sub-agent of your own with message_sub_agent. It returns at once, and the sub-agent's reply comes back to you. To start several tasks together, send them in one response. Let each sub-agent manage any sub-agents of its own. When you write a task, ask the sub-agent to reply with its result, not to send it.",
      "While your sub-agents work, carry on with your own part; replies that arrive reach you between steps. When you can't go on without an answer, call wait. Until the answer comes, leave the work alone: don't re-ask the agent doing it, don't do its work yourself, and don't give it to another agent.",
      'If "runtime" tells you a sub-agent has stopped and won\'t restart, start it again with start_agent, or delete it with delete_agent and do without it.',
      `If the work needs something only ${them} can tell you, ask for it before you hand the work out, by ending your turn with the question.`,
    );
  }
  lines.push("Every message wakes its receiver and costs it a model call, so send only a task, a question only the receiver can answer, or a result. Never acknowledge, thank or confirm, and never reply to a message that needs no reply.");
  if (grant.spawn) {
    lines.push("A plain message reaches a busy sub-agent after its current batch of work. An urgent one cancels its work in flight and makes it re-plan, so mark a message urgent only when waiting would cause harm or waste, such as a call that must be stopped.");
  }
  return lines.join("\n\n");
}

// An agent's record from the runtime, without its parent.
function withoutParent(agent: Json | undefined): Json {
  if (typeof agent !== "object" || agent === null || Array.isArray(agent)) return agent ?? null;
  const { parent: _parent, ...rest } = agent;
  return rest;
}

function field(input: Json, name: string): Json | undefined {
  return typeof input === "object" && input !== null && !Array.isArray(input) ? input[name] : undefined;
}

function text(input: Json, name: string): string {
  const value = field(input, name);
  if (typeof value !== "string" || value === "") throw new Error(`${name} must be a non-empty string`);
  return value;
}
