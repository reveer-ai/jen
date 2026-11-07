# Design

## Context

See proposal.md for why. Today:

- **An agent answers only with `send_message`.** A turn ends when the model replies without a tool call (`src/agent/loop.ts`), and that reply is saved and streamed but sent to no one. A root's send to `owner` makes no request: saving its `delivered` result is the delivery. An interrupted send to `owner` is recorded as not delivered.
- **The loop works one saved step at a time, entirely from its store.** A step settles outstanding tool calls one at a time, delivers the inbox, then calls the model. On start, the first outstanding call is marked interrupted and the rest not run. An urgent message cancels the call in flight. A waking start holds the loop until its message arrives.
- **Only one message goes up today without the model sending it:** the give-up notice. It's posted to the parent once, and a failed post falls back to the agent's own stream.
- **The runtime already routes a child's message to its parent,** and reports a sub-agent whose restarts ran out, from `runtime`.

The prototype behind the proposal is the lab variant `bc3` from 2026-11-06, refined to `bc10` on 2026-11-07 (decisions 3 and 7). It held the reply, `wait` and its count of who owes a reply in memory, and lost them on a crash. This design keeps its behavior and puts its state in the store. On 2026-11-07 the lab also tested dropping `wait` (decision 5). That did worse, so `wait` stays.

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

### 3. Sends go down only, and an agent sees no ID it can't message

`send_message` becomes `message_sub_agent`, with the same `to`, `text` and `urgent`. An agent without `spawn` gets no send tool, and so has no tools at all.

The model is never shown an agent ID it can't send to. Its own ID and its parent's are left out, and so are the IDs of its sub-agents' sub-agents:

