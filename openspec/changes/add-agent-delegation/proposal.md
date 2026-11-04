# Proposal

## Why

The runtime ([JEN-10](https://linear.app/reveer/issue/JEN-10)) can start, stop and delete a tree of agents, but no agent uses it. An agent can't spawn a sub-agent, talk to one, or hear back from one. An agent is also deaf while it works: a message during a turn gets `409`, which JEN-9 left as a placeholder. This change teaches an agent to delegate ([JEN-11](https://linear.app/reveer/issue/JEN-11)). It's done when an agent delegates work to a sub-agent and they converse in both directions until the work is done.

Delegation is modelled on how people work together, without people's limits. A parent can interrupt a sub-agent, and a sub-agent can ask its parent a question, and both carry on afterwards. A parent can stop or delete a sub-agent that isn't working out. Unlike a person, an agent can answer a question and keep working in the same breath. The user is the root agent's parent and nothing more, so the user interrupts the root the same way the root interrupts its sub-agents, and is asked questions the same way. One mechanism covers all of it, and what an agent does with a message is up to its model, as the tenet that logic lives in the weights requires.

## What Changes

- **Every agent has an inbox, and sending never waits for a reply.** **BREAKING:** `POST /messages` answers once the message is saved, not once a turn ends, and its body no longer holds a reply. A reply is just another message, sent back later. This also ends the deadlock where two agents each wait on the other.
- **A message reaches the agent at its next step.** A message that arrives mid-turn goes into the conversation between one model or tool call and the next, and the model decides what it means: stop, change course, answer and continue, or note it. A message to an idle agent starts a turn. The `409` is gone. A hard stop is the runtime's existing stop and delete, which don't depend on the agent's cooperation. Interrupting a model call midway needs cancellation in the model port, and isn't added until a step's wait proves too long.
- **Agents talk only by sending.** An agent's text output is its own: anyone watching its event stream sees it, but nobody is sent it. To tell another agent something, including answering it, the agent sends a message with a tool. One rule holds for every pair, the user included.
- **Everyone is addressed by ID, and the user's ID is `owner`.** A sub-agent sends to its parent's ID, which the runtime gives it, and a root agent's parent is `owner`. A message the root sends to `owner` is read on the root's event stream, where the user already watches it.
- **The runtime stamps every message with its sender.** It knows the sender from the caller's token, so no agent can claim to be another. A message becomes an item of its own in the conversation, carrying its sender, instead of a plain user message.
- **A child can message its parent.** Today a caller reaches only its descendants. An agent may now also send messages to its parent, and only send: it still can't stop, start, delete or inspect it.
- **A message to a stopped agent wakes it.** The runtime starts the agent, then delivers. Sleeping and being stopped are the same thing, so a sleeping parent costs nothing and its child's question wakes it. Its own sub-agents stay stopped until it messages them, so a tree wakes only as far as the work needs. A parent that wants a child to stay stopped doesn't message it. **BREAKING:** a relayed message to a stopped agent no longer gets `409`.
- **The inbox lives in the agent's own store, on its volume.** The runtime keeps no state, so a message that's been accepted is durable once the receiving agent has saved it, and the runtime answers only then.
- **Every step is saved as it happens, and an interrupted turn resumes.** **BREAKING:** each model response, each tool call with its result, and each message is saved and streamed the moment it happens, not with the rest of its turn. An agent that crashes, restarts or is stopped mid-turn finds the unfinished turn in its store and carries on from its last saved step, without repeating finished steps, such as a spawn. This gives up JEN-9's promise that a failed turn leaves nothing: a failed turn keeps the steps it finished, which is an accurate record. Watchers see a turn's progress live, which the UI engine ([JEN-3](https://linear.app/reveer/issue/JEN-3)) needs anyway.
- **An agent gets delegation tools.** It can spawn a sub-agent, send a message, list its sub-agents, and stop, start or delete one, all through the runtime's API with its own token. Each grant it gives can only narrow its own, as the runtime already enforces. The agent learns its own ID, its parent's and its grant from the runtime, and offers only the tools its grant allows, so an agent without `spawn` has no spawn tool. The runtime still enforces the grant either way.

Two agents could message each other forever and spend without limit. The real bound is spend, which waits on the model proxy, and until then depth and count are the only bounds.

## Capabilities

### New Capabilities

- `agent-delegation`: the tools an agent uses to work with other agents through the runtime: spawning, sending, listing, stopping, starting and deleting, what the agent knows of its own ID, its parent's and its grant, and how its tools follow its grant.

### Modified Capabilities

- `agent-protocol`: `POST /messages` accepts a message into the inbox and answers once it's saved. Messages carry their sender, a message during a turn is accepted, and the stream sends each step as it's saved, including the steps of a turn that later fails.
- `agent-loop`: messages arriving mid-turn join the conversation at the next step, a turn runs until the model answers and the inbox is empty, and an unfinished turn resumes from its last saved step. A model failure keeps the steps already done.
- `agent-store`: steps and messages are saved one at a time instead of a turn at once, and a failed turn keeps what it finished.
- `model-port`: a new message item carrying its sender.
- `openai-responses-adapter`: how a message item is sent to the model.
- `agent-container`: an agent stopped mid-turn keeps the steps it finished, and resumes on its next start.
- `agent-runtime`: the owner's ID is `owner`, an agent may message its parent, the runtime stamps each message with its sender and gives each agent its parent's ID and its grant, and a message to a stopped agent starts it.

## Impact

- `src/agent/`: the server's inbox and the end of the `409`, the loop's step-by-step run and resume, the store's per-step saves, a new message item in the model port and the Responses adapter, and the delegation tools, which call the runtime over `node:http` with no new dependency.
- `src/runtime/`: sender stamping, a child's route to its parent, the `owner` ID, waking a stopped agent on a message, and the parent's ID in each agent's environment.
- Every client of `POST /messages` changes, since the reply now arrives on the event stream. That's the live checks and the commands in `context/environment.md`.
- A live check with Docker running: the owner asks a root agent for work that it delegates to a sub-agent, the sub-agent asks the root a question and gets an answer, and the result comes back to the owner on the root's event stream.
