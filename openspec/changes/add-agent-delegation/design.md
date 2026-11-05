# Design

## Context

See proposal.md for why. Today:

- **The agent runs one turn per request.** `server.ts` takes `POST /messages`, refuses a second one with `409` while `busy`, and calls `respond()`. `respond()` runs `runTurn()` over the loaded conversation in memory and saves the whole turn with one `store.append()` once it completes. The event stream is fed only after that save, so watchers see a turn all at once, and a failed turn saves and streams nothing.
- **The agent has no tools.** `respond()` passes `[]`.
- **The model port has no system instructions,** by the 2026-10-26 rule that a field is added only when a caller needs it.
- **The runtime pipes `/messages` through to the agent unchanged,** forwarding a fixed list of headers with the agent's token in place of the caller's. Every route acts only on the caller's descendants, and a relay to a stopped agent gets `409`.
- **An agent's container gets `JEN_MODEL`, `JEN_API_KEY`, `JEN_BASE_URL`, `JEN_TOKEN` and `JEN_RUNTIME_URL`.** It doesn't get its own ID, its parent's or its grant.

jen has no adopters, so nothing here migrates stored conversations or keeps the old protocol working.

## Goals / Non-Goals

**Goals:**

- The agent's state is entirely in its store. Whether it has work to do, and what that work is, is read from the conversation and the inbox, never from memory, so any restart resumes exactly.
- A message is never lost once it's acknowledged, and no finished step is ever run twice.
- The conversation the model is sent is exactly what it saw happen, in the order it saw it, and stays valid input for every provider.

**Non-Goals:**

- Bounding how many messages an agent may send or receive, beyond the size of one message. See Risks.

## Decisions

### 1. Messages wait in an inbox table and join the conversation at a step boundary

The store gains a second table, `inbox`, beside `items`, which also keeps whether each message is urgent (decision 4). `POST /messages` inserts the message there and answers `202` once the insert commits, so "acknowledged" means durable. Before each model call, the loop moves every inbox message into `items`, in arrival order, in one transaction: delete from `inbox`, insert into `items`. That transaction is the moment of delivery.

*Why not append straight to `items` on arrival?* A message would land wherever the conversation happened to be. Arriving during a tool call, it would sit between the call and its result, which Anthropic's API rejects and which misstates what the model saw. Arriving during a model call, it would sit before a response the model wrote without seeing it. Delivering at the boundary keeps every call next to its result and the stored order true. The event stream shows a message once it's delivered, which is when it becomes part of the conversation.

### 2. A received message is a user message with a sender

A message the agent receives is `{"type": "message", "role": "user", "from": "<id>", "text": "..."}`, where `from` is the sender's agent ID, `owner` or `runtime`. The agent's own messages stay `role: "assistant"`, with no `from`. Every provider has a user role, and a received message is exactly that, so an adapter needs one line, not a new case. The Responses adapter sends it as user content that starts with a header naming the sender, `From: <id>`, followed by a blank line and the text.

*Rejected:* a separate item type for received messages. Every adapter would map it to a user message anyway, and the port would have two ways to say the same thing.

### 3. Work is derived from the store, and the loop is one step at a time

`runTurn()` is replaced by a step function, and `respond()` by a loop that runs while there's work. Outstanding calls come first: these are the tool calls in the most recent model response whose IDs have no saved result. Finding them by matching IDs, not by looking at the last item, covers a crash between two results of one response, and a response that holds a tool call followed by text. There's work when there are outstanding calls, when the inbox holds a message, or when the conversation doesn't end with an assistant message. One step is:

1. **Settle outstanding calls, in order.** Before running each one, check the inbox for an urgent message. If it holds one, run none of the remaining calls, and give each one the result `Error: not run, because an urgent message arrived first. Call it again if it's still wanted.` Otherwise run the call and save its result. A plain message waits in the inbox until the batch is done.
2. **Deliver the inbox** (decision 1). Every call already has its result by now, so a message never lands between a call and its result.
3. **Call the model** with the whole conversation, and save its response the moment it returns. Its tool calls are now outstanding, and the next step settles them.

So a plain message reaches the model before its next model call, once the batch in progress has finished, and routine news never costs anyone the rest of a batch. A correction that can't wait, such as a parent's "don't delete that", is sent urgent: it cancels the call in flight and stops the rest of the batch (decision 4). Either way, the model sees which calls ran and which didn't, and calls the rest again if it still wants them.

