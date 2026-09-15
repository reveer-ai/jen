# The supervisor

The host process outside every sandbox, and the substrate's one non-homogeneous component.
It starts sandboxes, moves messages, and writes things down. It holds no reasoning, and
every behaviour it grows that an agent could have expressed instead is a policy moved out of
the weights and into code, where no charter can reach it. **It is the component to keep
smallest**, and the pressure to grow it will always look reasonable.

Run its tests with the rest of the substrate's — see [`../AGENTS.md`](../AGENTS.md). Most of
them need nothing but node. `containers.test.ts` is the exception and needs a running
container runtime, the same as `sandbox/docker.test.ts` and for the same reason.

## The collision the whole design is built around

`answerInterrupted` answers every capability call a log left outstanding, on every
construction. It has to: a provider rejects a message array with an unanswered tool call, so
doing nothing is not available.

**A deliberately suspended `await` and a process killed mid-call leave the log in exactly the
same shape** — a `tool_call` with no `tool_result`. Nothing in the log separates them. So a
naively resumed agent is told *"This call was interrupted by a restart…"* instead of being
told what arrived. It then reasons about a failure that never happened. **Nothing errors, and
the transcript looks fine.**

Two things follow, and both are load-bearing:

- **State is stored, not inferred.** `state.json` is the third file in an agent's directory
  for this reason alone. Inferring what an agent was doing from its log is precisely what
  cannot work.

  | Stored state | Log ends in | Means | What happens |
  |---|---|---|---|
  | waiting on a request | unanswered call | suspended on purpose | the answer is appended on delivery |
  | working | unanswered call | died mid-call | `answerInterrupted` does its job |
  | working | a complete step | died between steps | resumed, takes the next step |

- **The answer is appended to the log *before* the body boots.** `#answerInLog`. The runtime
  then constructs on a complete log and `answerInterrupted` finds nothing to do. This should
  read as ordinary rather than clever: for a supervisor-backed capability the supervisor *is*
  what produces the result — normally it sends it down the pipe and the runtime appends it,
  and when there is no pipe it appends the same value to the same place itself.

**If suspension is ever made to work by writing to the log after booting, this comes back.**
The test that notices is `suspend.test.ts`, "sends the model the message, and not the text
for a call that was interrupted". Remove the write-before-boot and everything else in this
directory stays green: the supervisor still suspends, still resumes, still delivers.

The call that gets answered is found in the log, not from a request id. The id belongs to the
runtime that raised it, and that runtime is gone.

## The sweep ends bodies and must never take a workspace

`destroyAll` runs after a failure, which is **exactly** the moment every agent's work is
sitting in its workspace waiting to be resumed from. Workspaces carry the same `jen.run`
label the sweep queries by, so the query that finds what to end is one word away from the
query that would find a day of every agent's work and delete it — through a call whose
purpose reads as tidying up.

Nothing in `index.ts` calls `releaseWorkspace`, including dismissal, where keeping the
workspace is the reversible choice and releasing it is not. `policy.test.ts` reads the source
for that, because a sweep that released workspaces would pass every assertion about ending
bodies.

## No period of the supervisor's own

Residency is the agent's number, carried on the frame it suspends with. **There is no
default, minimum, maximum, clamp or adaptive heuristic here and there must never be one** —
only the agent can know whether it is about to be woken in seconds or in a day, because it
has just decided what it dispatched.

A behavioural test cannot hold this: every test names its own number, so a default added here
would only ever apply where no test looked. `policy.test.ts` reads the source instead — no
binding that could be a duration, no number that could be one, exactly one `setTimeout`, and
its delay is the name the frame arrived under. All four were confirmed to fail by mutating
the source, which is the only way to know a source-level test is doing anything.

## Everything that changes state runs one at a time

`#serial`. **This is correctness, not throughput.** Every transition here is read the stored
value, change it, write it back — and each of those spans an `await`. Two interleaved on one
agent lose whichever wrote first: two messages posted to the same mailbox become one, and
nothing reports anything anywhere.

This was found by a test rather than by reasoning about it. Two `tell()` calls in flight
raced `state.json`'s write-and-rename and the second rename failed with `ENOENT` — which is
the *visible* half. The lost message is the half that would never have surfaced.

Only the outermost entry points queue, which is why the public calls are thin wrappers over
private ones: `add`/`#add`, `tell`/`#tell`, `resume`/`#resume`, `shutdown`/`#shutdown`.
**Anything reached from inside a queued task that queues again deadlocks** — `#spawning`
calls `#add` and not `add` for exactly this reason.

The store assumes one writer per run as a consequence, and `state.json.writing` is a single
predictable name rather than a unique one because of it.

## One sandbox at a time per agent, assumed and unenforced

`agent/AGENTS.md` records that two `create` calls for the *same* agent would each believe
they made its workspace, after which a failure in either takes the other's work with it.
**The supervisor is the caller that assumption is about.** Provisioning follows state
transitions and an agent is working or waiting and never both, so nothing here holds two in
flight — but nothing in the real driver would notice if that stopped being true, and it fails
by deleting data rather than by erroring.

`TestDriver` refuses a second creation in flight for one agent, which is where a path that
grew the ability to do it would find out.

## The human is a participant, not an exception

The root's parent is the human. A message the root addresses upward reaches `onMessage`; a
message from the human comes back through `tell` and takes **the same path** a parent's
message takes, into the same position in the conversation. There is no separate human
channel, and adding one would make the root structurally different from every other agent —
which is the thing the whole substrate is arranged to avoid.

## What "surfaced to the human" means for a stalled tree is still open

`onStalled` reports the condition and the supervisor does nothing else: it wakes nobody,
messages nobody, terminates nobody. Breaking a deadlock is a judgment about the work.

What a caller should *do* with that report — a log line, an exit, something an interface
renders — is genuinely undecided, and the interface that would consume it does not exist yet.
The callback is the smallest thing that does not pre-judge it.
