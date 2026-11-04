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

- Cancelling a model call or a tool partway through. A message waits for the current step to end.
- Bounding how many messages an agent may send or receive, beyond the size of one message. See Risks.

## Decisions

### 1. Messages wait in an inbox table and join the conversation at a step boundary

The store gains a second table, `inbox`, beside `items`. `POST /messages` inserts the message there and answers `202` once the insert commits, so "acknowledged" means durable. Before each model call, the loop moves every inbox message into `items`, in arrival order, in one transaction: delete from `inbox`, insert into `items`. That transaction is the moment of delivery.

*Why not append straight to `items` on arrival?* A message would land wherever the conversation happened to be. Arriving during a tool call, it would sit between the call and its result, which Anthropic's API rejects and which misstates what the model saw. Arriving during a model call, it would sit before a response the model wrote without seeing it. Delivering at the boundary keeps every call next to its result and the stored order true. The event stream shows a message once it's delivered, which is when it becomes part of the conversation.

### 2. A received message is a user message with a sender

A message the agent receives is `{"type": "message", "role": "user", "from": "<id>", "text": "..."}`, where `from` is the sender's agent ID or `owner`. The agent's own messages stay `role: "assistant"`, with no `from`. Every provider has a user role, and a received message is exactly that, so an adapter needs one line, not a new case. The Responses adapter sends it as user content that starts with a header naming the sender, `From: <id>`, followed by a blank line and the text.

*Rejected:* a separate item type for received messages. Every adapter would map it to a user message anyway, and the port would have two ways to say the same thing.

### 3. Work is derived from the store, and the loop is one step at a time

`runTurn()` is replaced by a step function, and `respond()` by a loop that runs while there's work. Outstanding calls come first: these are the tool calls in the most recent model response whose IDs have no saved result. Finding them by matching IDs, not by looking at the last item, covers a crash between two results of one response, and a response that holds a tool call followed by text. There's work when there are outstanding calls, when the inbox holds a message, or when the conversation doesn't end with an assistant message. One step is:

1. **Settle outstanding calls, in order.** Before running each one, check the inbox. If it holds a message, run none of the remaining calls, and give each one the result `Error: not run, because a message arrived first. Call it again if it's still wanted.` Otherwise run the call and save its result.
2. **Deliver the inbox** (decision 1). Every call already has its result by now, so a message never lands between a call and its result.
3. **Call the model** with the whole conversation, and save its response the moment it returns. Its tool calls are now outstanding, and the next step settles them.

That's the boundary the proposal promised: a message is handled between one model or tool call and the next. A parent's "don't delete that" stops the rest of a batch. The model sees which calls ran and which didn't, and calls the rest again if it still wants them.

Recovery never carries on an old batch. When the agent starts, the first outstanding call may have been running when the process stopped, so it gets the result `Error: interrupted before its result was saved, so whether it took effect is unknown.` The one exception is a send to `owner`, which is known not to have been delivered (decision 8). Tools run one at a time, and each result is saved before the next call starts, so every later outstanding call never started. Each one gets `Error: not run, because the agent was stopped first. Call it again if it's still wanted.`, and none of them runs. The next step is then a model call, which sees what happened and anything waiting in the inbox. That matters most when a message wakes a stopped agent. The runtime starts the agent first and relays the message once it accepts connections, so a restarted agent that carried on its batch could run old calls before the message that woke it arrived. A batch was planned before the stop, and a stop is usually a correction, so the model decides what's still wanted. The cost is at most one model call.

Each save is its own transaction, and each one is streamed right after (`deliver()` is already written to be called after any save). The agent runs the loop at startup and whenever a message is accepted while it isn't already running. Nothing is kept in memory between steps except the flag saying the loop is running.

So the agent resumes after a crash, a stop or a redeploy with no special code. A tool call whose result was saved is never run again. One that may have been running is reported to the model as unknown, and the model decides whether to retry. This was the open question in the proposal discussion. Keeping it in the model follows the tenet that logic lives in the weights, and it's the only safe choice for calls such as spawn that can't be undone.

