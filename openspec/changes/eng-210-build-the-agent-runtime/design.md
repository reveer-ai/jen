## Context

See proposal.md — Why. ENG-196 built the sandbox; this builds what runs inside it.

Four constraints from elsewhere shape everything below, and none of them is negotiable here.

**The substrate is unreachable from `cli/`.** `agent-substrate` forbids any module under `cli/` importing one under `agent/`. That has a consequence ENG-210's text did not anticipate: the stated entry point `jen agent --record <json>` cannot exist, because a `jen` subcommand lives in `cli/` and would have to import the runtime. The entry point is the substrate's own binary, declared by the substrate's own manifest.

**The sandbox must never receive an agent's parent.** `agent-sandbox` states the primitive "SHALL NOT read, receive, or behave differently according to an agent's parent, its depth, or whether it is the agent nobody spawned." This constrains how the one record reaches `create`.

**The model is stateless.** Every step re-sends the entire message array; nothing persists between calls on the provider's side. This is not a limitation to work around — it is the entire reason suspend/resume can be exact rather than approximate.

**The supervisor is the one non-homogeneous component, and is to be kept smallest.** Anything the runtime can own, the runtime should own.

## Goals / Non-Goals

**Goals:**

- One `AgentRecord`, declared once, that the sandbox can consume without receiving hierarchy.
- A thinking loop that is the runtime's own — it decides when to call the model, when to dispatch a tool, and when the turn is over.
- A capability interface the runtime knows the shape of and nothing else, with an empty registry valid.
- Construction from a record plus a prior event log that is *provably* indistinguishable to the model from an uninterrupted run.
- Tests that establish that property by comparison rather than by assertion.

**Non-Goals:**

- **Any capability implementation, `fs` and `exec` included.** ENG-210's text is ambiguous — it describes how `fs`/`exec` arrive at the surface, then closes with "Not the individual capabilities." The closing line governs. This change builds the socket; every plug is a later task, and the acceptance test is an agent that thinks and does nothing else.
- The supervisor, and the supervisor's side of the protocol. ENG-213.
- Persisting anything. The runtime emits events and receives them; what happens to them between runs is ENG-213's.
- Context management, recursion bounds, network policy. Deferred by the epic, each with its own trigger.

## Decisions

### One record, in `agent/record.ts`, narrowed by derivation

`agent/sandbox/index.ts` currently declares its own `AgentRecord`. It goes, and the one definition moves to `agent/record.ts` — a module neither the sandbox nor the runtime owns, so neither has to import the other.

```ts
export interface AgentRecord {
  id: string;
  name: string;
  charter: string;
  model: { provider: string; baseURL: string; model: string; credential: string };
  workspace: string;
  environment: string;
  tools: string[];
  credentials: CredentialReference[];
  parent: string | null;
}
```

The sandbox then names what it reads, rather than redeclaring it:

```ts
export type SandboxRequest = Pick<AgentRecord, 'id' | 'environment' | 'workspace' | 'credentials'>;
create(request: SandboxRequest): Promise<Sandbox>;
```

**Why derivation and not the whole record.** Passing `AgentRecord` straight to `create` is simpler and was the first instinct. It is also a spec violation: the driver would then *receive* `parent`, which `agent-sandbox` forbids in those words. Deriving keeps the requirement satisfied by construction, and — unlike a second hand-written interface — cannot drift, because renaming a field on `AgentRecord` fails the `Pick` at compile time rather than silently producing two shapes that agree today.

**`model.credential` names one of `credentials`, it does not duplicate it.** The record carries one delivery list; the model block says which entry the client authenticates with, and ENG-211's adapter will say which one the assistant uses. Two refs to one secret would be two places to get it wrong.

### Events are the transcript, and the runtime owns the projection

The runtime consumes and emits an **event log**, never a provider message array.

