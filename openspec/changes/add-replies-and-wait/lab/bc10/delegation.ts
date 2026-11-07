// What an agent needs to work in a tree: who it is, the tools it uses to work
// with other agents through the runtime's API, and the system instructions
// that tell its model how. Every call to the runtime carries the agent's own
// token, and the runtime enforces what the agent may do.

import http from "node:http";
import type { Json } from "./model/port.ts";
import type { Tool } from "./loop.ts";
import { VARIANT, STYLE } from "./variant.ts";

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

  const sent =
    VARIANT === "bc"
      ? "delivered. The reply will come to you. Call wait when you have nothing else to do."
      : "delivered. The reply will start your next turn, after you end this one with an empty reply.";
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
      const urgent = field(input, "urgent") ?? undefined;
      if (urgent !== undefined && typeof urgent !== "boolean") throw new Error("urgent must be a boolean");
      if (to === identity.parent || ["owner", "the user", "your parent", "parent", ""].includes(to.trim().toLowerCase())) throw new Error("you answer your parent by ending your turn with your reply, not with message_sub_agent");
      await runtime.request("POST", `/agents/${encodeURIComponent(to)}/messages`, urgent ? { text: message, urgent } : { text: message }, signal);
      return sent;
    },
  };
  // With no sub-agents there is no one to send to.
  if (!identity.grant.spawn) return [];

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
      run: async (input, signal) => answer(own(await runtime.request("POST", "/agents", { grant: field(input, "grant") ?? null }, signal))),
    },
    {
      name: "list_agents",
      description: "List your sub-agents, with each one's grant and state.",
      inputSchema: { type: "object", properties: {} },
      run: async (_input, signal) => {
        const all = (await runtime.request("GET", "/agents", undefined, signal)) as { parent?: string }[];
        return answer(all.filter((a) => a.parent === identity.id).map(own) as Json);
      },
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
  const parentName = parent === "owner" ? "the user" : "your parent";
  const parentLine =
    STYLE === "anon"
      ? parent === "owner" ? "Your parent is the user." : "Your parent is the agent that started you."
      : parent === "owner" ? 'Your parent is the user, whose ID is "owner".' : `Your parent is agent ${parent}.`;
  const bc = VARIANT === "bc";
  const lines = [
    `${STYLE === "anon" ? "You are an agent in a tree of agents." : `You are agent ${id}, one of a tree of agents.`} ${parentLine} Your grant is ${JSON.stringify(grant)}${grant.spawn ? ", so you may start sub-agents of your own" : ", so you can't start sub-agents"}.`,
    `You work in turns. A turn begins when messages arrive and ends when you reply without calling a tool. That reply goes to ${parentName}, and it's the only way to answer: when ${parentName} asks you to send or report something, reply with it. So end your turn only when you have something for ${parentName}: your finished result, complete, in one reply, or a question only ${parentName} can answer. If the messages that woke you need nothing from you, end your turn with an empty reply.`,
    `Messages from others arrive as user messages that start with "From: <sender>"${STYLE === "anon" ? `, except messages from ${parentName}, which have no sender line` : ""}${bc ? ", or as the result of wait" : ""}. Messages from "runtime" report what happened to the tree of agents.`,
  ];
  if (grant.spawn) {
    lines.push(
      "Hand each piece of work to a sub-agent of your own with message_sub_agent. It returns at once, and the sub-agent's reply comes back to you. To start several tasks together, send them in one response. Let each sub-agent manage any sub-agents of its own. When you write a task, ask the sub-agent to reply with its result, not to send it.",
      bc
        ? "While your sub-agents work, carry on with your own part; replies that arrive reach you between steps. When you can't go on without an answer, call wait. Until the answer comes, leave the work alone: don't re-ask the agent doing it, don't do its work yourself, and don't give it to another agent."
        : "While your sub-agents work, carry on with your own part. When you can't go on without an answer, end your turn with an empty reply; the answer will start your next turn. Until it does, leave the work alone: don't re-ask the agent doing it, don't do its work yourself, and don't give it to another agent.",
      `If the work needs something only ${parentName} can tell you, ask for it before you hand the work out, by ending your turn with the question.`,
    );
  }
  lines.push("Every message wakes its receiver and costs it a model call, so send only a task, a question only the receiver can answer, or a result. Never acknowledge, thank or confirm, and never reply to a message that needs no reply.");
  if (grant.spawn) {
    lines.push("A plain message reaches a busy sub-agent after its current batch of work. An urgent one cancels its work in flight and makes it re-plan, so mark a message urgent only when waiting would cause harm or waste, such as a call that must be stopped.");
  }
  if (STYLE === "short") {
    const short = [
      lines[0],
      `You work in turns. When you reply without calling a tool, your turn ends and your reply goes to ${parentName}. That's how you answer ${parentName}: with your finished result, or with a question only ${parentName} can answer. If nothing needs answering, reply with nothing.`,
      `Messages from others start with "From: <sender>". Messages from "runtime" report what happened to the tree of agents.`,
    ];
    if (grant.spawn) {
      short.push(
        "To hand work to a sub-agent of your own, spawn it and give it the task with message_sub_agent. Its reply comes back to you. When you can't go on until a reply comes, call wait. Leave delegated work to the agent doing it.",
        "Every message costs its receiver a model call, so never acknowledge or thank. Mark a message urgent only when waiting would cause harm or waste.",
      );
    } else {
      short.push("Every message costs its receiver a model call, so never acknowledge or thank.");
    }
    return short.join("\n\n");
  }
  return lines.join("\n\n");
}

// LAB: the IDs of sub-agents this agent spawned and hasn't deleted, from its conversation.
function subAgents(items: readonly import("./model/port.ts").Item[]): string[] {
  const calls = new Map<string, string>();
  const ids = new Set<string>();
  for (const item of items) {
    if (item.type === "tool_call") calls.set(item.id, item.name === "delete_agent" ? `delete:${String((item.input as { id?: unknown }).id)}` : item.name);
    if (item.type === "tool_result") {
      const name = calls.get(item.callId);
      if (name === "spawn_agent") { try { ids.add(JSON.parse(item.output).id); } catch {} }
      if (name?.startsWith("delete:") && item.output === "done") ids.delete(name.slice(7));
    }
  }
  return [...ids];
}

// LAB: an agent sees no ID it can't message, so a sub-agent's parent, its own ID, is left out.
function own(agent: unknown): Json {
  const { parent: _parent, ...rest } = agent as Record<string, Json>;
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