The specs cover these cases with scenarios: a crash after a saved call with a message in the inbox, a crash between two results of one response, a message that arrives between two tool calls, and a stopped agent woken by a message while its batch has calls that never started.

*Rejected:* delivering messages only before model calls, so a whole batch of tool calls runs first. A correction would arrive too late to stop the rest of a batch, such as a second delete.

*Rejected:* saving each tool call only once it has run. A crash between running and saving would leave no trace of a spawn that happened, and the model would spawn again.

### 4. A failed model call is retried, and then the agent waits

A failed model call saves nothing. The agent retries the step after 1, 5 and 25 seconds. If all of those fail, it stops looping until a message arrives or it's started again, and either one resumes the work where it stopped. Each failure is sent to every open event stream as an `error` event with `{"message": "..."}`, no `id` and nothing saved. That's how a watcher, such as the owner, learns of it now that `POST /messages` no longer waits for the turn. It's the first event type besides `item`, as the 2026-10-28 decision anticipated.

*Rejected:* retrying without limit, which hides a broken model behind endless calls, and not retrying, which leaves a sub-agent silent after one transient error while its parent sleeps waiting for it.

**When it gives up, it tells its parent.** The agent sends its parent an ordinary message, from its own ID: `My model is failing, so I've stopped working. Error: <error>. Message me to try again.` The agent is the persona, not its model, so the message speaks for the agent. The provider's raw error is what shows something really broke, since a model wouldn't write that about itself. The parent's model decides what to do: message it later, give the work to another sub-agent, or delete it. Replying is the retry. Like any message, it wakes a stopped parent.

The owner gets the same notice. A root agent's parent is the owner, who has no inbox and reads the root's event stream. While the root has stopped trying, every client that connects to its stream, and every one already connected, gets the notice's text as an `error` event. It's sent again on each new connection, so the owner sees it whenever they look, not only if they were watching when it happened. Messaging the root makes it try again, as it would for any parent. It isn't saved, so once the agent recovers, the notice is gone.

*Rejected:* the runtime sending the notice as `runtime`. The runtime doesn't see model calls, so it would only relay what the agent told it, under a sender that isn't true. *Rejected:* saving the root's notice as an item for the owner. That needs a new item type for messages the model didn't write, while a re-sent `error` event tells the owner the same thing whenever they connect.

### 5. The runtime stamps the sender in a header

The runtime adds `Jen-From: <caller>` to every relayed `POST /messages`, where the caller is an agent's ID or `owner`. The relay forwards only a fixed list of headers, so a `Jen-From` from the caller never reaches the agent. The body passes through unchanged, so the relay still doesn't parse it. The agent trusts the header because only the runtime holds its token, and it answers `400` to a message without one. The agent bounds a message body at 1 MiB, answering `413`, because a child can now message its parent, and no agent should be able to make another buffer an arbitrary upload.

*Rejected:* a `from` field in the body. The runtime would have to parse and rewrite every message.

### 6. The runtime lets a child message its parent, and wakes a stopped agent

The runtime opens `POST /agents/:id/messages` to the caller's parent as well as its descendants. Every other route still reaches only descendants. When a message's target is stopped, including a parent whose crash restarts ran out while its children kept running, the runtime starts it, in the same queue as every other tree operation, and then relays. A start that fails answers as a failed start does today. `GET /agents/:id/events` on a stopped agent still gets `409`, since watching shouldn't wake anything.

`owner` is reserved as the owner's ID. An agent ID is 12 hex characters, so it can't collide. `GET /agents/owner` and every other route that names `owner` still get `404`.

### 7. The runtime tells each agent who it is

Each agent's container also gets `JEN_AGENT_ID`, `JEN_PARENT` (its parent's ID, or `owner` for a root agent) and `JEN_GRANT` (its grant as JSON). The agent requires all three at startup, like `JEN_TOKEN`.

