import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { Item, Json, Model, ToolSpec } from "./model/port.ts";
import { ScriptedModel } from "./model/scripted.ts";
import { Agent, ALL_REPLIED, CANCELLED, INTERRUPTED, NOT_RUN_STOPPED, NOT_RUN_URGENT, NOTHING_TO_WAIT_FOR, WAITED, type AgentOptions, type Tool } from "./loop.ts";
import { openStore, type Store } from "./store.ts";

const user = (text: string, from = "owner"): Item => ({ type: "message", role: "user", from, text });
const assistant = (text: string): Item => ({ type: "message", role: "assistant", text });
const call = (id: string, name: string, input: Json = {}): Item => ({ type: "tool_call", id, name, input });
const result = (callId: string, output: string): Item => ({ type: "tool_result", callId, output });
const plain = (text: string, from = "owner") => ({ from, text, urgent: false });
const urgent = (text: string, from = "owner") => ({ from, text, urgent: true });

function tool(name: string, run: (input: Json, signal: AbortSignal) => Promise<string> = async () => name.toUpperCase()): Tool {
  return { name, description: `The ${name} tool.`, inputSchema: { type: "object" }, run };
}

// A promise and the functions that settle it.
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => ((resolve = res), (reject = rej)));
  return { promise, resolve, reject };
}

// A model whose every call waits until the test answers it, and that fails
// with the signal's reason once its call is cancelled.
class HeldModel implements Model {
  readonly calls: { items: Item[]; tools: ToolSpec[]; instructions: string; answer: (items: Item[]) => void; fail: (error: Error) => void }[] = [];
  #waiting = deferred();

  next(items: readonly Item[], tools: readonly ToolSpec[], instructions: string, signal?: AbortSignal): Promise<Item[]> {
    const { promise, resolve, reject } = deferred<Item[]>();
    signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
    this.calls.push({ items: structuredClone([...items]), tools: [...tools], instructions, answer: resolve, fail: reject });
    this.#waiting.resolve();
    return promise;
  }

  // Resolves once the model has been called n times in all.
  async called(n: number) {
    while (this.calls.length < n) {
      this.#waiting = deferred();
      await this.#waiting.promise;
    }
    return this.calls[n - 1]!;
  }
}

