# Proposal

## Why

Delegation ([JEN-11](https://linear.app/reveer/issue/JEN-11)) works on a strong model but not on a model of `openai/gpt-6-luna`'s class, and the tasks we tried are simple. In a lab harness on 2026-11-06 with six owner tasks, Luna with the instructions as merged sent the owner exactly the right messages in 3 of 12 runs. It polled `list_agents` 25 times while it waited, nudged sub-agents, sent progress updates, and messaged agents it couldn't reach. Tuning the wording raised that to 15 of 18 runs. The runs that still failed all failed at the same point: when an agent had to wait.

The cause is the design. An agent waits by ending its turn, and its final text reaches no one, so it answers with a `send_message` call and then ends its turn on an empty line. A model is trained to read ending its turn as "I'm finished, here's my answer". We ask it to end its turn while the work is unfinished, and then to stay silent. Luna fills the gap: it sends an empty message or a status update, or does the delegated work itself.

jen's agents should behave on Luna. This change ([JEN-12](https://linear.app/reveer/issue/JEN-12)) makes talking between agents follow the shape models are trained on. An agent answers its parent by ending its turn, as in a chat. It talks to its sub-agents with tool calls, and it waits for their replies with a tool call that returns them. A prototype of this design sent the owner exactly the right messages in 18 of 18 Luna runs. It made no polling calls, sent no status updates, nudges or duplicate results, and never hung. It's done when a strict live check of these tasks passes on Luna.

## What Changes

- **A turn's final text is the agent's reply to its parent.** **BREAKING:** when an agent ends its turn, its final text is sent to its parent as a message from the agent. A root's final text is its reply to the owner, read on its event stream. An empty final text sends nothing. Ending a turn means "here's my result" or "here's my question", the same as in a chat, and it's the only way an agent answers its parent.
- **Agents send only downward.** **BREAKING:** `send_message` becomes `message_sub_agent`. It takes the same fields and reaches only the agent's own sub-agents. A send to the agent's parent or to `owner` is refused, with a result saying to reply by ending the turn. The root's special send to `owner`, delivered by saving its result, is removed, along with its handling of interrupted sends. An agent without `spawn` has no sub-agents, so it has no send tool. **Supersedes in part** the 2026-11-03 decision that agents talk only by sending, and the 2026-11-04 decision that a child can send its parent an urgent message.
- **An agent waits for replies with `wait`.** An agent with `spawn` gets a `wait` tool. The call returns as soon as the agent's inbox holds a message, from anyone, plain or urgent, and its result is those messages with their senders. Until then the agent makes no model calls, and its sub-agents keep working. A wait survives a stop, crash or restart and carries on when the agent starts again. An agent that has other work does it first. Replies that arrive meanwhile reach it between steps, as messages do today.
- **`wait` knows who owes a reply.** A sub-agent owes its parent a reply from the time the parent's send is delivered until the sub-agent next replies. Each `wait` result ends by naming the sub-agents still working, or saying that every one has replied. A `wait` while nobody owes a reply and the inbox is empty returns at once, saying there's nothing to wait for, so an agent that loses count never hangs.
- **The instructions are rewritten around the three rules.** End your turn when you have something for your parent. Talk to your sub-agents with `message_sub_agent`. Call `wait` when you can't go on without an answer. They keep the rules that held up in the lab:
  - delegate to your own sub-agents and let them manage theirs
  - ask your parent first if the work needs something only it knows
  - leave delegated work alone while you wait
  - send one complete result
  - never acknowledge
  - mark a message urgent only when waiting would cause harm or waste

  A request to "send" or "report" something means reply with it.
- **A strict live check of how agents behave.** The lab harness becomes a live check. It runs owner tasks against a runtime of its own:
  - one delegation
  - a direct answer
  - fan-out to three sub-agents
  - a task that needs a question answered first
  - a follow-up
  - a nested team

  It fails on any task where the owner gets the wrong number of replies, an agent polls `list_agents`, an agent sends a message twice or sends one that's refused, a turn ends with filler, or the run doesn't settle in time. It runs on the model the live checks already use, `openai/gpt-6-luna`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `agent-delegation`:
  - `send_message` becomes the downward-only `message_sub_agent`, and agents without `spawn` have no send tool.
  - The root's send to `owner` is removed.
  - The new `wait` tool, with its record of who owes a reply.
  - The requirement on what the instructions say.
  - The delegation live check uses replies, and the new behavior live check is added.
- `agent-loop`:
  - A turn's final text is sent to the parent, and an empty one sends nothing.
  - A `wait` call is answered by the inbox, not run like other tools. It runs after the rest of its batch, any message ends it, an urgent message doesn't cancel it, and it survives a restart.
- `agent-store`: the inbox can be delivered as the result of a `wait` call, in one transaction with saving that result.

The runtime doesn't change. A reply goes to the parent through the route a child already has to its parent.

## Impact

- **Agent code:**
  - `src/agent/delegation.ts`: the tools and instructions
  - `src/agent/loop.ts`: the turn-end reply and `wait`
  - `src/agent/store.ts`: delivering the inbox as a wait's result
  - `src/agent/main.ts`: wiring the reply to the parent
- **Owner clients:** every owner client reads a root's reply as its final assistant text, not as a `send_message` call to `owner`. That covers the live checks in `src/runtime/runtime.live.test.ts` and the commands in `context/environment.md`.
- **The new live check** is on the order of 18 model-backed runs. It takes a few minutes against Luna.
- **The architecture diagram:** `docs/architecture.html` changes where it shows a reply as a send.
- **Conversations saved before this change** end their turns the old way. jen has no adopters, so they aren't migrated.
