# Design

## Context

See proposal.md for why. Today:

- **An agent answers only with `send_message`.** A turn ends when the model replies without a tool call (`src/agent/loop.ts`), and that reply is saved and streamed but sent to no one. A root's send to `owner` makes no request: saving its `delivered` result is the delivery. An interrupted send to `owner` is recorded as not delivered.
- **The loop works one saved step at a time, entirely from its store.** A step settles outstanding tool calls one at a time, delivers the inbox, then calls the model. On start, the first outstanding call is marked interrupted and the rest not run. An urgent message cancels the call in flight. A waking start holds the loop until its message arrives.
- **Only one message goes up today without the model sending it:** the give-up notice. It's posted to the parent once, and a failed post falls back to the agent's own stream.
- **The runtime already routes a child's message to its parent,** and reports a sub-agent whose restarts ran out, from `runtime`.

The prototype behind the proposal is the lab variant `bc3` from 2026-11-06. It held the reply and `wait` in memory and lost both on a crash. This design keeps its behavior and puts its state in the store.

## Goals / Non-Goals

**Goals:**

- Everything the reply and `wait` depend on lives in the store, so a crash, stop or restart resumes exactly, as the rest of the loop already does.
- An agent waiting on its sub-agents never waits forever because of something it can't see.
- No new route, item type or runtime behavior.

**Non-Goals:**

- Stopping an agent from trying to message its parent. A refusal corrects it at the cost of one model call (decision 3).
- Filtering filler such as "done" out of replies in code. That's the instructions' job, and the live check catches it.

## Decisions

### 1. A reply goes through an outbox in the store

When the loop saves a model response with no tool calls, it computes the reply in the same transaction: the response's assistant text, joined and trimmed. If the reply isn't empty and the agent has a parent agent, the transaction also puts it in a new `outbox` table. After every save, the loop sends the outbox to the parent in order, through the runtime's route to the parent, and deletes each entry once the runtime answers `202`. On start, it sends whatever the outbox still holds before running anything else.

A failed post is retried with the model-call delays (`RETRY_DELAYS_MS`). If every retry fails, the entry stays in the outbox. Each later save and each start tries it again, and the agent's stream shows a notice in the meantime, as a root's give-up notice is shown today. A `404`, meaning the parent was deleted, drops the entry, since no one is left to read it.

A root has no outbox. Its reply is the saved assistant message on its stream, which is where the owner already reads it.

The give-up notice moves into the outbox too. It then gets the same retries instead of one attempt, and the code has one way to send upward.

*Why an outbox, not a post after the save?* A crash between saving the response and posting it would lose the reply, and the parent would wait for something that never comes. With the outbox, a reply is durable from the moment its response is saved. It's the inbox decision of 2026-11-03, mirrored. A crash between the runtime's `202` and the delete sends the reply twice. That's rare, and the parent's model sees the repeat and ignores it, which is better than a lost reply.

*Rejected:* letting the runtime read the reply off the agent's stream. It would give the runtime a second job, watching every agent, and the runtime is meant to stay small.

### 2. An agent that owes its parent a reply always sends one

An agent owes its parent a reply once a message from its parent has been delivered to it since its last reply. Delivered means it reached the conversation or a `wait` result (decision 5). When a turn ends while the agent owes a reply and its final text is empty, the outbox gets the fixed reply `(I ended my turn without a reply.)` instead. An empty final text that owes nothing sends nothing. That case covers a turn woken only by a runtime notice, or a turn that ends after a reply already went up in it.

*Why:* a parent waiting on a sub-agent counts it as working until it replies (decision 6). A sub-agent that took a correction as needing no answer, and ended its turn empty, would leave its parent waiting forever. The fixed reply costs the parent one model call, and only when the sub-agent went silent on something its parent sent. This narrows the proposal's "an empty final text sends nothing" to empty replies nobody is waiting for.

### 3. Sends go down only, refused upward, not constrained by the schema

`send_message` becomes `message_sub_agent`, with the same `to`, `text` and `urgent`. A send whose `to` is the agent's parent or `owner` makes no request, and its result is `Error: you answer your parent by ending your turn with your reply, not with message_sub_agent.` Any other `to` goes to the runtime, which still answers `404` for an agent out of reach. An agent without `spawn` gets no send tool, and so has no tools at all.

*Rejected:* letting the schema rule the parent out. The lab tried this on 2026-11-07, by limiting `to` to the agent's current sub-agents with an `enum`:
- With `strict: false`, as the Responses adapter sends today, Luna ignored the `enum` and tried its parent in 4 of 18 runs, the same as without it.
- With `strict: true`, upward sends stopped. But in the nested task, leads kept messaging sub-agents that had already finished, up to 20 messages and 8 of them urgent, and in one run the result never reached the owner.

A refusal costs one model call, and the agent then answers correctly, so it stays.

*Rejected:* treating a send to the parent as the agent's reply. An agent would then have two ways to answer upward, and an agent that both sends its result and ends its turn with it would answer twice.

### 4. The root's special send to `owner` is removed

There's no `toOwner` path, no saved-result delivery, and no interrupted-send handling for it. A root that ends its turn has replied. The owner reads the root's assistant messages on `/events`. A reply is a saved assistant message with no tool call in the same response, and it's sent when it's saved. Owner clients, meaning the live checks and the commands in `context/environment.md`, read replies that way.

### 5. `wait` is answered by the inbox, from the store

`wait` is a built-in tool of the loop, offered when the agent's options say so, which `main.ts` sets for agents with `spawn`. It's never run like other tools. The loop answers it:

