# Design

## Context

See proposal.md for why. Today:

- **An agent answers only with `send_message`.** A turn ends when the model replies without a tool call (`src/agent/loop.ts`). That reply is saved and streamed, but it's sent to no one. A root's send to `owner` makes no request: saving its `delivered` result is the delivery.
- **The loop works one saved step at a time, entirely from its store.** A step settles the outstanding tool calls one at a time, delivers the inbox, then calls the model. On start, the first outstanding call is marked interrupted and the rest not run. An urgent message cancels the call in flight. A waking start holds the loop until its message arrives.
- **One message goes up without the model sending it:** the give-up notice. It's posted to the parent once, and a failed post falls back to the agent's own stream.
- **The runtime routes a child's message to its parent, and pipes the body through unchanged.** It also reports a sub-agent whose restarts ran out, as a message from `runtime`.

The design was worked out in a lab harness on 2026-11-06 and 2026-11-07, which ran six owner tasks on Luna, three or six times each, against variants of the agent. The variant this design follows is `bc10`. Its instructions, its loop and tool code, and the harness were kept in a `lab/` folder beside this design until the implementation landed. They're in git at commit `b56c25b`, under `openspec/changes/add-replies-and-wait/lab/`, with a README on running the harness. The prototype held its state in memory, and this design moves that state into the store.

## Goals / Non-Goals

**Goals:**

- An agent talks the way models are trained to: it answers by ending its turn, and it uses tools for everything else.
- Everything the reply and `wait` depend on lives in the store, so a crash, stop or restart resumes exactly, as the rest of the loop already does.
- An agent waiting on its sub-agents never waits forever because of something it can't see.
- No new route or item type, and no change to the runtime.

**Non-Goals:**

- Making it impossible for an agent to try to message its parent. A refusal corrects it, at the cost of one model call.
- Filtering filler such as "done" out of replies in code. That's the instructions' job, and the live check catches it.

## How it works

### An example

The owner asks a root to have a sub-agent write a haiku.

1. The root calls `spawn_agent`, which returns `a1`. It then calls `message_sub_agent` to `a1` with the task. The send returns `delivered` at once, and the root records that `a1` owes it a reply.
2. The root has nothing else to do, so it calls `wait`. The loop stops, and the open `wait` call is saved in the store. On its stream, the owner sees that the root is waiting.
3. `a1` gets the task as a message with no sender line, the way a user's message looks in a chat. It writes the haiku and ends its turn. Its final text goes into its outbox and is posted to the root.
4. The root accepts `a1`'s message, which clears `a1`'s debt, and answers the open `wait` with it:

   ```
   From: a1

   <the haiku>

   ---

   Every sub-agent you sent work to has replied. End your turn with your result for your parent.
   ```
5. The root ends its turn with the haiku. That's its reply, which the owner reads on the root's stream.

The owner can message the root at any point. The message ends the `wait`, and the root answers it and calls `wait` again.

### An agent has three moves

- **Answer its parent by ending its turn.** The final text of a turn is the reply. It's the only way an agent answers its parent.
- **Talk to its sub-agents with `message_sub_agent`.** It takes `to`, `text` and `urgent`. It reaches only the agent's own sub-agents and returns at once. It replaces `send_message`. An agent without `spawn` has no sub-agents, so it gets no send tool, and no tools at all.
- **Call `wait` when it can't go on without a reply.** Only agents with `spawn` get it. It returns as soon as any message arrives: a reply, a message from the parent, or one from `runtime`.

An agent that has other work does it first. Replies that arrive meanwhile reach it between steps, as messages do today.

### An agent sees no ID it can't message

The only agent IDs the model ever sees are its sub-agents', so it has no address to answer its parent with:

