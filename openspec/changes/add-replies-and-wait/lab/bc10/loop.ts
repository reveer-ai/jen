// The agent's loop. All of its state is in its store: whether it has work, and
// what that work is, is read from the conversation and the inbox, so a
// restart resumes exactly where the last saved step left off. One step
// settles the outstanding tool calls, delivers the inbox, then calls the model.

import { EventEmitter, once } from "node:events";
import type { Item, Json, Model, ToolSpec } from "./model/port.ts";
import type { Inbound, Store } from "./store.ts";

export interface Tool extends ToolSpec {
  // Runs the tool. Once signal fires, its result is no longer wanted.
  run(input: Json, signal: AbortSignal): Promise<string>;
  // The result for a call that may have been running when the agent stopped,
  // when the tool knows more than that its outcome is unknown.
  interrupted?(input: Json): string | undefined;
  // LAB: the tool's spec for the next model call, from the conversation so far.
  specFor?(items: readonly Item[]): ToolSpec;
}

export const INTERRUPTED = "Error: interrupted before its result was saved, so whether it took effect is unknown.";
export const NOT_RUN_STOPPED = "Error: not run, because the agent was stopped first. Call it again if it's still wanted.";
export const NOT_RUN_URGENT = "Error: not run, because an urgent message arrived first. Call it again if it's still wanted.";
export const CANCELLED = "Error: cancelled by an urgent message before its result was saved, so whether it took effect is unknown.";
// How long to wait before each retry of a failed model call.
export const RETRY_DELAYS_MS = [1_000, 5_000, 25_000];

export interface AgentOptions {
  store: Store;
  model: Model;
  tools: readonly Tool[];
  instructions: string;
  // JEN_WAKE: the loop holds until a message is saved with this ID.
  wake?: string;
  // Sends the parent the notice that the agent gave up. A root agent has none,
  // since its parent, the owner, reads its event stream.
  report?: (text: string) => Promise<void>;
  delays?: readonly number[];
  // LAB: sends the parent a turn's final text. A root has none: its final text
  // is on its stream, where the owner reads it.
  reply?: (text: string) => Promise<void>;
  // LAB: offers the wait tool.
  wait?: boolean;
  // LAB: how a sender is named to the model.
  label?: (from: string) => string;
}

export const WAIT: ToolSpec = {
  name: "wait",
  description:
    "Wait for the next messages to arrive, and get them. Call it when you can't go on until someone answers, usually a sub-agent you've sent work to. Any message ends the wait: a reply, a message from your parent, or one from the runtime. Call it again if you're still waiting on others.",
  inputSchema: { type: "object", properties: {} },
};

// Emits "saved" after each save, "failure" with the message of each failed
// model call, and "notice" with the give-up notice when watchers should see it.
export class Agent extends EventEmitter {
  readonly #o: AgentOptions & { delays: readonly number[] };
  readonly #specs: ToolSpec[];
  #started = false;
  #held: boolean;
  #running = false;
  #loop: Promise<void> = Promise.resolve();
  // Cancels the model call, tool call or retry wait in flight.
  #inflight?: AbortController;
  #notice?: string;
  #waiting = false;

  constructor(options: AgentOptions) {
    super();
    this.#o = { delays: RETRY_DELAYS_MS, ...options };
    this.#specs = options.tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
    if (options.wait) this.#specs.push(WAIT);
    this.#held = options.wake !== undefined && !options.store.woken(options.wake);
  }

  // The give-up notice, while the agent has given up and has no parent to tell.
  get notice(): string | undefined {
    return this.#notice;
  }