- **The instructions** say "You are an agent in a tree of agents" and "Your parent is the user" or "Your parent is the agent that started you". Neither ID appears. The agent still reads both from its environment (decision 1 needs its parent's).
- **A message from the parent has no sender line.** The loop passes it to the model with an empty sender, and the adapter sends a message with an empty sender as plain user content, with no `From:` header. In a `wait` result it's the text alone. The parent's messages then look like a user's messages in any chat. Messages from sub-agents and from `runtime` keep their `From: <id>` line. The store still keeps the real sender.
- **Tool results omit the parent field.** `spawn_agent` returns the new agent's ID, grant and state. `list_agents` lists only the agent's own sub-agents, each with its ID, grant and state.

So the only IDs an agent knows are its sub-agents', and the two ways of talking have nothing in common. A sub-agent has an ID, and you message it. Your parent has none, and you answer it.

The tool still refuses a send to the parent's ID, to `owner`, or to a name for the parent ("the user", "your parent", "parent"), with `Error: you answer your parent by ending your turn with your reply, not with message_sub_agent.` A runtime `404` becomes `Error: you have no sub-agent <id>.`

*Evidence:* in the lab on 2026-11-07, agents tried to answer upward with the send tool in 4 of 18 runs while they still knew their parent's ID. With the wording fixes in decision 7, that fell to 2 of 18. With no sender line on the parent's messages, it fell to 0 of 36, but one lead sent its result to its own ID, which it read from the `parent` field of its `spawn_agent` results. With the parent field removed as well, it was 0 of 36, and 35 of 36 runs were fully clean.

*Rejected:* letting the schema rule the parent out, by limiting `to` to the agent's current sub-agents with an `enum`:
- With `strict: false`, as the Responses adapter sends today, Luna ignored the `enum` and tried its parent in 4 of 18 runs, the same as without it.
- With `strict: true`, upward sends stopped. But in the nested task, leads kept messaging sub-agents that had already finished, up to 20 messages and 8 of them urgent, and in one run the result never reached the owner.

Constraining the output doesn't change what the model meant to do. It only bends the call somewhere else, with no error to correct it. Hiding the address removes the reason for the mistake.

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

An open `wait` is also how the agent's state shows. An agent with an open `wait` is still working. One that ended its turn has replied. The owner sees a root's open `wait` on its stream, and a parent knows which of its sub-agents still owe it a reply from its own record (decision 6). So no message has to say that work is under way.

*Rejected:* no `wait`. An agent with nothing to do would end its turn, and a reply sent while its sub-agents still owed it theirs would carry a `working: true` flag, shown to the parent as `From: <id> (still working)`. On 2026-11-07 the lab ran this against `bc10`, 36 Luna runs per arm. The flag itself worked: it reached parents, debts cleared, and nothing hung. The behavior got worse, because `wait` was doing two jobs:
- **It's a way to stop that isn't an answer.** When the turn-ending reply could be a short note on what was under way, roots wrote the haiku themselves in 4 of 6 runs, while their sub-agent was writing it. Told to end the turn empty, they stopped doing that.
- **Its result says who's still working.** Without it, an agent woken by some of its replies re-asked or re-sent work to a sub-agent still doing it, 5 times in 36 runs. One lead looped through 16 sends. With `wait` that never happened. A status line from `runtime` after each reply, naming who still owed one, made it worse, because every message wakes the agent and gets a response.

Clean runs were 25 of 36 with the turn ended empty, and 21 of 36 with the status line, against 34 of 36 for `bc10`, all by the same tally. The maintainer then dropped the flag along with the update notes it existed to mark. An update message can come back with its flag if one proves needed. Seeing what a sub-agent is doing is [JEN-13](https://linear.app/reveer/issue/JEN-13).

### 6. Who still owes a reply is kept in the store

The store gets an `owed` table of sub-agent IDs:
- `message_sub_agent` records the receiver before it posts, and removes it again if the post fails. Recording first means a reply that arrives fast can't land before its debt exists.
- Accepting a message clears its sender's row, in the same transaction that saves the message.
- `stop_agent` and `delete_agent` clear the row for the sub-agent they name.

A sub-agent counts as working while it owes a reply. The status line ends every `wait` result:
- "Still working: <ids>."
- "Every sub-agent you sent work to has replied."
- for a `wait` answered at once with no debt and nothing in the inbox, "Nothing to wait for: none of your sub-agents owes you a reply."

**A sub-agent that stops for good is the parent's to handle.** When a sub-agent's restarts run out, or it's still stopped after the agent itself was started again, the runtime already tells the parent, from `runtime`. That message ends a `wait` like any other. The instructions say what to do with it: start the sub-agent again, or delete it and do without it. Its debt clears when it's stopped or deleted, so a later `wait` doesn't count it. A parent that does without it reports up as usual, by ending its turn when it has its result.

*Rejected:* checking owed sub-agents against the runtime's list of running agents each time a `wait` is answered, so a crashed sub-agent never counts as working. The runtime's message already tells the model, and the parent acting on it is the response the maintainer wants. Leaving the check out keeps the loop from calling the runtime and keeps it to one record. A parent that ignores the message and waits again still isn't stuck, because any message to it ends the `wait`. The owner sees a root's open `wait` on its stream and can message it.

*Rejected:* counting from the conversation, as the prototype did, by matching sends against `From:` lines. It parsed the agent's own result text, and a message containing a `From:` line could forge a reply.

### 7. The instructions

Rewritten around three rules:
- end your turn when you have something for your parent
- talk to sub-agents with `message_sub_agent`
- call `wait` when you can't go on without an answer

They keep the rules that held up in the lab: delegate and let sub-agents manage theirs; ask your parent first; leave delegated work alone while you wait; one complete result; never acknowledge; urgent only when waiting would cause harm or waste. They add one rule the lab didn't exercise: when the runtime says a sub-agent stopped, start it again, or delete it and do without it (decision 6). Three lines carry the most weight:
- "when your parent asks you to send or report something, reply with it"
- "when you write a task, ask the sub-agent to reply with its result, not to send it"
- "messages from your parent have no sender line"

The tools' text acts as cues at the moment of choice:
- A send returns `delivered. The reply will come to you. Call wait when you have nothing else to do.`
- A `wait` result whose status says every sub-agent has replied adds `End your turn with your result for your parent.`
- `message_sub_agent`'s description doesn't mention the parent at all.

In the lab, the parent mention and the missing end-of-wait cue were where most upward sends came from, right after the last reply arrived. A much shorter set of instructions did worse, 6 upward sends in 18 runs against 2.

The final lab variant's text, `bc10` from 2026-11-07, is the starting point. The spec lists what the instructions must say, not their wording, so the wording can be tuned against the live check.

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

The check counts replies, not who wrote them. In the follow-up task, a root that answers "Now one about cranes" itself instead of delegating it passes, since the follow-up doesn't name a sub-agent. By these criteria, `bc10` passed 35 of its 36 lab runs. The one failure was a send to an invented ID before any sub-agent existed.

The existing delegation check in `src/runtime/runtime.live.test.ts` keeps its scenario, the sub-agent's question and the root's answer, but reads replies as decision 4 says.

*Why three runs of each, all required?* Luna varies from run to run, and one run of each would pass a design that fails one run in six. Eighteen runs take about two minutes in parallel against Luna.

## Risks / Trade-offs

- [Luna still slips in about 1 run in 36, on 2026-11-07's evidence, for example by sending to a sub-agent before spawning it, so 18 required runs won't always all pass] → The check stays strict, since each slip is a real fault, and the instructions are tuned against it during implementation. Its pass rate is measured and reported to the maintainer before it's committed.
- [A sub-agent's filler reply such as "done" goes to its parent] → The instructions, and a check failure on any reply under 10 characters.
- [A reply is sent twice after a crash between the runtime's `202` and the outbox delete] → Rare, and the parent's model sees the repeat. It's chosen over a lost reply (decision 1).
- [A reply waits behind a retry for a parent that's down] → It's durable in the outbox and sent on the next save or start. A parent that's down is stopped, and the runtime starts it for the message.
- [A parent ignores the runtime's message that a sub-agent stopped, and waits on it again] → The instructions say to restart or delete it. The `wait` still ends on any message, so the owner, or the agent's own parent, can always reach it (decision 6).
- [The crash rule in the instructions isn't exercised by the lab tasks] → The `owed` clearing on stop and delete gets unit tests. How the model reacts to the runtime's message is left to the instructions, as it is today.
- [A model that never calls `wait` and ends its turn instead] → Its final text goes to its parent as a status report. The instructions and the check's reply counts catch it.

## Migration Plan

None. jen has no adopters, and stored conversations aren't migrated. An agent whose store predates this change is deleted and spawned again. Rollback is reverting the change.