- **The instructions** say "You are an agent in a tree of agents" and "Your parent is the user" or "Your parent is the agent that started you". They give neither the agent's own ID nor its parent's. The agent still reads both from its environment, to post its replies.
- **A message from the parent has no sender line.** The loop passes it to the model with an empty sender. The adapter sends a message with an empty sender as plain user content with no `From:` header, and a `wait` result shows the text alone. Messages from sub-agents and from `runtime` keep their `From: <id>` line, and the store keeps the real sender.
- **Tool results leave out the parent field.** `spawn_agent`, `stop_agent` and `start_agent` return the agent's ID, grant and state. `list_agents` lists only the agent's own sub-agents, each with its ID, grant and state.

`message_sub_agent` checks the receiver itself before it records a debt or posts. The runtime is unchanged, and it delivers a message to the sender's parent and to every descendant, not only to direct sub-agents. So the tool looks `to` up through the runtime (`GET /agents/<to>`) and goes on only if the agent's parent is this agent. A grandchild fails the check: its reply would go to its own parent, so this agent would wait on it forever. The parent, `owner` and made-up names get a `404` from the lookup. Every send that fails the check posts nothing and fails with one error: `Error: you have no sub-agent <to>. To answer your parent, end your turn with your reply.` A sub-agent deleted between the lookup and the post gets the same error from the post's `404`. The agent doesn't guess at names a model might use for its parent. An earlier version refused a fixed list ("owner", "user", "your parent" and so on), and a live run's `[user]` slipped past it.

### A reply goes up through an outbox

When the loop saves a model response with no tool calls, the same transaction computes the reply: the response's assistant text, joined and trimmed. If the agent has a parent agent, the transaction puts the reply in a new `outbox` table. After every save, the loop posts the outbox to the parent in order, through the runtime's route to the parent. It deletes each entry once the runtime answers `202`. On start, it sends whatever the outbox still holds before doing anything else.

- **Retries.** A failed post is retried with the model-call delays (`RETRY_DELAYS_MS`). If every retry fails, the entry stays in the outbox, and each later save and each start tries it again. The agent's stream shows a notice in the meantime, as a root's give-up notice is shown today. A `404`, meaning the parent was deleted, drops the entry. Each attempt fails after 60 seconds without an answer (`POST_DEADLINE_MS`), so a request that's accepted and never answered can't hold the outbox.
- **A root has no outbox.** Its reply is the saved assistant message on its stream, which is where the owner reads it. The root's special send to `owner` is removed, along with its saved-result delivery and its interrupted-send handling. Owner clients read replies as assistant messages with no tool call in the same response. Those are the live checks and the commands in `record/environment.md`.
- **The give-up notice moves into the outbox**, so it gets the same retries, and there's one way up.

### An empty reply never wakes anyone

An agent owes its parent a reply once a message from its parent has been delivered to it since its last reply. A turn's final text can be empty, for example after the parent sent "Thanks". When it is:

- **Nothing is owed:** nothing is sent.
- **A reply is owed:** the outbox posts the empty reply, a message with empty text.

At the parent, an empty reply is a reply like any other, with one difference: it never wakes the agent by itself.

- **It clears the sender's debt** when it's accepted, as any message does.
- **Only a `wait` shows it.** It's shown as what the sub-agent replied: `From: a1` with nothing under it. When nothing else is owed, it answers an open `wait` straight away. Otherwise it waits in the inbox and comes with the next message that ends the `wait`.
- **It's never delivered as a conversation message.** A pending empty reply is dropped when the agent ends its turn, because the agent has moved on and the debt is already cleared. A later `wait` for other work never shows a stale one.

So a parent that said thanks spends no model call on the silence. A parent that was waiting for a result sees that the reply was empty, and can ask again.

The protocol changes in one place: `POST /messages` accepts empty `text`.

### Waiting is a saved tool call

`wait` is built into the loop. It's never run like other tools: the loop answers it.