```ts
type Event =
  | { type: 'charter';   at: string; content: string }
  | { type: 'message';   at: string; from: 'parent' | 'self'; content: string }
  | { type: 'tool_call'; at: string; id: string; name: string; arguments: string }
  | { type: 'tool_result'; at: string; id: string; content: string; ok: boolean; ms: number }
  | { type: 'reasoning'; at: string; content: string; opaque?: unknown }
  | { type: 'usage';     at: string; in: number; out: number; model: string };
```

Projection to the provider's array happens at request time, in the runtime.

**Why the runtime and not the supervisor.** The supervisor must hand a resuming runtime what it had before, and the requirement is that the resumed request be byte-identical to the live one. If the supervisor projected for resume while the runtime projected while live, that guarantee would rest on two implementations staying in agreement — which is precisely the divergence ENG-213 warns about, and which no test on either side alone can catch. One implementation, used on both paths, makes the property structural. It also keeps provider knowledge out of the supervisor, which is the component to keep smallest and the only one that is not homogeneous.

**Why events and not the wire array.** Timestamps, token usage, tool durations and exit status are what make a transcript a verification surface rather than merely a resumable one — and ENG-212 makes verification the whole point of `read`. The wire array cannot carry any of it. Storing events also keeps the format off the provider's side of a seam the epic expects to move.

**The projection is deterministic and that is tested directly**, because provider prompt caches key on prefix content: a projection that varies by one whitespace character misses cache on every resume, silently and expensively.

### The boot frame is one JSON line on stdin

```
jen-agent  <  {"record": {...}, "events": [...]}\n
           then JSON-line protocol, both directions
```

No payload in argv. A single argument is capped at `MAX_ARG_STRLEN` — 128 KB on Linux — regardless of what `ARG_MAX` allows, and a ten-turn event log clears that in ordinary use. So the log cannot travel in argv at all, and once it is on stdin, splitting the record onto a second channel buys nothing and costs atomicity: a stale container spec and a fresh log cannot disagree if they arrive together.

It also keeps the charter off a command line. The record is inert by design so this is not a secret leak, but a container's processes are visible in the host's process list, and `agent-sandbox` already spent real effort establishing that what you hand the runtime, the runtime writes down.

**One hazard, and it needs its own test.** ENG-196 delivers credentials as `NAME=value` lines on the exec'd process's stdin, read by an `sh` prologue that then `exec`s the real command. The boot frame is the next thing in that same pipe. POSIX requires `read` not to consume past its newline on a shared descriptor, and shells implement this by reading a byte at a time from a pipe — so this works, but it works because of a guarantee that is easy to not know about. A test asserts the runtime receives its frame intact after the prologue, so that a future change to the prologue fails loudly rather than truncating a boot frame.

### The loop is the runtime's, and the client's loop is not used

One **step** is one model call plus the tool results it produced. One **turn** is a parent message through to the agent's reply. A turn ends when the model returns content with no tool calls — that content *is* the message to the parent, per ENG-194. There is no completion channel and no status field.

```
loop:
  stream a step  →  tool calls?  →  yes: dispatch all, append results, loop
                                 →  no:  emit message to parent, turn ends
```

The `openai` client is used for one thing: a streamed chat completion, with its accumulated tool calls. Its agentic helpers — anything that runs the tool loop on our behalf — are **not** used, and a source-level test guards that, in the same spirit as the sandbox's no-`node:fs` guard. Delegating the loop would hand ENG-194's central decision to a library, and it would do so invisibly, because the behaviour would look correct.

Streaming from the first version rather than retrofitted: tool-call deltas arrive as index-keyed fragments whose `arguments` split at arbitrary boundaries, and accumulating them is the one part of this surface genuinely worth not owning.

### A capability is a name, a schema, and an invocation

```ts
interface Capability {
  name: string;
  description: string;
  schema: object;                                   // JSON Schema, sent as-is
  invoke(input: unknown, signal: AbortSignal): Promise<CapabilityResult>;
  progress?(input: unknown): AsyncIterable<string>;
}
```