Recovery never carries on an old batch. When the agent starts, the first outstanding call may have been running when the process stopped, so it gets the result `Error: interrupted before its result was saved, so whether it took effect is unknown.` The one exception is a send to `owner`, which is known not to have been delivered (decision 10). Tools run one at a time, and each result is saved before the next call starts, so every later outstanding call never started. Each one gets `Error: not run, because the agent was stopped first. Call it again if it's still wanted.`, and none of them runs. The next step is then a model call, which sees what happened and anything waiting in the inbox. A batch was planned before the stop, and a stop is usually a correction, so the model decides what's still wanted. The cost is at most one model call. Skipping the batch isn't enough on its own when a message wakes the agent: that model call must also see the message, or it could re-issue the very call the message was sent to stop. A start that comes with messages therefore holds the loop until they're in the inbox (decision 7).

Each save is its own transaction, and each one is streamed right after (`deliver()` is already written to be called after any save). The agent runs the loop at startup, unless the start holds it (decision 7), and whenever a message is accepted while it isn't already running. Nothing is kept in memory between steps except the flag saying the loop is running.

So the agent resumes after a crash, a stop or a redeploy with no special code. A tool call whose result was saved is never run again. One that may have been running is reported to the model as unknown, and the model decides whether to retry. This was the open question in the proposal discussion. Keeping it in the model follows the tenet that logic lives in the weights, and it's the only safe choice for calls such as spawn that can't be undone.

The specs cover these cases with scenarios: a crash after a saved call with a message in the inbox, a crash between two results of one response, a plain message and an urgent one that each arrive between two tool calls, a stopped agent woken by a message while its batch has calls that never started, and a waking message held back while recovery is ready to run, where the agent's first model call must include it.

*Rejected:* letting every message stop the rest of a batch. A child's progress report would cut its parent's batch short and cost a model call to re-plan, and a correction would still wait for the call in flight.

*Rejected:* saving each tool call only once it has run. A crash between running and saving would leave no trace of a spawn that happened, and the model would spawn again.

### 4. An urgent message cancels the step in flight

`POST /messages` takes an optional `"urgent": true` in its body, and `send_message` an optional `urgent`. Anyone who may message an agent may send it an urgent message: its parent, its children, the owner and the runtime. The relay passes the body through unchanged, so the runtime needs nothing for it.

When an urgent message is accepted while the loop is running, the agent aborts the step in flight through an `AbortSignal`, which `Model.next()` and every tool take:

- **A cancelled model call** saves nothing, as a failed one does, but it isn't retried as a failure.
- **A cancelled tool call** gets the result a crash would leave: `Error: cancelled by an urgent message before its result was saved, so whether it took effect is unknown.` A send to `owner` does no I/O, so it's never in flight.
- **The rest of its batch** gets the "not run" result from decision 3.

Then the step delivers the inbox and calls the model, as any step does. An urgent message to an idle or stopped agent has nothing to cut short, so it's delivered as any message is. A cancel leaves the conversation exactly as the restart recovery in decision 3 does, without the restart, so it adds no new kind of state.

*Why:* a plain message waits for the whole batch, which for a long tool or a reasoning model's call can take minutes. Stopping the agent cuts its work short too, but it stops the agent's whole subtree, and after a restart those sub-agents stay stopped. An urgent message changes one agent's course and leaves the tree running.

*Rejected:* urgent messages only from a parent. A child with "stop, that will destroy data" needs one as much, and one rule for every pair holds, the owner included. An agent that overuses them is a bug inside one owner's tree, as flooding is.

### 5. A failed model call is retried, and then the agent waits

A failed model call saves nothing. The agent retries the step after 1, 5 and 25 seconds. If all of those fail, it stops looping until a message arrives or it's started again, and either one resumes the work where it stopped. Each failure is sent to every open event stream as an `error` event with `{"message": "..."}`, no `id` and nothing saved. That's how a watcher, such as the owner, learns of it now that `POST /messages` no longer waits for the turn. It's the first event type besides `item`, as the 2026-10-28 decision anticipated.

*Rejected:* retrying without limit, which hides a broken model behind endless calls, and not retrying, which leaves a sub-agent silent after one transient error while its parent sleeps waiting for it.

**When it gives up, it tells its parent.** The agent sends its parent an ordinary message, from its own ID: `My model is failing, so I've stopped working. Error: <error>. Message me to try again.` The agent is the persona, not its model, so the message speaks for the agent. The provider's raw error is what shows something really broke, since a model wouldn't write that about itself. The parent's model decides what to do: message it later, give the work to another sub-agent, or delete it. Replying is the retry. Like any message, it wakes a stopped parent. If the send fails, for example because the parent's start fails, the agent shows the notice on its own stream, as a root does below, and waits as before.

The owner gets the same notice. A root agent's parent is the owner, who has no inbox and reads the root's event stream. While the root has stopped trying, every client that connects to its stream, and every one already connected, gets the notice's text as an `error` event. It's sent again on each new connection, so the owner sees it whenever they look, not only if they were watching when it happened. Messaging the root makes it try again, as it would for any parent. It isn't saved, so once the agent recovers, the notice is gone.