let dir: string;
let store: Store;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "jen-loop-"));
  store = openStore(join(dir, "agent.db"));
});
afterEach(() => {
  vi.useRealTimers();
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

function agent(model: Model, tools: Tool[] = [], options: Partial<AgentOptions> = {}) {
  const made = new Agent({ store, model, tools, instructions: "", delays: [0, 0, 0], ...options });
  made.on("failure", () => {});
  return made;
}

// Starts an agent, sends it a message, and waits until it's idle.
async function run(model: Model, tools: Tool[], text = "go") {
  const a = agent(model, tools);
  a.start();
  a.accept(plain(text));
  await a.idle();
  return a;
}

describe("a model call is sent the whole conversation, the tools and the instructions", () => {
  test("first turn sends exactly the received message", async () => {
    const model = new ScriptedModel([[assistant("hi")]]);
    await run(model, [], "hello");
    expect(model.calls[0]!.items).toEqual([user("hello")]);
  });

  test("later turn sends the conversation, then the new message", async () => {
    store.save([user("hello"), assistant("hi")]);
    const model = new ScriptedModel([[assistant("fine")]]);
    await run(model, [], "how are you?");
    expect(model.calls[0]!.items).toEqual([user("hello"), assistant("hi"), user("how are you?")]);
  });

  test("every model call is sent every tool's description, and the instructions", async () => {
    const lookup = { ...tool("lookup"), inputSchema: { type: "object", properties: { key: { type: "string" } } } };
    const model = new ScriptedModel([[call("c1", "lookup")], [assistant("done")]]);
    const a = agent(model, [lookup, tool("other")], { instructions: "You are agent a1." });
    a.start();
    a.accept(plain("go"));
    await a.idle();
    const specs = [
      { name: "lookup", description: "The lookup tool.", inputSchema: lookup.inputSchema },
      { name: "other", description: "The other tool.", inputSchema: { type: "object" } },
    ];
    expect(model.calls.map((c) => [c.tools, c.instructions])).toEqual([
      [specs, "You are agent a1."],
      [specs, "You are agent a1."],
    ]);
  });
});

describe("the agent works while it has work", () => {
  test("the loop stops after a model call that calls no tool, when the inbox is empty", async () => {
    const model = new ScriptedModel([[assistant("hi")], [assistant("unused")]]);
    await run(model, [], "hello");
    expect(model.calls).toHaveLength(1);
    expect(store.load()).toEqual([user("hello"), assistant("hi")]);
  });

  test("the loop stops after the answer that follows tool use", async () => {
    const model = new ScriptedModel([[call("c1", "lookup")], [assistant("done")], [assistant("unused")]]);
    await run(model, [tool("lookup")]);
    expect(model.calls).toHaveLength(2);
  });

  test("a message waiting when the model answers is delivered, and the model called again", async () => {
    const model = new HeldModel();
    const a = agent(model);
    a.start();
    a.accept(plain("hello"));
    const first = await model.called(1);
    a.accept(plain("one more thing"));
    first.answer([assistant("hi")]);
    const second = await model.called(2);
    expect(second.items).toEqual([user("hello"), assistant("hi"), user("one more thing")]);
    second.answer([assistant("sure")]);
    await a.idle();
    expect(model.calls).toHaveLength(2);
  });

  test("an idle agent starts working when a message is accepted", async () => {
    const model = new ScriptedModel([[assistant("hi")], [assistant("again")]]);
    const a = await run(model, [], "hello");
    a.accept(plain("more"));
    await a.idle();
    expect(model.calls[1]!.items).toEqual([user("hello"), assistant("hi"), user("more")]);
  });

  test("an agent with nothing to do makes no model call when it starts", async () => {
    store.save([user("hello"), assistant("hi")]);
    const model = new ScriptedModel([]);
    const a = agent(model);
    a.start();
    await a.idle();
    expect(model.calls).toEqual([]);
  });

  test("an empty response ends the run", async () => {
    const model = new ScriptedModel([[], [assistant("unused")]]);
    await run(model, [], "hello");
    expect(model.calls).toHaveLength(1);
    expect(store.load()).toEqual([user("hello")]);
  });
});

describe("a step settles calls, delivers messages, then calls the model", () => {
  test("the response is saved before its tools run, and each result before the next call starts", async () => {
    const seen: Item[][] = [];
    const watch = (name: string) => tool(name, async () => (seen.push(store.load()), name.toUpperCase()));
    const model = new ScriptedModel([[assistant("checking"), call("c1", "a"), call("c2", "b")], [assistant("done")]]);
    await run(model, [watch("a"), watch("b")]);
    expect(seen).toEqual([
      [user("go"), assistant("checking"), call("c1", "a"), call("c2", "b")],
      [user("go"), assistant("checking"), call("c1", "a"), call("c2", "b"), result("c1", "A")],
    ]);
  });

  test("a plain message between two tool calls waits for both, then follows their results", async () => {
    const a1 = deferred<string>();
    const ran: string[] = [];
    const model = new ScriptedModel([[call("c1", "a"), call("c2", "b")], [assistant("done")]]);
    const a = agent(model, [tool("a", () => (ran.push("a"), a1.promise)), tool("b", async () => (ran.push("b"), "B"))]);
    a.start();
    a.accept(plain("go"));
    await vi.waitFor(() => expect(ran).toEqual(["a"]));
    a.accept(plain("by the way", "a1b2c3d4e5f6"));
    a1.resolve("A");
    await a.idle();
    expect(ran).toEqual(["a", "b"]);
    expect(model.calls[1]!.items).toEqual([
      user("go"),
      call("c1", "a"),
      call("c2", "b"),
      result("c1", "A"),
      result("c2", "B"),
      user("by the way", "a1b2c3d4e5f6"),
    ]);
  });

  test("a message never lands between a call and its result", async () => {
    const running = deferred();
    const done = deferred<string>();
    const model = new ScriptedModel([[call("c1", "a")], [assistant("done")]]);
    const a = agent(model, [tool("a", () => (running.resolve(), done.promise))]);
    a.start();
    a.accept(plain("go"));
    await running.promise;
    a.accept(plain("hello"));
    done.resolve("A");
    await a.idle();
    expect(store.load()).toEqual([user("go"), call("c1", "a"), result("c1", "A"), user("hello"), assistant("done")]);
  });
});

describe("tool failures are reported to the model", () => {
  test("a thrown error becomes an Error: result", async () => {
    const failing = tool("lookup", async () => {
      throw new Error("not found");
    });
    const model = new ScriptedModel([[call("c1", "lookup")], [assistant("sorry")]]);
    await run(model, [failing]);
    expect(model.calls[1]!.items.at(-1)).toEqual(result("c1", "Error: not found"));
  });

  test("an unknown tool becomes an Error: result naming it", async () => {
    const model = new ScriptedModel([[call("c1", "missing")], [assistant("sorry")]]);
    await run(model, []);
    const last = model.calls[1]!.items.at(-1)!;
    expect(last.type === "tool_result" && last.output).toMatch(/^Error:.*missing/);
  });
});

describe("an urgent message skips the rest of a batch", () => {
  test("an urgent message after A's result stops B, and follows both results", async () => {
    const ran: string[] = [];
    const model = new ScriptedModel([[call("c1", "a"), call("c2", "b")], [assistant("stopped")]]);
    const a = agent(model, [tool("a", async () => (ran.push("a"), "A")), tool("b", async () => (ran.push("b"), "B"))]);
    // Arrives the moment A's result is saved, before B would start.
    a.on("saved", function arrive() {
      if (store.load().at(-1)?.type !== "tool_result") return;
      a.off("saved", arrive);
      a.accept(urgent("don't run b"));
    });
    a.start();
    a.accept(plain("go"));
    await a.idle();
    expect(ran).toEqual(["a"]);
    expect(model.calls[1]!.items.slice(-3)).toEqual([result("c1", "A"), result("c2", NOT_RUN_URGENT), user("don't run b")]);
  });

  test("an urgent message to an idle agent is delivered like any other", async () => {
    const model = new ScriptedModel([[assistant("hi")], [assistant("ok")]]);
    const a = await run(model, [], "hello");
    a.accept(urgent("now"));
    await a.idle();
    expect(model.calls[1]!.items).toEqual([user("hello"), assistant("hi"), user("now")]);
  });
});

describe("an urgent message cancels the work in flight", () => {
  test("urgent during a model call cancels it with nothing saved, and the next call ends with the message", async () => {
    const model = new HeldModel();
    const failures: string[] = [];
    const a = agent(model);
    a.on("failure", (m: string) => failures.push(m));
    a.start();
    a.accept(plain("write the report"));
    await model.called(1);
    a.accept(urgent("stop, wrong file"));
    const second = await model.called(2);
    expect(second.items).toEqual([user("write the report"), user("stop, wrong file")]);
    second.answer([assistant("ok")]);
    await a.idle();
    expect(store.load()).toEqual([user("write the report"), user("stop, wrong file"), assistant("ok")]);
    expect(failures).toEqual([]);
  });

  test("urgent during a tool call cancels it, and skips the rest of its batch", async () => {
    const signals: AbortSignal[] = [];
    const ran: string[] = [];
    const slow = tool("a", (_input, signal) => (ran.push("a"), signals.push(signal), new Promise<string>(() => {})));
    const model = new ScriptedModel([[call("c1", "a"), call("c2", "b")], [assistant("ok")]]);
    const a = agent(model, [slow, tool("b", async () => (ran.push("b"), "B"))]);
    a.start();
    a.accept(plain("go"));
    await vi.waitFor(() => expect(ran).toEqual(["a"]));
    a.accept(urgent("stop"));
    await a.idle();
    expect(signals[0]!.aborted).toBe(true);
    expect(ran).toEqual(["a"]);
    expect(model.calls[1]!.items.slice(-3)).toEqual([result("c1", CANCELLED), result("c2", NOT_RUN_URGENT), user("stop")]);
  });
});

describe("a start never carries on an old batch", () => {
  test("a crash after A's result: B is interrupted, C not run, then the message waiting", async () => {
    store.save([user("go"), call("c1", "a"), call("c2", "b"), call("c3", "c")]);
    store.save([result("c1", "A")]);
    store.accept(plain("status?"));
    const ran: string[] = [];
    const tools = ["a", "b", "c"].map((name) => tool(name, async () => (ran.push(name), name)));
    const model = new ScriptedModel([[assistant("ok")]]);
    const a = agent(model, tools);
    a.start();
    await a.idle();
    expect(ran).toEqual([]);
    expect(model.calls[0]!.items).toEqual([
      user("go"),
      call("c1", "a"),
      call("c2", "b"),
      call("c3", "c"),
      result("c1", "A"),
      result("c2", INTERRUPTED),
      result("c3", NOT_RUN_STOPPED),
      user("status?"),
    ]);
  });

  test("a crash between two results of one response interrupts the second call only", async () => {
    store.save([user("go"), call("c1", "a"), assistant("and then"), call("c2", "b")]);
    store.save([result("c1", "A")]);
    const model = new ScriptedModel([[assistant("ok")]]);
    const a = agent(model, [tool("a"), tool("b")]);
    a.start();
    await a.idle();
    expect(store.load().slice(4)).toEqual([result("c1", "A"), result("c2", INTERRUPTED), assistant("ok")]);
  });

  test("a finished spawn isn't repeated", async () => {
    store.save([user("go"), call("c1", "spawn_agent", { grant: { spawn: false } })]);
    store.save([result("c1", '{"id":"a1b2c3d4e5f6"}')]);
    const spawned: Json[] = [];
    const model = new ScriptedModel([[assistant("spawned")]]);
    const a = agent(model, [tool("spawn_agent", async (input) => (spawned.push(input), "{}"))]);
    a.start();
    await a.idle();
    expect(spawned).toEqual([]);
    expect(model.calls).toHaveLength(1);
  });
});

describe("a waking start holds the loop until a message arrives", () => {
  test("a woken batch that never started: the first model call has the recovery results, then the waking message", async () => {
    store.save([user("go"), call("c1", "a"), call("c2", "b")]);
    const model = new ScriptedModel([[assistant("ok")]]);
    const a = agent(model, [tool("a"), tool("b")], { wake: "w1" });
    a.start();
    await a.idle();
    expect(model.calls).toEqual([]);
    a.accept(plain("don't do b", "a1b2c3d4e5f6"));
    await a.idle();
    expect(model.calls[0]!.items.slice(-3)).toEqual([result("c1", INTERRUPTED), result("c2", NOT_RUN_STOPPED), user("don't do b", "a1b2c3d4e5f6")]);
    expect(store.woken("w1")).toBe(true);
  });

  test("a notice that arrives during the first model call keeps the loop going", async () => {
    const model = new HeldModel();
    const a = agent(model, [], { wake: "w1" });
    a.start();
    a.accept(plain("hello"));
    const first = await model.called(1);
    a.accept(plain("Your sub-agents x are still stopped.", "runtime"));
    first.answer([assistant("hi")]);
    const second = await model.called(2);
    expect(second.items.at(-1)).toEqual(user("Your sub-agents x are still stopped.", "runtime"));
    second.answer([assistant("noted")]);
    await a.idle();
  });

  test("a crash restart after the waking message resumes at once", async () => {
    store.accept(plain("hello"), "w1");
    const model = new ScriptedModel([[assistant("hi")]]);
    const a = agent(model, [], { wake: "w1" });
    a.start();
    await a.idle();
    expect(model.calls).toHaveLength(1);
  });

  test("when the waking message never comes, any later message ends the hold", async () => {
    store.save([user("go"), call("c1", "a")]);
    const model = new ScriptedModel([[assistant("ok")]]);
    const a = agent(model, [tool("a")], { wake: "w1" });
    a.start();
    await a.idle();
    expect(model.calls).toEqual([]);
    a.accept(plain("still there?", "a1b2c3d4e5f6"));
    await a.idle();
    expect(model.calls).toHaveLength(1);
  });

  test("a start without a wake ID runs at once", async () => {
    store.save([user("hello")]);
    const model = new ScriptedModel([[assistant("hi")]]);
    const a = agent(model);
    a.start();
    await a.idle();
    expect(model.calls).toHaveLength(1);
  });
});

// A model that fails its first n calls, then plays back the script.
function failing(n: number, turns: Item[][], error = "model unreachable") {
  const scripted = new ScriptedModel(turns);
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    next(...args: Parameters<Model["next"]>) {
      return ++calls <= n ? Promise.reject(new Error(error)) : scripted.next(...args);
    },
  };
}

describe("a failed model call is retried, then the agent waits", () => {
  test("the retries wait 1, 5 and 25 seconds", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const model = failing(3, [[assistant("hi")]]);
    const a = new Agent({ store, model, tools: [], instructions: "" });
    a.on("failure", () => {});
    a.start();
    a.accept(plain("hello"));
    await vi.advanceTimersByTimeAsync(999);
    expect(model.calls).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(model.calls).toBe(2);
    await vi.advanceTimersByTimeAsync(4_999);
    expect(model.calls).toBe(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(model.calls).toBe(3);
    await vi.advanceTimersByTimeAsync(25_000);
    await a.idle();
    expect(model.calls).toBe(4);
    expect(store.load()).toEqual([user("hello"), assistant("hi")]);
  });

  test("a transient failure is retried, the response saved and the loop goes on", async () => {
    const failures: string[] = [];
    const model = failing(1, [[call("c1", "a")], [assistant("done")]]);
    const a = agent(model, [tool("a")]);
    a.on("failure", (m: string) => failures.push(m));
    a.start();
    a.accept(plain("go"));
    await a.idle();
    expect(failures).toEqual(["model unreachable"]);
    expect(store.load()).toEqual([user("go"), call("c1", "a"), result("c1", "A"), assistant("done")]);
  });

  test("a failure mid-turn keeps the steps already saved and saves nothing for the failed call", async () => {
    const scripted = new ScriptedModel([[call("c1", "a")]]);
    const a = agent(scripted, [tool("a")]);
    a.start();
    a.accept(plain("go"));
    await a.idle();
    expect(store.load()).toEqual([user("go"), call("c1", "a"), result("c1", "A")]);
  });

  test("after every retry fails the loop stops, and a later message resumes it with a model call", async () => {
    const model = failing(4, [[assistant("back")]]);
    const a = agent(model, [], { post: async () => "delivered" });
    a.start();
    a.accept(plain("hello"));
    await a.idle();
    expect(model.calls).toBe(4);
    a.accept(plain("try again"));
    await a.idle();
    expect(model.calls).toBe(5);
    expect(store.load()).toEqual([user("hello"), user("try again"), assistant("back")]);
  });

  test("a start with an unanswered message calls the model", async () => {
    store.save([user("hello")]);
    const model = new ScriptedModel([[assistant("hi")]]);
    const a = agent(model);
    a.start();
    await a.idle();
    expect(store.load()).toEqual([user("hello"), assistant("hi")]);
  });
});

describe("an agent that gives up tells its parent", () => {
  const notice = "My model is failing, so I've stopped working. Error: rate limited. Message me to try again.";

  test("a sub-agent sends its parent the notice through its outbox, with the provider's error", async () => {
    const reported: string[] = [];
    const a = agent(failing(4, [], "rate limited"), [], { parent: "a1b2c3d4e5f6", post: async (text) => (reported.push(text), "delivered") });
    a.start();
    a.accept(plain("go", "a1b2c3d4e5f6"));
    await a.idle();
    expect(reported).toEqual([notice]);
    expect(store.outbox()).toEqual([]);
    expect(a.notice).toBeUndefined();
  });

  test("a root agent shows the notice to its watchers instead, until it works again", async () => {
    const shown: string[] = [];
    const model = failing(4, [[assistant("back")]], "rate limited");
    const a = agent(model);
    a.on("notice", (text: string) => shown.push(text));
    a.start();
    a.accept(plain("go"));
    await a.idle();
    expect(shown).toEqual([notice]);
    expect(a.notice).toBe(notice);
    a.accept(plain("try again"));
    await a.idle();
    expect(a.notice).toBeUndefined();
  });

  test("a notice that can't be sent stays in the outbox, and the stream says so", async () => {
    const a = agent(failing(4, [], "rate limited"), [], { parent: "a1b2c3d4e5f6", post: () => Promise.reject(new Error("runtime unreachable")) });
    a.start();
    a.accept(plain("go", "a1b2c3d4e5f6"));
    await a.idle();
    expect(store.outbox().map((o) => o.text)).toEqual([notice]);
    expect(a.notice).toMatch(/couldn't be sent.*runtime unreachable/);
  });
});

// A post to the parent that records what it was sent.
function poster(answers: ("delivered" | "gone" | Error)[] = []) {
  const sent: string[] = [];
  const post = async (text: string) => {
    sent.push(text);
    const next = answers.shift() ?? "delivered";
    if (next instanceof Error) throw next;
    return next;
  };
  return { sent, post };
}
const P = "p0p0p0p0p0p0";
const fromParent = (text: string) => plain(text, P);
const waitCall = (id: string) => call(id, "wait");

describe("a turn's final text is the agent's reply to its parent", () => {
  test("a sub-agent's final text is posted to its parent", async () => {
    const { sent, post } = poster();
    const a = agent(new ScriptedModel([[assistant("Herons wait "), assistant("in reeds")]]), [], { parent: P, post });
    a.start();
    a.accept(fromParent("write a haiku"));
    await a.idle();
    expect(sent).toEqual(["Herons wait in reeds"]);
    expect(store.outbox()).toEqual([]);
  });

  test("an empty final text sends nothing when no reply is owed", async () => {
    const { sent, post } = poster();
    const a = agent(new ScriptedModel([[assistant("")]]), [], { parent: P, post });
    a.start();
    a.accept(plain("a sub-agent stopped", "runtime"));
    await a.idle();
    expect(sent).toEqual([]);
  });

  test("an empty final text sends an empty reply when one is owed", async () => {
    const { sent, post } = poster();
    const a = agent(new ScriptedModel([[assistant("")]]), [], { parent: P, post });
    a.start();
    a.accept(fromParent("Thanks"));
    await a.idle();
    expect(sent).toEqual([""]);
  });

  test("a message from the parent in a wait result owes a reply", async () => {
    const { sent, post } = poster();
    store.owe("a1");
    store.save([user("go", P), waitCall("w1")]);
    const a = agent(new ScriptedModel([[assistant("")]]), [], { parent: P, post, wait: true });
    a.start();
    a.accept(fromParent("Never mind."));
    await a.idle();
    expect(sent).toEqual([""]);
  });

  test("a root posts nothing: its reply is the assistant message on its stream", async () => {
    const a = agent(new ScriptedModel([[assistant("Canberra")]]), [], { parent: "owner" });
    a.start();
    a.accept(plain("What's the capital of Australia?"));
    await a.idle();
    expect(store.outbox()).toEqual([]);
    expect(store.load().at(-1)).toEqual(assistant("Canberra"));
  });
});

describe("replies are posted from the outbox", () => {
  test("a post that fails once is retried, and the parent gets the reply once", async () => {
    const { sent, post } = poster([new Error("busy")]);
    const a = agent(new ScriptedModel([[assistant("done")]]), [], { parent: P, post });
    a.start();
    a.accept(fromParent("go"));
    await a.idle();
    expect(sent).toEqual(["done", "done"]);
    expect(store.outbox()).toEqual([]);
    expect(a.notice).toBeUndefined();
  });

  test("a reply saved before a crash is posted on start, before the loop runs", async () => {
    store.endTurn([user("go", P), assistant("done")], "done");
    const order: string[] = [];
    const model: Model = { next: async () => (order.push("model"), [assistant("again")]) };
    const a = agent(model, [], { parent: P, post: async (text) => (order.push(`post ${text}`), "delivered") });
    store.accept(fromParent("more"));
    a.start();
    await a.idle();
    expect(order).toEqual(["post done", "model", "post again"]);
  });

  test("a reply that fails every retry stays, the stream shows a notice, and the next save posts it", async () => {
    const down = new Error("parent unreachable");
    const { sent, post } = poster([down, down, down, down]);
    const shown: string[] = [];
    const a = agent(new ScriptedModel([[assistant("done")], [call("c1", "a")], [assistant("")]]), [tool("a")], { parent: P, post });
    a.on("notice", (text: string) => shown.push(text));
    a.start();
    a.accept(fromParent("go"));
    await a.idle();
    expect(sent).toHaveLength(4);
    expect(store.outbox().map((o) => o.text)).toEqual(["done"]);
    expect(shown).toHaveLength(1);
    expect(a.notice).toMatch(/couldn't be sent.*parent unreachable/);
    a.accept(plain("next", "runtime"));
    await a.idle();
    expect(sent.at(-1)).toBe("done");
    expect(store.outbox()).toEqual([]);
    expect(a.notice).toBeUndefined();
  });

  test("a post the runtime answers 404 for is deleted, not sent again", async () => {
    const { sent, post } = poster(["gone"]);
    const a = agent(new ScriptedModel([[assistant("done")]]), [], { parent: P, post });
    a.start();
    a.accept(fromParent("go"));
    await a.idle();
    expect(sent).toEqual(["done"]);
    expect(store.outbox()).toEqual([]);
  });
});

describe("the parent's messages reach the model with no sender", () => {
  test("a message from the parent has an empty sender for the model, and keeps its own in the store", async () => {
    const model = new ScriptedModel([[assistant("ok")]]);
    const a = agent(model, [], { parent: P });
    a.start();
    a.accept(fromParent("write a haiku"));
    a.accept(plain("done: the haiku", "a1"));
    await a.idle();
    expect(model.calls[0]!.items).toEqual([user("write a haiku", ""), user("done: the haiku", "a1")]);
    expect(store.load()[0]).toEqual(user("write a haiku", P));
  });

  test("a root's first message, from the owner, has an empty sender", async () => {
    const model = new ScriptedModel([[assistant("hi")]]);
    const a = agent(model, [], { parent: "owner" });
    a.start();
    a.accept(plain("hello"));
    await a.idle();
    expect(model.calls[0]!.items).toEqual([user("hello", "")]);
  });
});

describe("an empty message never wakes the agent", () => {
  test("after the turn ended, it calls no model and is dropped, and it clears its sender's debt", async () => {
    const model = new ScriptedModel([[assistant("the haiku")]]);
    const a = agent(model, [], { parent: "owner" });
    a.start();
    a.accept(plain("go"));
    await a.idle();
    store.owe("a1");
    a.accept(plain("", "a1"));
    await a.idle();
    expect(model.calls).toHaveLength(1);
    expect(store.inbox()).toEqual([]);
    expect(store.owed()).toEqual([]);
  });

  test("one that arrives during a step never reaches the model, and is dropped when the turn ends", async () => {
    const gate = deferred<string>();
    const model = new ScriptedModel([[call("c1", "slow")], [assistant("done")]]);
    const a = agent(model, [tool("slow", () => gate.promise)], { parent: "owner" });
    a.start();
    a.accept(plain("go"));
    await vi.waitFor(() => expect(store.load()).toHaveLength(2));
    a.accept({ from: "a1", text: "", urgent: true });
    gate.resolve("SLOW");
    await a.idle();
    expect(model.calls).toHaveLength(2);
    expect(model.calls[1]!.items).toEqual([user("go", ""), call("c1", "slow"), result("c1", "SLOW")]);
    expect(store.inbox()).toEqual([]);
  });

  test("while others still work, it stays until the next reply ends the wait", async () => {
    store.owe("a1");
    store.owe("a2");
    store.save([user("go"), waitCall("w1")]);
    const model = new ScriptedModel([[assistant("both")]]);
    const a = agent(model, [], { wait: true });
    a.start();
    a.accept(plain("", "a1"));
    await a.idle();
    expect(model.calls).toHaveLength(0);
    a.accept(plain("second", "a2"));
    await a.idle();
    expect(store.load()[2]).toEqual(result("w1", `From: a1\n\n---\n\nFrom: a2\n\nsecond\n\n---\n\n${ALL_REPLIED}`));
    expect(model.calls).toHaveLength(1);
  });
});

describe("a wait is answered from the inbox", () => {
  test("it offers the wait tool only when asked to", async () => {
    const model = new ScriptedModel([[assistant("ok")], [assistant("ok")]]);
    await run(model, []);
    expect(model.calls[0]!.tools.map((t) => t.name)).toEqual([]);
    const waiting = agent(model, [], { wait: true });
    waiting.start();
    waiting.accept(plain("again"));
    await waiting.idle();
    expect(model.calls[1]!.tools.map((t) => t.name)).toEqual(["wait"]);
  });

  test("waiting on a sub-agent stops the loop with the call open, and its reply answers it", async () => {
    store.owe("a1");
    const model = new ScriptedModel([[waitCall("w1")], [assistant("Herons wait in reeds")]]);
    const a = agent(model, [], { wait: true });
    a.start();
    a.accept(plain("go"));
    await a.idle();
    expect(model.calls).toHaveLength(1);
    expect(store.load().at(-1)).toEqual(waitCall("w1"));
    a.accept(plain("Herons wait in reeds", "a1"));
    await a.idle();
    expect(store.load().slice(2)).toEqual([result("w1", `From: a1\n\nHerons wait in reeds\n\n---\n\n${ALL_REPLIED}`), assistant("Herons wait in reeds")]);
    expect(store.inbox()).toEqual([]);
  });

  test("with nothing owed and nothing waiting, it's answered at once", async () => {
    const model = new ScriptedModel([[waitCall("w1")], [assistant("ok")]]);
    const a = agent(model, [], { wait: true });
    a.start();
    a.accept(plain("go"));
    await a.idle();
    expect(store.load()[2]).toEqual(result("w1", NOTHING_TO_WAIT_FOR));
  });

  test("a message from the parent ends it, shown as its text alone", async () => {
    store.owe("a1");
    store.save([user("go", P), waitCall("w1")]);
    const a = agent(new ScriptedModel([[assistant("stopped")]]), [], { parent: P, wait: true });
    a.start();
    a.accept(fromParent("stop and report"));
    await a.idle();
    expect(store.load()[2]).toEqual(result("w1", "stop and report\n\n---\n\nStill working: a1."));
  });

  test("an urgent message doesn't cancel it: it answers it", async () => {
    store.owe("a1");
    store.save([user("go"), waitCall("w1")]);
    const a = agent(new ScriptedModel([[assistant("ok")]]), [], { wait: true });
    a.start();
    a.accept(urgent("stop now"));
    await a.idle();
    expect(store.load()[2]).toEqual(result("w1", "From: owner\n\nstop now\n\n---\n\nStill working: a1."));
  });

  test("one reply of two names the sub-agent still working", async () => {
    store.owe("a1");
    store.owe("a2");
    store.save([user("go"), waitCall("w1")]);
    const a = agent(new ScriptedModel([[waitCall("w2")]]), [], { wait: true });
    a.start();
    a.accept(plain("first", "a1"));
    await a.idle();
    expect(store.load()[2]).toEqual(result("w1", "From: a1\n\nfirst\n\n---\n\nStill working: a2."));
  });

  test("an empty reply, with nothing else owed, answers it as a bare From: line", async () => {
    store.owe("a1");
    store.save([user("go"), waitCall("w1")]);
    const a = agent(new ScriptedModel([[assistant("ok")]]), [], { wait: true });
    a.start();
    a.accept(plain("", "a1"));
    await a.idle();
    expect(store.load()[2]).toEqual(result("w1", `From: a1\n\n---\n\n${ALL_REPLIED}`));
  });
});

describe("a wait comes after the rest of its batch", () => {
  test("its batch's sends run first, and a second wait is refused", async () => {
    const order: string[] = [];
    const send = tool("message_sub_agent", async () => (order.push("send"), store.owe("a1"), "delivered"));
    const model = new ScriptedModel([[waitCall("w1"), call("c1", "message_sub_agent"), waitCall("w2")]]);
    const a = agent(model, [send], { wait: true });
    a.start();
    a.accept(plain("go"));
    await a.idle();
    expect(order).toEqual(["send"]);
    expect(store.load().slice(4)).toEqual([result("c1", "delivered"), result("w2", WAITED)]);
    expect(store.load().at(-1)).not.toEqual(expect.objectContaining({ callId: "w1" }));
  });

  test("an urgent message that skips the batch's other calls still answers its wait", async () => {
    store.owe("a1");
    const gate = deferred<string>();
    const model = new ScriptedModel([[call("c1", "slow"), waitCall("w1")], [assistant("ok")]]);
    const a = agent(model, [tool("slow", (_input, signal) => new Promise((resolve) => signal.addEventListener("abort", () => resolve("x"))))], { wait: true });
    a.start();
    a.accept(plain("go"));
    await vi.waitFor(() => expect(store.load()).toHaveLength(3));
    a.accept(urgent("stop"));
    gate.resolve("");
    await a.idle();
    expect(store.load().slice(3, 5)).toEqual([result("c1", CANCELLED), result("w1", "From: owner\n\nstop\n\n---\n\nStill working: a1.")]);
  });
});

describe("an open wait survives a restart", () => {
  test("a lone open wait stays open across a start, and the reply answers it with no model call before", async () => {
    store.owe("a1");
    store.save([user("go"), waitCall("w1")]);
    const model = new ScriptedModel([[assistant("done")]]);
    const a = agent(model, [], { wait: true });
    a.start();
    await a.idle();
    expect(model.calls).toHaveLength(0);
    a.accept(plain("the haiku", "a1"));
    await a.idle();
    expect(store.load()[2]).toEqual(result("w1", `From: a1\n\nthe haiku\n\n---\n\n${ALL_REPLIED}`));
    expect(model.calls).toHaveLength(1);
  });

  test("a crash before the wait in its batch: the call is interrupted, the wait not run", async () => {
    store.owe("a1");
    store.save([user("go"), waitCall("w1"), call("c1", "a")]);
    const model = new ScriptedModel([[assistant("ok")]]);
    const a = agent(model, [tool("a")], { wait: true });
    a.start();
    await a.idle();
    expect(store.load().slice(3, 5)).toEqual([result("c1", INTERRUPTED), result("w1", NOT_RUN_STOPPED)]);
    expect(model.calls).toHaveLength(1);
  });
});