### 8. The agent's tools follow its grant, and talk to the runtime

Delegation tools live in `src/agent/delegation.ts`, with a small client that calls `JEN_RUNTIME_URL` with the agent's own token over `node:http`:

- `send_message` `{to, text}`, always offered. A send to another agent goes through the runtime, which refuses targets the agent can't reach, and answers once the message is in the receiver's inbox. A send to `owner` from a root agent calls nothing, because the owner reads the root's event stream. Either way, a successful send's result is `delivered`.

**A send is delivered when its `delivered` result is saved, never when its call is.** The model's response, tool calls included, is saved and streamed before any of its tools run (decision 3), so a streamed call is only an intent. It may still be skipped because a message arrived first, or interrupted by a crash. For a send to `owner`, that saved result is the delivery itself: a client shows the owner a message from the root only once it has seen the call's `delivered` result, and a call whose result is anything else wasn't delivered. Every client reads the same saved items, so replaying the stream from any position gives the same answer. Since a send to `owner` has no effect outside the agent, a crash before its result is saved means it wasn't delivered. Recovery records `Error: interrupted before it was sent, so it wasn't delivered.` for it, not the unknown outcome, and the model sends again if it still wants to. The specs cover an owner send that's skipped because a message is waiting, and one interrupted by a crash.

*Rejected:* a separate outgoing-message event or item for the owner. It would be a second record of what the result already says, and the two could disagree after a crash.
- `spawn_agent` `{grant}`, `list_agents`, `stop_agent` `{id}`, `start_agent` `{id}` and `delete_agent` `{id}`, offered only when the grant has `spawn`. Without `spawn` an agent can't have sub-agents, so these would have nothing to act on.

A runtime refusal becomes a tool error with the runtime's status and message, which the loop already reports to the model as `Error: ...`.

### 9. The model port gains system instructions

`Model.next()` takes a third argument, `instructions`, a string. The Responses adapter sends it as `instructions`, and the scripted model records it. The agent builds it from its ID, its parent's ID and its grant. It says, briefly, that the agent is one of a tree of agents. Its text output reaches no one, so anything for another agent has to be sent. Messages from others arrive as user messages naming their sender. To wait for an answer, it ends its turn, and the answer will wake it. It should tell its parent when its work is done.

This is the caller the 2026-10-26 rule was waiting for. An agent can't follow "talk only by sending" without being told. The instructions are a prompt, so how well they work is a question for the live check, not for unit tests.

## Risks / Trade-offs

- [Two agents message each other forever and spend without limit] → Only depth and count bound the tree until the model proxy makes spend a bound. The instructions ask agents to report when done, not to narrate.
- [An agent floods another's inbox] → Each message is bounded at 1 MiB, but their number isn't. Within a tree, everyone shares one owner, so this is a bug, not an attack. It's revisited with communication between agents that aren't parent and child.
- [A child's model fails while its parent's model fails too, for example when they share a provider that's down] → The runtime's message wakes the parent, whose own model then fails, and it reports in turn. The failure climbs the tree to the owner, who sees it as `error` events on the root's stream.
- [The model forgets to send, and its answer goes nowhere] → The instructions say so plainly, and the live check exercises it. The answer is still on its stream.
- [An interrupted tool call is reported as unknown even when it never started] → The model retries it. The cost is one extra call, and the alternative is never knowing.
- [A message during a long model call or tool waits for it] → The wait is one call. Cancellation is added if that proves too slow.
- [Frequent messages keep cutting batches short] → Each message costs the rest of the batch and one more model call, which re-issues what's still wanted. That's the price of a correction always arriving in time. If chatty children make it expensive, the parent tells them to talk less.

## Migration Plan

None. Stored conversations from before this change hold user messages without a sender, which aren't supported, so delete and spawn existing agents again. The live checks and the commands in `context/environment.md` change to read replies from the event stream.