*Rejected:* the runtime sending the notice as `runtime`. The runtime doesn't see model calls, so it would only relay what the agent told it, under a sender that isn't true. The runtime sends only what it saw itself (decision 8). *Rejected:* saving the root's notice as an item for the owner. That needs a new item type for messages the model didn't write, while a re-sent `error` event tells the owner the same thing whenever they connect.

### 6. The runtime stamps the sender in a header

The runtime adds `Jen-From: <caller>` to every relayed `POST /messages`, where the caller is an agent's ID or `owner`, and to every message it sends itself, as `runtime`. It adds `Jen-Wake` itself too, only on the message that ends a hold (decision 7). The relay forwards only a fixed list of headers, so a `Jen-From` or `Jen-Wake` from the caller never reaches the agent. The body passes through unchanged, so the relay still doesn't parse it. The agent trusts the header because only the runtime holds its token, and it answers `400` to a message without one. The agent bounds a message body at 1 MiB, answering `413`, because a child can now message its parent, and no agent should be able to make another buffer an arbitrary upload.

*Rejected:* a `from` field in the body. The runtime would have to parse and rewrite every message.

### 7. The runtime lets a child message its parent, and wakes a stopped agent

The runtime opens `POST /agents/:id/messages` to the caller's parent as well as its descendants. Every other route still reaches only descendants. When a message's target is stopped, including a parent whose crash restarts ran out while its children kept running, the runtime starts it, in the same queue as every other tree operation, and then relays. A start that fails answers as a failed start does today. `GET /agents/:id/events` on a stopped agent still gets `409`, since watching shouldn't wake anything.

**A start that comes with messages holds the agent's loop until they're delivered.** The agent's server accepts messages before its loop starts, but the runtime can relay only once the agent accepts connections, so without a hold, recovery could call the model first. When the runtime starts an agent to deliver messages, the waking message and any notice from decision 8, it gives the container `JEN_WAKE`, a new random ID. It relays the notice first, then the waking message, with the header `Jen-Wake: <id>` on the last one only. An agent started with `JEN_WAKE` doesn't run its loop until it has accepted a message carrying that ID. The agent saves the ID in the same transaction as that message's insert into the inbox, so once it's saved, the hold is over for good:

- **A Docker crash restart** reuses the container and its environment. The store already holds the ID, so the agent resumes at once and never waits for a message that was already delivered.
- **A start with nothing to deliver,** an explicit start with no stopped children, sets no `JEN_WAKE` and resumes at once, as today.
- **A start whose relay never comes,** because the runtime failed in between, leaves the agent idle with its work outstanding. Any message releases it, as it does for an agent that gave up after model failures, and the caller's failed request tells it to try again.

*Rejected:* the agent always waiting for the runtime's signal before it resumes. A Docker crash restart happens without the runtime, so the agent would need the runtime to notice every restart, and one that happened while the runtime was down would never resume. *Rejected:* a hold with no ID. After a crash restart the agent couldn't tell whether its waking message had already been delivered.

`owner` is reserved as the owner's ID, and `runtime` as the runtime's. An agent ID is 12 hex characters, so neither can collide. Every route that names `owner` or `runtime` still gets `404`. No agent can message the runtime.

### 8. The runtime reports what only it saw

The runtime sends a message as `runtime` only for a fact it witnessed and no agent can report. It uses the path every message uses: a `POST /messages` to the receiver with the receiver's token and `Jen-From: runtime`, into the receiver's inbox, starting a stopped receiver first, in the same queue as every other tree operation. The text states the fact and what can be done about it. Two facts qualify:

- **An agent's restarts ran out.** The runtime watches the engine's event stream for an agent's container that exits and won't be restarted, and tells the agent's parent: `Your sub-agent <id> stopped: its process kept exiting and its restarts ran out. Message it to start it again.` Without this, a parent waiting on the child would wait forever. A root's parent is the owner, who has no inbox and sees the root as `stopped` in their list.
- **An agent starts while its sub-agents are stopped.** A stop applies to the whole subtree, but a start doesn't (`agent-runtime`). When the runtime starts an agent that has stopped children, whether for a message or a start, it sends the agent `You were stopped and have been started again. Your sub-agents <ids> are still stopped. Messaging one starts it.` That start always holds the loop (decision 7), even when it was an explicit start with no message, so the agent's first model call sees the notice. Without this, the agent would wait on sub-agents that can't answer.

The runtime keeps no state, so it can't know whether it reported a fact before it restarted. A restart that runs out while the runtime itself is down goes unreported, and a parent finds out only when its next message to the child starts it.

*Rejected:* a new route, event or item type for runtime notices. An ordinary message from a reserved ID reaches a sleeping parent, survives in the inbox and is read by the model like anything else.

### 9. The runtime tells each agent who it is