- **In a batch.** The loop runs the batch's other calls first, so its sends go out before the agent waits. A second `wait` in the same batch gets `Error: you already waited in this batch.`
- **Answering.** When the `wait` comes up, the loop answers it at once if the inbox holds a message, or if no sub-agent owes a reply. Otherwise the loop stops, holding nothing in memory. The open `wait` is the state.
- **When a message arrives.** Every accepted message starts the loop, as it does today. The loop answers the `wait` from the inbox in one store transaction: it saves the call's result and clears the inbox. A message is then never both in the result and delivered on its own, and a crash leaves either both undone or both done.
- **Urgent messages** don't cancel a `wait`, since nothing is in flight. In a batch whose earlier calls are skipped for an urgent message, the `wait` is still answered with the inbox, not skipped.
- **Restarts.** On start, an open `wait` that's the only outstanding call stays open, and the loop answers it as above. If other calls of its batch are still outstanding, the existing recovery applies to the whole batch, and the `wait` gets the not-run result too.

**The result.** Each message is shown as `From: <sender>`, a blank line, then the text, and messages are separated by `---`. An empty reply is the header alone. A status line ends the result:

| When | Status line |
|---|---|
| A sub-agent still owes a reply | `Still working: <ids>.` |
| Every sub-agent replied | `Every sub-agent you sent work to has replied. End your turn with your result for your parent.` |
| The `wait` was answered at once, with nothing owed and nothing in the inbox | `Nothing to wait for: none of your sub-agents owes you a reply.` |


An open `wait` is also how the agent's state shows. An agent with an open `wait` is still working, and one that ended its turn has replied. The owner sees a root's open `wait` on its stream. A parent knows which sub-agents owe it a reply from its own record. So no message needs to say that work is under way.

### Who owes a reply is a table in the store

The store gets an `owed` table of sub-agent IDs:

- **`message_sub_agent`** records the receiver before it posts, and removes it again if the post fails. Recording first means a reply that arrives fast can't land before its debt exists.
- **Accepting a message** clears its sender's row, in the same transaction that saves the message. An empty reply clears it too.
- **`stop_agent` and `delete_agent`** clear the row of the sub-agent they name.

### When a sub-agent stops for good

When a sub-agent's restarts run out, or it's still stopped after the agent itself was started again, the runtime already tells the parent, from `runtime`. That message ends a `wait` like any other. The instructions say what to do: start the sub-agent again, or delete it and do without it. Stopping or deleting it clears its debt, so the next `wait` doesn't count it. A parent that does without it reports up as usual, by ending its turn with its result.

A parent that ignores the message and waits again still isn't stuck. Any message to it ends the `wait`, and the owner can see a root's open `wait` and message it.

### The instructions

They're written around the three moves:
- end your turn when you have something for your parent
- talk to your sub-agents with `message_sub_agent`
- call `wait` when you can't go on without an answer

They keep the rules that held up in the lab:
- delegate, and let sub-agents manage theirs
- ask your parent first when the work needs something only it knows
- leave delegated work alone while you wait
- send one complete result
- never acknowledge
- mark a message urgent only when waiting would cause harm or waste

They add one rule the lab didn't exercise: when the runtime says a sub-agent stopped, start it again, or delete it and do without it.

Three lines carry the most weight:
- "when your parent asks you to send or report something, reply with it"
- "when you write a task, ask the sub-agent to reply with its result, not to send it"
- "messages from your parent have no sender line"

The tools' text gives cues at the moment of choice:
- A send returns `delivered. The reply will come to you. Call wait when you have nothing else to do.`
- The `wait` status that every sub-agent has replied ends with `End your turn with your result for your parent.`
- `message_sub_agent`'s description doesn't mention the parent at all.

`bc10`'s text (`lab/bc10-instructions.md` at `b56c25b`) is the starting point. The spec lists what the instructions must say, not their wording, so the wording can be tuned against the live check.

### The behavior live check

`src/runtime/behavior.live.test.ts` sits beside the runtime check, since it drives the runtime's API and builds both images the same way. It starts its own runtime and runs the six lab tasks, three times each, in parallel, each with its own root:
- one delegation
- a direct answer
- fan-out to three sub-agents
- a task that needs a question answered first. It gets "Maya and Jordan." in reply to the root's first reply.
- a follow-up
- a nested team

