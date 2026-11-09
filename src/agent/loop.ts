// The agent's loop. All of its state is in its store: whether it has work, and
// what that work is, is read from the conversation and the inbox, so a
// restart resumes exactly where the last saved step left off. One step
// settles the outstanding tool calls, delivers the inbox, then calls the model.
// A turn's final text is the agent's reply to its parent, posted from the
// store's outbox. A wait call is answered by the loop from the inbox, and
// while it's open the loop holds nothing in memory.

import { EventEmitter } from "node:events";
import type { Item, Json, Model, ToolSpec } from "./model/port.ts";
import type { Inbound, Store } from "./store.ts";

export interface Tool extends ToolSpec {
  // Runs the tool. Once signal fires, its result is no longer wanted.
  run(input: Json, signal: AbortSignal): Promise<string>;
}

export const WAIT: ToolSpec = {
  name: "wait",
  description:
    "Wait for the next messages to arrive, and get them. Call it when you can't go on until someone answers, usually a sub-agent you've sent work to. Any message ends the wait: a reply, a message from your parent, or one from the runtime. Call it again if you're still waiting on others.",
  inputSchema: { type: "object", properties: {} },
};

export const INTERRUPTED = "Error: interrupted before its result was saved, so whether it took effect is unknown.";
export const NOT_RUN_STOPPED = "Error: not run, because the agent was stopped first. Call it again if it's still wanted.";
export const NOT_RUN_URGENT = "Error: not run, because an urgent message arrived first. Call it again if it's still wanted.";
export const CANCELLED = "Error: cancelled by an urgent message before its result was saved, so whether it took effect is unknown.";
export const WAITED = "Error: you already waited in this batch.";
export const STILL_WORKING = (ids: readonly string[]) => `Still working: ${ids.join(", ")}.`;
export const ALL_REPLIED = "Every sub-agent you sent work to has replied. End your turn with your result for your parent.";
export const NOTHING_TO_WAIT_FOR = "Nothing to wait for: none of your sub-agents owes you a reply.";
// How long to wait before each retry of a failed model call.
export const RETRY_DELAYS_MS = [1_000, 5_000, 25_000];

export interface AgentOptions {
  store: Store;
  model: Model;
  tools: readonly Tool[];
  instructions: string;
  // JEN_WAKE: the loop holds until a message is saved with this ID.
  wake?: string;
  // The parent's ID. Its messages reach the model with an empty sender.
  parent?: string;
  // Offers the model the wait tool, answered by the loop.
  wait?: boolean;
  // Posts an outbox entry to the parent, and resolves "gone" when the parent
  // no longer exists. signal aborts the attempt once its deadline passes. A
  // root agent has none: its parent, the owner, reads its replies on its
  // event stream.
  post?: (text: string, signal: AbortSignal) => Promise<"delivered" | "gone">;
  // How long to wait before each retry of a failed model call or post.
  delays?: readonly number[];
  // How long one post may take before it counts as failed.
  postDeadline?: number;
}

export const POST_DEADLINE_MS = 60_000;

// Emits "saved" after each save, "failure" with the message of each failed
// model call, and "notice" with a notice when watchers should see it: the
// give-up notice, or that a reply to the parent couldn't be sent.
export class Agent extends EventEmitter {
  readonly #o: AgentOptions & { delays: readonly number[] };
  readonly #specs: ToolSpec[];
  #started = false;
  #held: boolean;
  #running = false;
  #loop: Promise<void> = Promise.resolve();
  // Cancels the model call, tool call or retry wait in flight.
  #inflight?: AbortController;
  #gaveUp?: string;
  #unsent?: string;
  #posting = false;
  #outbox: Promise<void> = Promise.resolve();

  constructor(options: AgentOptions) {
    super();
    this.#o = { delays: RETRY_DELAYS_MS, ...options };
    this.#specs = options.tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
    if (options.wait) this.#specs.push(WAIT);
    this.#held = options.wake !== undefined && !options.store.woken(options.wake);
  }

