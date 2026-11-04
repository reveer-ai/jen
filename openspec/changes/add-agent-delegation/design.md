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
- Telling a parent that its child's model keeps failing. See Risks.

## Decisions

### 1. Messages wait in an inbox table and join the conversation at a step boundary

The store gains a second table, `inbox`, beside `items`. `POST /messages` inserts the message there and answers `202` once the insert commits, so "acknowledged" means durable. Before each model call, the loop moves every inbox message into `items`, in arrival order, in one transaction: delete from `inbox`, insert into `items`. That transaction is the moment of delivery.

*Why not append straight to `items` on arrival?* A message would land wherever the conversation happened to be. Arriving during a tool call, it would sit between the call and its result, which Anthropic's API rejects and which misstates what the model saw. Arriving during a model call, it would sit before a response the model wrote without seeing it. Delivering at the boundary keeps every call next to its result and the stored order true. The event stream shows a message once it's delivered, which is when it becomes part of the conversation.

### 2. A received message is a user message with a sender

A message the agent receives is `{"type": "message", "role": "user", "from": "<id>", "text": "..."}`, where `from` is the sender's agent ID or `owner`. The agent's own messages stay `role: "assistant"`, with no `from`. Every provider has a user role, and a received message is exactly that, so an adapter needs one line, not a new case. The Responses adapter sends it as user content that starts with a header naming the sender, `From: <id>`, followed by a blank line and the text.

*Rejected:* a separate item type for received messages. Every adapter would map it to a user message anyway, and the port would have two ways to say the same thing.

### 3. Work is derived from the store, and the loop is one step at a time

`runTurn()` is replaced by a step function, and `respond()` by a loop that runs while there's work. There's work when the inbox holds a message, or when the conversation doesn't end with an assistant message, meaning it ends with a received message, a tool call or a tool result. One step is:

1. Deliver the inbox (decision 1).
2. If the conversation ends with tool calls that have no result, which only happens after a crash, give each one the result `Error: interrupted before its result was saved, so whether it took effect is unknown`.
3. Call the model with the whole conversation, and save its response the moment it returns.
4. Run each tool call in the response in order, saving each result as it finishes.

Each save is its own transaction, and each one is streamed right after (`deliver()` is already written to be called after any save). The agent runs the loop at startup and whenever a message is accepted while it isn't already running. Nothing is kept in memory between steps except the flag saying the loop is running.

So the agent resumes after a crash, a stop or a redeploy with no special code. A tool call whose result was saved is never run again. One whose result wasn't is reported to the model as unknown, and the model decides whether to retry. This was the open question in the proposal discussion. Keeping it in the model follows the tenet that logic lives in the weights, and it's the only safe choice for calls such as spawn that can't be undone.

*Rejected:* saving each tool call only once it has run. A crash between running and saving would leave no trace of a spawn that happened, and the model would spawn again.

### 4. A failed model call is retried, and then the agent waits

A failed model call saves nothing. The agent retries the step after 1, 5 and 25 seconds. If all of those fail, it stops looping until a message arrives or it's started again, and either one resumes the work where it stopped. Each failure is sent to every open event stream as an `error` event with `{"message": "..."}`, no `id` and nothing saved. That's how a watcher, such as the owner, learns of it now that `POST /messages` no longer waits for the turn. It's the first event type besides `item`, as the 2026-10-28 decision anticipated.

*Rejected:* retrying without limit, which hides a broken model behind endless calls, and not retrying, which leaves a sub-agent silent after one transient error while its parent sleeps waiting for it.

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

- `send_message` `{to, text}`, always offered. Sending to `owner` from a root agent calls nothing. The tool call itself is on the agent's event stream, which is where the owner reads it, so the tool only answers that it was delivered. Any other target goes through the runtime, which refuses targets the agent can't reach.
- `spawn_agent` `{grant}`, `list_agents`, `stop_agent` `{id}`, `start_agent` `{id}` and `delete_agent` `{id}`, offered only when the grant has `spawn`. Without `spawn` an agent can't have sub-agents, so these would have nothing to act on.

A runtime refusal becomes a tool error with the runtime's status and message, which the loop already reports to the model as `Error: ...`.

### 9. The model port gains system instructions

`Model.next()` takes a third argument, `instructions`, a string. The Responses adapter sends it as `instructions`, and the scripted model records it. The agent builds it from its ID, its parent's ID and its grant. It says, briefly, that the agent is one of a tree of agents. Its text output reaches no one, so anything for another agent has to be sent. Messages from others arrive as user messages naming their sender. To wait for an answer, it ends its turn, and the answer will wake it. It should tell its parent when its work is done.

This is the caller the 2026-10-26 rule was waiting for. An agent can't follow "talk only by sending" without being told. The instructions are a prompt, so how well they work is a question for the live check, not for unit tests.

## Risks / Trade-offs

- [Two agents message each other forever and spend without limit] → Only depth and count bound the tree until the model proxy makes spend a bound. The instructions ask agents to report when done, not to narrate.
- [An agent floods another's inbox] → Each message is bounded at 1 MiB, but their number isn't. Within a tree, everyone shares one owner, so this is a bug, not an attack. It's revisited with communication between agents that aren't parent and child.
- [A child whose model keeps failing goes silent, and its parent sleeps waiting] → It shows `error` events on its stream, and any message, such as a parent's "how's it going?", makes it try again. Telling a parent automatically is left until a real tree shows the need.
- [The model forgets to send, and its answer goes nowhere] → The instructions say so plainly, and the live check exercises it. The answer is still on its stream.
- [An interrupted tool call is reported as unknown even when it never started] → The model retries it. The cost is one extra call, and the alternative is never knowing.
- [A message during a long model call waits for it] → The wait is one step. Cancellation is added to the port if that proves too slow.

## Migration Plan

None. Stored conversations from before this change hold user messages without a sender, which aren't supported, so delete and spawn existing agents again. The live checks and the commands in `context/environment.md` change to read replies from the event stream.