A run is settled after 30 seconds with no new event on any of its agents' streams, and fails after 6 minutes. A run fails on any of these:
- the owner gets a number of replies other than the task's expected number
- any `list_agents` call
- a refused or failed tool call
- a message sent twice to the same receiver with the same text
- a sub-agent's reply that's only filler, 1 to 9 characters. A root's can be that short: the direct answer is "Canberra."
- a model error event
- not settling in time

A failure prints the run's transcript in the lab's compact form. The check counts replies, not who wrote them. In the follow-up task, a root that answers "Now one about cranes" itself instead of delegating it passes, because the follow-up doesn't name a sub-agent.

The existing delegation check in `src/runtime/runtime.live.test.ts` keeps its scenario: the sub-agent's question and the root's answer. It now reads replies as assistant messages.

*Why three runs of each, all required?* Luna varies from run to run, and one run of each would pass a design that fails one run in six. Eighteen runs take about two minutes in parallel.

## Why this design, and what was rejected

All results are Luna lab runs. A clean run is one in which the owner gets exactly the right replies, with no extra sends, errors, polls or status messages.

**Answering by ending the turn, and waiting with a tool.** With the instructions as merged, 3 of 12 runs were right. Tuning the wording raised that to 15 of 18. Every remaining failure happened while an agent waited, because ending a turn to wait, with text that reached no one, goes against how models are trained. The first prototype of this design passed 18 of 18.

**Hiding IDs, rather than limiting the schema.** While agents knew their parent's ID, they tried to answer upward with the send tool in 4 of 18 runs, and in 2 of 18 after the wording fixes. With no sender line on the parent's messages, it fell to 0 of 36. But one lead then sent its result to its own ID, which it read from the `parent` field of its `spawn_agent` results. With that field removed too, `bc10` was 0 of 36. It passed 35 of 36 by the live check's criteria. The one failure was a send to an invented ID before any sub-agent existed. Rejected along the way:
- *Limiting `to` to the agent's sub-agents with an `enum`.* With `strict: false`, which the adapter sends today, Luna ignored it, 4 of 18. With `strict: true`, upward sends stopped. But in the nested task, leads flooded finished sub-agents with up to 20 messages, 8 of them urgent, and once the result never reached the owner. Constraining the output doesn't change what the model meant to do. It bends the call somewhere else, with no error to correct it.
- *Treating a send to the parent as the reply.* An agent would then have two ways to answer, and one that sent its result and also ended its turn with it would answer twice.

**Keeping `wait`, rather than ending the turn and flagging replies as still working.** The lab ran the flag version against `bc10` on 2026-11-07. The flag itself worked, but `wait` turned out to do two jobs:
- *It's a way to stop that isn't an answer.* When the reply that ended the turn could be a short note on what was under way, roots wrote the haiku themselves in 4 of 6 runs, while their sub-agent was writing it.
- *Its result says who's still working.* Without it, an agent woken by some of its replies re-asked or re-sent work to a sub-agent still doing it, 5 times in 36 runs. One lead looped through 16 sends. A status message from `runtime` after each reply made it worse, because every message wakes the agent and gets a response.