  // Settles the batch a stop interrupted, then runs unless the start is held.
  start() {
    const outstanding = outstandingCalls(this.#o.store.load());
    outstanding.forEach((call, i) => {
      const interrupted = this.#o.tools.find((t) => t.name === call.name)?.interrupted?.(call.input);
      this.#result(call, i === 0 ? (interrupted ?? INTERRUPTED) : NOT_RUN_STOPPED);
    });
    this.#started = true;
    this.#kick();
  }

  // Saves a message to the inbox, ending any hold. An urgent one cancels the
  // step in flight.
  accept(message: Inbound) {
    this.#o.store.accept(message, this.#held ? this.#o.wake : undefined);
    this.#held = false;
    if (message.urgent && !this.#waiting) this.#inflight?.abort();
    this.emit("accepted");
    this.#kick();
  }

  // Resolves once the loop has nothing left to do.
  idle(): Promise<void> {
    return this.#loop;
  }

  #kick() {
    if (!this.#started || this.#held || this.#running) return;
    this.#loop = this.#run().catch((error) => void this.emit("failure", message(error)));
  }

  async #run() {
    this.#running = true;
    try {
      const { store, model, instructions, delays } = this.#o;
      let failures = 0;
      for (;;) {
        await this.#settle();
        if (store.deliver() > 0) this.emit("saved");
        if (!needsModel(store.load())) return;

        const controller = new AbortController();
        this.#inflight = controller;
        let response: Item[];
        try {
          const label = this.#o.label ?? ((f: string) => f);
          const items = store.load().map((i) => (i.type === "message" && i.role === "user" ? { ...i, from: label(i.from) } : i));
          const specs = this.#specs.map((spec) => this.#o.tools.find((t) => t.name === spec.name)?.specFor?.(items) ?? spec);
          response = await model.next(items, specs, instructions, controller.signal);
        } catch (error) {
          // A cancelled call isn't a failure: the next step delivers the
          // urgent message and calls the model again.
          if (!controller.signal.aborted) {
            this.emit("failure", message(error));
            if (failures === delays.length) {
              this.#inflight = undefined;
              await this.#giveUp(message(error));
              // A message that arrived while it gave up resumes the work.
              if (store.inbox().length === 0) return;
              failures = 0;
            } else {
              await sleep(delays[failures++]!, controller.signal);
            }
          }
          this.#inflight = undefined;
          continue;
        }
        this.#inflight = undefined;
        failures = 0;
        this.#notice = undefined;
        store.save(response);
        this.emit("saved");
        if (this.#o.reply && !response.some((item) => item.type === "tool_call")) {
          const text = response.map((item) => (item.type === "message" ? item.text : "")).join("").trim();
          if (text !== "") await this.#o.reply(text).catch((error) => this.emit("failure", `reply: ${message(error)}`));
        }
        if (!response.some((item) => item.type === "tool_call") && store.inbox().length === 0) return;
      }
    } finally {
      this.#running = false;
    }
  }

  // Runs the outstanding calls in order, saving each result before the next
  // starts. An urgent message in the inbox skips the rest of the batch.
  async #settle() {
    const isWait = (call: ToolCall) => this.#o.wait === true && call.name === "wait";
    // A wait runs after the batch's other calls, so its sends go out first.
    const all = outstandingCalls(this.#o.store.load());
    const outstanding = [...all.filter((c) => !isWait(c)), ...all.filter(isWait)];
    let waited = false;
    for (const [i, call] of outstanding.entries()) {
      if (isWait(call)) {
        if (waited) {
          this.#result(call, "Error: you already waited in this batch.");
          continue;
        }
        // LAB: the sub-agents that owe a reply are those sent a message since their last one.
        const owed = this.#owed();
        if (owed.size === 0 && this.#o.store.inbox().length === 0) {
          this.#result(call, "Nothing to wait for: none of your sub-agents owes you a reply.");
          waited = true;
          continue;
        }
        this.#waiting = true;
        while (this.#o.store.answerWait(call.id, (from) => this.#still(from), this.#o.label) === 0) await once(this, "accepted");
        this.#waiting = false;
        waited = true;
        this.emit("saved");
        continue;
      }
      if (this.#o.store.inbox().some((m) => m.urgent)) {
        for (const skipped of outstanding.slice(i)) this.#result(skipped, isWait(skipped) ? "Error: not run, because an urgent message arrived first." : NOT_RUN_URGENT);
        return;
      }
      const controller = new AbortController();
      this.#inflight = controller;
      const output = await runTool(this.#o.tools, call, controller.signal);
      this.#inflight = undefined;
      this.#result(call, output);
    }
  }

  // LAB: sub-agents sent a message since their last message back.
  #owed(extra: string[] = []): Set<string> {
    const owed = new Set<string>();
    const items = this.#o.store.load();
    // Only sends that were delivered count.
    const ok = new Set(items.filter((i) => i.type === "tool_result" && i.output.startsWith("delivered")).map((i) => (i as ToolResult).callId));
    for (const item of items) {
      if (item.type === "tool_call" && item.name === "message_sub_agent" && ok.has(item.id)) owed.add(String((item.input as { to?: unknown }).to));
      if (item.type === "message" && item.role === "user") owed.delete(item.from);
      if (item.type === "tool_result" && item.output.startsWith("From: ")) for (const m of item.output.matchAll(/^From: (\S+)$/gm)) owed.delete(m[1]!);
    }
    for (const from of extra) owed.delete(from);
    return owed;
  }

  #still(froms: string[]): string {
    const owed = [...this.#owed(froms)];
    return owed.length === 0 ? "Every sub-agent you sent work to has replied. End your turn with your result for your parent." : `Still working: ${owed.join(", ")}.`;
  }

  async #giveUp(error: string) {
    const text = `My model is failing, so I've stopped working. Error: ${error}. Message me to try again.`;
    if (this.#o.report) {
      try {
        return await this.#o.report(text);
      } catch {
        // Shown on the agent's own stream instead, as a root's is.
      }
    }
    this.#notice = text;
    this.emit("notice", text);
  }

  #result(call: ToolCall, output: string) {
    this.#o.store.save([{ type: "tool_result", callId: call.id, output }]);
    this.emit("saved");
  }
}

type ToolCall = Extract<Item, { type: "tool_call" }>;
type ToolResult = Extract<Item, { type: "tool_result" }>;

// The tool calls of the most recent model response that have no saved
// result, matched by ID. The conversation ends with that response, then the
// results saved so far, since messages are delivered only once every call
// has its result.
export function outstandingCalls(items: readonly Item[]): ToolCall[] {
  const answered = new Set<string>();
  let end = items.length;
  while (end > 0 && items[end - 1]!.type === "tool_result") answered.add((items[--end] as ToolResult).callId);
  let start = end;
  while (start > 0 && fromModel(items[start - 1]!)) start--;
  return items.slice(start, end).filter((item): item is ToolCall => item.type === "tool_call" && !answered.has(item.id));
}

const fromModel = (item: Item) => item.type === "tool_call" || (item.type === "message" && item.role === "assistant");

// Whether the conversation awaits the model: it has something the model
// hasn't answered yet.
function needsModel(items: readonly Item[]): boolean {
  const last = items.at(-1);
  return last !== undefined && !(last.type === "message" && last.role === "assistant");
}

async function runTool(tools: readonly Tool[], call: ToolCall, signal: AbortSignal): Promise<string> {
  const tool = tools.find((t) => t.name === call.name);
  if (tool === undefined) return `Error: unknown tool "${call.name}"`;
  try {
    return await new Promise<string>((resolve, reject) => {
      signal.addEventListener("abort", () => resolve(CANCELLED), { once: true });
      tool.run(call.input, signal).then(resolve, reject);
    });
  } catch (error) {
    return signal.aborted ? CANCELLED : `Error: ${message(error)}`;
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (clearTimeout(timer), resolve()), { once: true });
  });
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