Each agent's container also gets `JEN_AGENT_ID`, `JEN_PARENT` (its parent's ID, or `owner` for a root agent) and `JEN_GRANT` (its grant as JSON). The agent requires all three at startup, like `JEN_TOKEN`. A start with messages to deliver also sets `JEN_WAKE` (decision 7).

### 10. The agent's tools follow its grant, and talk to the runtime

Delegation tools live in `src/agent/delegation.ts`, with a small client that calls `JEN_RUNTIME_URL` with the agent's own token over `node:http`:

- `send_message` `{to, text, urgent?}`, always offered. A send to another agent goes through the runtime, which refuses targets the agent can't reach, and answers once the message is in the receiver's inbox. A send to `owner` from a root agent calls nothing, because the owner reads the root's event stream. Either way, a successful send's result is `delivered`.

**A send is delivered when its `delivered` result is saved, never when its call is.** The model's response, tool calls included, is saved and streamed before any of its tools run (decision 3), so a streamed call is only an intent. It may still be skipped because an urgent message arrived first, or interrupted by a crash. For a send to `owner`, that saved result is the delivery itself: a client shows the owner a message from the root only once it has seen the call's `delivered` result, and a call whose result is anything else wasn't delivered. Every client reads the same saved items, so replaying the stream from any position gives the same answer. Since a send to `owner` has no effect outside the agent, a crash before its result is saved means it wasn't delivered. Recovery records `Error: interrupted before it was sent, so it wasn't delivered.` for it, not the unknown outcome, and the model sends again if it still wants to. The specs cover an owner send that's skipped because an urgent message is waiting, and one interrupted by a crash.

*Rejected:* a separate outgoing-message event or item for the owner. It would be a second record of what the result already says, and the two could disagree after a crash.
- `spawn_agent` `{grant}`, `list_agents`, `stop_agent` `{id}`, `start_agent` `{id}` and `delete_agent` `{id}`, offered only when the grant has `spawn`. Without `spawn` an agent can't have sub-agents, so these would have nothing to act on.

A runtime refusal becomes a tool error with the runtime's status and message, which the loop already reports to the model as `Error: ...`.

### 11. The model port gains system instructions

`Model.next()` takes a third argument, `instructions`, a string, and a fourth, the `AbortSignal` from decision 4. The Responses adapter sends it as `instructions`, and the scripted model records it. The agent builds it from its ID, its parent's ID and its grant. It says, briefly, that the agent is one of a tree of agents. Its text output reaches no one, so anything for another agent has to be sent. Messages from others arrive as user messages naming their sender. To wait for an answer, it ends its turn, and the answer will wake it. It should tell its parent when its work is done. A plain message reaches a busy agent after its current batch, and an urgent one cuts that batch short, so urgent is for what can't wait. Messages from `runtime` report what happened to the tree.

This is the caller the 2026-10-26 rule was waiting for. An agent can't follow "talk only by sending" without being told. The instructions are a prompt, so how well they work is a question for the live check, not for unit tests.

## Risks / Trade-offs

- [Two agents message each other forever and spend without limit] → Only depth and count bound the tree until the model proxy makes spend a bound. The instructions ask agents to report when done, not to narrate.
- [An agent floods another's inbox] → Each message is bounded at 1 MiB, but their number isn't. Within a tree, everyone shares one owner, so this is a bug, not an attack. It's revisited with communication between agents that aren't parent and child.
- [A child's model fails while its parent's model fails too, for example when they share a provider that's down] → The child's notice wakes the parent, whose own model then fails, and it reports in turn. The failure climbs the tree to the owner, who sees it as `error` events on the root's stream.
- [The model forgets to send, and its answer goes nowhere] → The instructions say so plainly, and the live check exercises it. The answer is still on its stream.
- [A child finishes, or asks a question, in text instead of a send, and goes idle] → Nothing failed, so nothing reports it, and its parent waits on it forever. Only the owner noticing an idle tree breaks the wait. The instructions say plainly that text reaches no one, and the live check measures whether models forget. If they do, the fix is a tool a parent uses to be woken if it hasn't heard back, which keeps the decision in the model.
- [An interrupted tool call is reported as unknown even when it never started] → The model retries it. The cost is one extra call, and the alternative is never knowing.
- [A plain message waits for a long batch] → The sender marks it urgent if it can't wait.
- [An agent marks everything urgent] → Each one costs the call in flight and a model call to re-plan. Within one owner's tree that's a bug, and a parent tells a child to stop.
- [A child's restarts run out while the runtime is down] → Its parent isn't told (decision 8) until it next messages the child.

## Migration Plan

None. Stored conversations from before this change hold user messages without a sender, which aren't supported, so delete and spawn existing agents again. The live checks and the commands in `context/environment.md` change to read replies from the event stream.