Clean runs were 25 of 36 with the turn ended empty, and 21 of 36 with the status message, against 34 of 36 for `bc10` by the same tally. The maintainer dropped the flag, along with the update notes it existed to mark. Seeing what a sub-agent is doing is [JEN-13](https://linear.app/reveer/issue/JEN-13).

**An empty reply that only `wait` shows, rather than a fixed message.** Two tests compared the forms. In the first, the root thanks its sub-agent, 6 runs per form. In the second, every leaf drops its first reply, 9 runs per form:

| Form | Thanks: an extra reply to the owner | Thanks: the parent woken for nothing | Missing result: the parent asks again |
|---|---|---|---|
| A fixed message, `(I ended my turn without a reply.)` | 3 of 6 | 6 of 6 | 9 of 9 |
| An empty message, delivered like any other | 0 of 6 | 6 of 6 | 9 of 9 |
| A signal that wakes no one, reported by `wait` as "a1 ended its turn without a reply." | 0 of 6 | 0 of 6 | 9 of 9 |

The maintainer rejected the fixed message as artificial. In the lab, a root woken by its text often wrote the owner a second reply about the thank-you. The empty message, shown as a bare `From:` line, made parents ask again in every run, but delivered like any message it woke the parent after every thank-you. The signal woke no one, but reported the silence in words of the runtime's own. In an earlier version of it, the status line still said every sub-agent had replied, and one root wrote the haiku itself. The design takes the empty message's form and the signal's timing: the reply is shown as it is, and only by a `wait`. With the signal, the full set of tasks was 36 of 36 for the owner's replies and 35 of 36 clean. The one miss delegated the direct question.

The combination was run on 2026-11-07, on `bc10` with the approved empty reply:
- **Thanks, 6 runs:** 6 of 6 clean. No run drew an extra owner reply, and no root was woken by the empty reply. In 5 runs the root replied to the owner straight after thanking. In one it called `wait` first, and the empty reply answered it at once.
- **Every leaf drops its first reply, 9 runs** (delegation, fan-out and nested team, 3 each): every parent asked again, all 9 times, and every owner got the result. Parents asked for "the haiku text" or said "your reply came through blank". No root wrote the work itself. The faults all came after the re-ask: one `list_agents` call in each of 2 runs, a lead that thanked its sub-agents, and 2 tries to send a result upward. One was refused. The other went to `user`, which the lab didn't refuse, which is why every send to a non-sub-agent now says how to answer the parent (see above).
- **The six live-check tasks, 3 runs each:** 18 of 18 clean.

**The parent handles a crashed sub-agent, rather than `wait` checking the runtime.** `wait` could ask the runtime which owed sub-agents are still running, so it never counts a crashed one. The runtime's message already tells the model, and the maintainer wants the parent to act on it. Leaving the check out keeps the loop from calling the runtime, and keeps one record of who owes a reply.

**The store holds the reply and the wait.**
- *An outbox, not a post after the save.* A crash between saving and posting would lose the reply, and the parent would wait forever. A crash between the runtime's `202` and the delete sends the reply twice. That's rare, and better than a lost reply. It's the 2026-11-03 inbox decision, mirrored.
- *The open call as the wait's state, not a promise.* The prototype's promise was lost on restart, and the wait was marked interrupted. With the open call as the state, an agent waiting two weeks is just a conversation whose last item is a tool call.
- *An `owed` table, not counting from the conversation.* The prototype matched sends against `From:` lines. It parsed its own result text, and a message containing a `From:` line could forge a reply.
- *Not letting the runtime read replies off the agent's stream.* That would give the runtime a second job, watching every agent, and the runtime is meant to stay small.

## Risks / Trade-offs

- [Luna still slips in about 1 run in 36, for example by sending to a sub-agent before spawning it, so 18 required runs won't always all pass] → The check stays strict, since each slip is a real fault, and the instructions are tuned against it during implementation. Its pass rate is measured and reported to the maintainer before it's committed.
- [A sub-agent's filler reply such as "done" goes to its parent] → The instructions, and a check failure on any sub-agent's reply of 1 to 9 characters.
- [A reply is sent twice after a crash between the runtime's `202` and the outbox delete] → Rare, and the parent's model sees the repeat. It's chosen over a lost reply.
- [A reply waits behind a retry for a parent that's down] → It's durable in the outbox and sent on the next save or start. A parent that's down is stopped, and the runtime starts it for the message.
- [A parent ignores the runtime's message that a sub-agent stopped, and waits on it again] → The instructions say to restart or delete it, and any message still ends the `wait`.
- [The crash rule and the empty reply aren't exercised by the live check's tasks] → The `owed` clearing on stop and delete, and the loop's handling of an empty reply, get unit tests. The combination passed the thanks and dropped-reply lab tasks on 2026-11-07.
- [A model that never calls `wait` and ends its turn instead] → Its final text goes to its parent as its reply. The instructions and the check's reply counts catch it.

## Migration Plan

None. jen has no adopters, and stored conversations aren't migrated. An agent whose store predates this change is deleted and spawned again. Rollback is reverting the change.