  // The notice watchers should see: that a root gave up, or that a reply to
  // the parent is stuck in the outbox.
  get notice(): string | undefined {
    return this.#gaveUp ?? this.#unsent;
  }

  // Posts the outbox, settles the batch a stop interrupted, then runs unless
  // the start is held. An open wait that's the batch's only call stays open.
  start() {
    this.#post();
    const outstanding = this.#order(outstandingCalls(this.#o.store.load()));
    if (!(outstanding.length === 1 && this.#isWait(outstanding[0]!))) {
      outstanding.forEach((call, i) => this.#result(call, i === 0 ? INTERRUPTED : NOT_RUN_STOPPED));
    }
    this.#started = true;
    this.#kick();
  }

  // Saves a message to the inbox, ending any hold. An urgent one cancels the
  // step in flight. An empty message is never urgent, and one that arrives
  // after the turn ended is dropped, since the agent has moved on.
  accept(message: Inbound) {
    const empty = message.text === "";
    const discard = empty && turnEnded(this.#o.store.load());
    this.#o.store.accept(empty ? { ...message, urgent: false } : message, this.#held ? this.#o.wake : undefined, discard);
    this.#held = false;
    if (message.urgent && !empty) this.#inflight?.abort();
    this.#kick();
  }

  // Resolves once the loop has nothing left to do and the outbox nothing it
  // can post.
  async idle(): Promise<void> {
    await this.#loop;
    await this.#outbox;
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
        // The open wait is checked with no await before the return, so a
        // message accepted after the check starts the loop again.
        const wait = await this.#settle();
        if (wait !== undefined && !this.#answer(wait)) return;
        if (store.deliver(this.#o.parent) > 0) this.#saved();
        const items = store.load();
        if (!needsModel(items)) return store.dropEmpty();

        const controller = new AbortController();
        this.#inflight = controller;
        let response: Item[];
        try {
          response = await model.next(this.#forModel(items), this.#specs, instructions, controller.signal);
        } catch (error) {
          // A cancelled call isn't a failure: the next step delivers the
          // urgent message and calls the model again.
          if (!controller.signal.aborted) {
            this.emit("failure", message(error));
            if (failures === delays.length) {
              this.#inflight = undefined;
              await this.#giveUp(message(error));
              // A message that arrived while it gave up resumes the work.
              if (!hasMessage(store)) return;
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
        this.#gaveUp = undefined;
        if (response.some((item) => item.type === "tool_call")) {
          store.save(response);
          this.#saved();
          continue;
        }
        // The turn ends, and its final text is the reply.
        const reply = response.map((item) => (item.type === "message" && item.role === "assistant" ? item.text : "")).join("").trim();
        store.endTurn(response, this.#o.post ? reply : undefined);
        this.#saved();
        if (!hasMessage(store)) return;
      }
    } finally {
      this.#running = false;
    }
  }

  // Runs the outstanding calls in order, saving each result before the next
  // starts, and returns the batch's wait for the caller to answer. An urgent
  // message in the inbox skips the rest of the batch, but not its wait.
  async #settle(): Promise<ToolCall | undefined> {
    const outstanding = this.#order(outstandingCalls(this.#o.store.load()));
    const waits = outstanding.filter((call) => this.#isWait(call));
    const others = outstanding.filter((call) => !this.#isWait(call));
    for (const [i, call] of others.entries()) {
      if (this.#o.store.inbox().some((m) => m.urgent)) {
        for (const skipped of others.slice(i)) this.#result(skipped, NOT_RUN_URGENT);
        break;
      }
      const controller = new AbortController();
      this.#inflight = controller;
      const output = await runTool(this.#o.tools, call, controller.signal);
      this.#inflight = undefined;
      this.#result(call, output);
    }
    for (const extra of waits.slice(1)) this.#result(extra, WAITED);
    return waits[0];
  }

  // Answers a wait from the inbox once it holds a non-empty message, or once
  // no sub-agent owes a reply. Returns whether it answered.
  #answer(call: ToolCall): boolean {
    const { store, parent } = this.#o;
    if (store.owed().length > 0 && !hasMessage(store)) return false;
    store.answerWait(call.id, parent, (messages) => {
      const owed = store.owed();
      const status = owed.length > 0 ? STILL_WORKING(owed) : messages.length > 0 ? ALL_REPLIED : NOTHING_TO_WAIT_FOR;
      const shown = messages.map(({ from, text }) => (from === parent ? text : text === "" ? `From: ${from}` : `From: ${from}\n\n${text}`));
      return [...shown, status].join("\n\n---\n\n");
    });
    this.#saved();
    return true;
  }

  // The order the loop runs a batch's calls in: its waits after the rest.
  #order(calls: ToolCall[]): ToolCall[] {
    return [...calls.filter((call) => !this.#isWait(call)), ...calls.filter((call) => this.#isWait(call))];
  }

  #isWait(call: ToolCall): boolean {
    return this.#o.wait === true && call.name === WAIT.name;
  }

  // The conversation as the model sees it: the parent's messages have no sender.
  #forModel(items: Item[]): Item[] {
    const { parent } = this.#o;
    return items.map((item) => (item.type === "message" && item.role === "user" && item.from === parent ? { ...item, from: "" } : item));
  }

  async #giveUp(error: string) {
    const text = `My model is failing, so I've stopped working. Error: ${error}. Message me to try again.`;
    if (this.#o.post) {
      this.#o.store.queue(text);
      return this.#post();
    }
    this.#gaveUp = text;
    this.emit("notice", text);
  }

  #result(call: ToolCall, output: string) {
    this.#o.store.save([{ type: "tool_result", callId: call.id, output }]);
    this.#saved();
  }

  #saved() {
    this.emit("saved");
    this.#post();
  }

  // Posts the outbox to the parent, in order, unless a post is under way. An
  // entry that fails every retry stays, and the next save or start tries again.
  #post() {
    if (this.#posting || !this.#o.post) return;
    this.#outbox = this.#drain();
  }

  async #drain() {
    const { store, post, delays, postDeadline = POST_DEADLINE_MS } = this.#o;
    this.#posting = true;
    try {
      for (let next = store.outbox()[0]; next !== undefined; next = store.outbox()[0]) {
        for (let failures = 0; ; failures++) {
          try {
            await attempt(post!, next.text, postDeadline);
            break;
          } catch (error) {
            if (failures === delays.length) {
              this.#unsent = `A reply to my parent couldn't be sent. It stays in my outbox, and is sent again after my next step or start. Error: ${message(error)}.`;
              this.emit("notice", this.#unsent);
              return;
            }
            await new Promise((resolve) => setTimeout(resolve, delays[failures]!));
          }
        }
        store.sent(next.seq);
      }
      this.#unsent = undefined;
    } finally {
      this.#posting = false;
    }
  }
}

// One post, failed once its deadline passes, even by a post that ignores the
// signal, so an unanswered request can't hold the outbox.
async function attempt(post: NonNullable<AgentOptions["post"]>, text: string, deadline: number) {
  const signal = AbortSignal.timeout(deadline);
  const expired = new Promise<never>((_, reject) => {
    signal.addEventListener("abort", () => reject(new Error(`no answer within ${deadline / 1000} seconds`)), { once: true });
  });
  expired.catch(() => {});
  return Promise.race([post(text, signal), expired]);
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

// Whether the agent ended its turn and has started no other.
function turnEnded(items: readonly Item[]): boolean {
  return !needsModel(items) && outstandingCalls(items).length === 0;
}

// Whether the inbox holds a message that isn't empty.
function hasMessage(store: Store): boolean {
  return store.inbox().some((m) => m.text !== "");
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