The registry is built **from `record.tools`** — the runtime resolves each name against what it was given and registers that. Two agents running byte-identical runtimes therefore hold different tool sets because their records differ, which is how homogeneity survives agents having different authority, and is the seam ENG-203's allowlist will hang from.

Local and forwarded capabilities implement the same interface and the loop cannot tell them apart: `fs.invoke` will do real I/O, `spawn.invoke` will write a JSON line and await a reply. That indistinguishability is the mechanism by which the runtime never holds the authority to spawn.

**JSON Schema, not Zod.** Capabilities are resolved from a list of names at construction, so their schemas are data rather than compile-time shapes; a validation library would be converted to JSON Schema at the wire anyway, and would add a dependency to buy nothing here.

**Nothing independently exercises this interface in this change**, since no capability ships — the same problem the sandbox has with one driver. It is held the same way: a trivial capability in the test suite, plus the requirement that an empty registry be valid, which is what forces the loop to have no capability-specific branch to begin with.

### An interrupted tool call is answered, never replayed

A log ending in a `tool_call` with no `tool_result` is rejected by the provider with a 400 — every `tool_call_id` must have a matching result, immediately following. So doing nothing is not an available behaviour; the agent would fail to boot.

Resume appends a `tool_result` marked not-ok, saying the call was interrupted by a restart and its outcome is unknown. It is **appended to the event log as a real event**, not patched into the wire array. Two consequences, both wanted: a parent reading the transcript sees that it happened, and the next resume projects it like any other event rather than re-deriving it.

Rejected: **re-executing**, because the runtime cannot know whether the call took effect before the container died, and a replayed `spawn` or push is worse than an admission of ignorance. Rejected: **rewinding past the assistant message**, because it erases a decision the agent really made and hides an effect that may really have landed. Synthesizing is not a cover story — it is the only wire-legal spelling of what actually happened, and it hands the recovery decision to the weights.

### Proving indistinguishability by comparison

The acceptance property is not assertable directly — "the model can't tell" has no assertion. It is established by comparison instead, against a scripted client double:

1. Run ten turns in one process; capture every request body.
2. Run the same ten turns, destroying the runtime and reconstructing it from the emitted log at each boundary; capture every request body.
3. Assert the two sequences are byte-identical.

A test double rather than a live model, because the property is about what we send, and a real model makes the comparison non-deterministic for reasons that have nothing to do with what is being tested.

## Risks / Trade-offs

**Reasonings blocks differ across providers, and dropping them changes resume.** → The `reasoning` event carries an `opaque` field the projection replays verbatim where a provider supplies one. One provider is exercised now, so this is a shape that anticipates the problem, not a solution to it; the second provider is what will actually test it.

**Ambient process state does not survive dormancy** — a dev server, a background job, anything outside the workspace mount. → Accepted and documented by the epic as the one real cost of suspension. The workspace volume survives; processes do not. Not mitigated here.

**`MAX_ARG_STRLEN` is a Linux constant, and the boot frame's rationale leans on it.** → The design holds regardless of the number, since the objection is unbounded growth against any fixed cap. Recorded so a reader does not think the number itself is load-bearing.

**No capability exercises the capability interface in this change.** → A test capability and a valid-empty-registry requirement, as above. This is the sandbox's one-driver problem again and it gets the same honest answer: the seam is held by reading it, and re-read when the first real capability lands.

**The `openai` client is a dependency in a component that holds credentials.** → It is a single package with zero dependencies, which is why it was preferred over a provider-abstraction library that would have brought several. Pinned exactly, in the substrate's own manifest, and out of jen's published package entirely.

**The credential prologue and the boot frame share one pipe.** → Covered by its own test, above. Called out separately because the failure mode is a truncated boot frame, which would read as a malformed record rather than as a pipe problem.