- **Ordering in a batch.** When settling a batch, the loop runs every other call first, so the batch's sends go out before the agent starts waiting. A second `wait` in the same batch gets `Error: you already waited in this batch.`
- **Answering.** When it's the call's turn, the loop answers it at once if the inbox holds a message, or if no sub-agent is working (decision 6). Otherwise the loop stops, holding nothing in memory. The open `wait` is the state.
- **Kicking.** Every accepted message starts the loop, as it does today. The step answers the `wait` with the inbox in one store transaction: it saves the call's result and clears the inbox. So a message is never both in the result and delivered on its own, and a crash leaves either both undone or both done.
- **Urgent messages.** An urgent message doesn't cancel a `wait`, because nothing is in flight and the loop isn't running. In a batch whose earlier calls are skipped for an urgent message, a `wait` is still answered, with the inbox, rather than skipped.
- **Restarts.** On start, an open `wait` that's the only outstanding call stays open, and the loop answers it as above. If other calls of its batch are outstanding, the existing recovery applies to the whole batch, and the `wait` gets the not-run result too, since the model must re-plan a batch that a stop interrupted.

The result is each message as `From: <sender>`, a blank line, then the text, with messages separated by `---`. Then comes the status line (decision 6). That's the same header the model sees for a delivered message.

*Why not block in a promise, as the prototype did?* A promise lives in memory, so a restart lost the wait and marked it interrupted. With the open call as the state, an agent waiting for two weeks is just a conversation whose last item is a tool call. Stop, crash and redeploy then need no special code, which keeps the store-only goal of 2026-11-03.

### 6. Who still owes a reply is kept in the store, and checked against the runtime

The store gets an `owed` table of sub-agent IDs:
- `message_sub_agent` records the receiver before it posts, and removes it again if the post fails. Recording first means a reply that arrives fast can't land before its debt exists.
- Accepting a message clears its sender's row, in the same transaction that saves the message.
- `stop_agent` and `delete_agent` clear the row for the sub-agent they name.

A sub-agent counts as working when it owes a reply and the runtime lists it as running. The loop asks the runtime for the agent's list (`GET /agents`) when it answers a `wait`. A sub-agent whose restarts ran out, or that's still stopped after the agent was started again, owes a reply but isn't running. So `wait` never waits on it, and the runtime's notice already tells the model why. If the runtime can't be reached, every owed sub-agent counts as working.

The status line ends every `wait` result:
- "Still working: <ids>."
- "Every sub-agent you sent work to has replied."
- for a `wait` answered at once with nobody working and nothing in the inbox, "Nothing to wait for: none of your sub-agents owes you a reply."

*Why both records?* The runtime knows what's running, but not who owes a reply: a sub-agent that finished is still running, idle. The agent knows who owes it a reply, but not who crashed out. Together they say who will still answer.

*Rejected:* counting from the conversation, as the prototype did, by matching sends against `From:` lines. It parsed the agent's own result text, and a message containing a `From:` line could forge a reply.

### 7. The instructions

Rewritten around three rules: end your turn when you have something for your parent; talk to sub-agents with `message_sub_agent`; call `wait` when you can't go on without an answer. They keep the rules that held up in the lab: delegate and let sub-agents manage theirs; ask your parent first; leave delegated work alone while you wait; one complete result; never acknowledge; urgent only when waiting would cause harm or waste. The added line "when your parent asks you to send or report something, reply with it" is what cut upward sends from about 12 to 4 in 18 runs.

The lab variant `bc3`'s text, in `src/agent/delegation.ts` of that variant, is the starting point. Its tool results stay short and act as cues: a send returns `delivered. The reply will come to you. Call wait when you have nothing else to do.` The spec lists what the instructions must say, not their wording, so the wording can be tuned against the live check.

### 8. The behavior live check

The behavior live check is `src/runtime/behavior.live.test.ts`. It sits beside the runtime check, since it drives the runtime's API and builds both images the same way. It starts its own runtime, then runs the six owner tasks from the lab, three times each, in parallel, each with its own root. The task that needs an answer first gets "Maya and Jordan." in reply to the root's first reply. A run is settled after 30 seconds with no new event on any of its agents' streams, or fails after 6 minutes.

A run fails on any of these:
- the owner gets a number of replies other than the task's expected number
- any `list_agents` call
- a refused or failed tool call
- a message sent twice with the same text
- a reply that's only filler, under 10 characters
- a model error event
- not settling in time

A failure prints the run's transcript in the lab's compact form.

The existing delegation check in `src/runtime/runtime.live.test.ts` keeps its scenario, the sub-agent's question and the root's answer, but reads replies as decision 4 says.

*Why three runs of each, all required?* Luna varies from run to run, and one run of each would pass a design that fails one run in six. Eighteen runs take about two minutes in parallel against Luna.

## Risks / Trade-offs

- [The strict check fails on refused upward sends in about 1 run in 5, on today's evidence] → The instructions are tuned against the check during implementation. If they can't bring refusals near zero, the maintainer decides whether a refusal fails a run or only counts against it, before the check is committed.
- [A sub-agent's filler reply such as "done" goes to its parent] → The instructions, and a check failure on any reply under 10 characters.
- [A reply is sent twice after a crash between the runtime's `202` and the outbox delete] → Rare, and the parent's model sees the repeat. It's chosen over a lost reply (decision 1).
- [A reply waits behind a retry for a parent that's down] → It's durable in the outbox and sent on the next save or start. A parent that's down is stopped, and the runtime starts it for the message.
- [`wait` answers from a runtime list that's out of date] → The list is read each time a `wait` is answered, and a sub-agent that stops after that sends its notice from `runtime`, which wakes the `wait`.
- [A model that never calls `wait` and ends its turn instead] → Its final text goes to its parent as a status report. The instructions and the check's reply counts catch it.

## Migration Plan

None. jen has no adopters, and stored conversations aren't migrated. An agent whose store predates this change is deleted and spawned again. Rollback is reverting the change.
