# Spec Delta

## ADDED Requirements

### Requirement: An agent messages only its own sub-agents
An agent whose grant has `spawn` SHALL be offered a `message_sub_agent` tool taking `to`, `text` and an optional boolean `urgent`. It SHALL post the message to `to` through the runtime with the agent's own token, and its result SHALL be `delivered. The reply will come to you. Call wait when you have nothing else to do.` once the runtime confirms the message is in the receiver's inbox. Its description SHALL NOT mention the agent's parent.

#### Scenario: A task for a sub-agent
- **WHEN** a root's model calls `message_sub_agent` with `to` set to its sub-agent's ID and the text "write a haiku"
- **THEN** the runtime receives a message for the sub-agent from the root, and the call's result is `delivered. The reply will come to you. Call wait when you have nothing else to do.`

#### Scenario: An urgent send
- **WHEN** the model calls `message_sub_agent` with `urgent` true
- **THEN** the message is posted with `"urgent": true` in its body

### Requirement: A send to anyone but a sub-agent fails
A `message_sub_agent` call whose `to` is the agent's parent's ID SHALL post nothing, since the runtime would deliver it. That call, and a send the runtime answers `404`, SHALL fail with `Error: you have no sub-agent <to>. To answer your parent, end your turn with your reply.` The agent SHALL NOT guess at other names the model might use for its parent: the runtime's `404` covers them.

#### Scenario: A send to the parent
- **WHEN** a sub-agent's model calls `message_sub_agent` with `to` set to its parent's ID
- **THEN** no request is made to the runtime, and the call's result is `Error: you have no sub-agent <parent's ID>. To answer your parent, end your turn with your reply.`

#### Scenario: A send to a made-up name for the parent
- **WHEN** a root's model calls `message_sub_agent` with `to` set to "[user]", and the runtime answers `404`
- **THEN** the call's result is `Error: you have no sub-agent [user]. To answer your parent, end your turn with your reply.`

#### Scenario: A send to an unknown agent
- **WHEN** the model calls `message_sub_agent` to an ID the runtime answers `404` for
- **THEN** the call's result is `Error: you have no sub-agent <id>. To answer your parent, end your turn with your reply.`

### Requirement: The agent records which sub-agents owe it a reply
A sub-agent SHALL owe its parent a reply from the time the parent sends it a message until the parent accepts a message from it. `message_sub_agent` SHALL record the receiver as owing a reply before it posts the message, and SHALL remove that record if the post fails. A `stop_agent` or `delete_agent` call the runtime confirms SHALL remove the record of the sub-agent it names.

#### Scenario: A send records the debt first
- **WHEN** the model calls `message_sub_agent` to sub-agent `a1`, and `a1`'s reply is accepted before the runtime answers the send
- **THEN** once both are done, `a1` doesn't owe a reply

#### Scenario: A failed send owes nothing
- **WHEN** a `message_sub_agent` call to `a1` fails
- **THEN** `a1` doesn't owe a reply

#### Scenario: Deleting a sub-agent clears its debt
- **WHEN** sub-agent `a1` owes a reply and the model deletes it with `delete_agent`
- **THEN** `a1` doesn't owe a reply

#### Scenario: Stopping a sub-agent clears its debt
- **WHEN** sub-agent `a1` owes a reply and the model stops it with `stop_agent`
- **THEN** `a1` doesn't owe a reply

### Requirement: The model sees no agent ID it can't message
The only agent IDs the agent SHALL show its model are its sub-agents'. `spawn_agent` SHALL return the new agent's ID, grant and state, with no parent. `list_agents` SHALL list only the agent's own sub-agents, each with its ID, grant and state, with no parent. The agent's instructions SHALL name neither its own ID nor its parent's.

#### Scenario: Spawn result
- **WHEN** the model calls `spawn_agent` and the runtime answers with the new agent's ID, parent, grant and state
- **THEN** the call's result holds the ID, grant and state, and not the parent

#### Scenario: Only direct sub-agents are listed
- **WHEN** the agent has sub-agent `a1`, which has sub-agent `b1`, and the model calls `list_agents`
- **THEN** the result lists `a1` with its grant and state, and neither `b1` nor any parent field

#### Scenario: Instructions hold no IDs
- **WHEN** the agent calls the model
- **THEN** its instructions hold neither its own ID nor its parent's

### Requirement: Agents behave on the live check's tasks
With Docker running and model credentials configured, a behavior live check SHALL start its own runtime and run six owner tasks three times each, in parallel, each with its own root: one delegation, a direct answer, fan-out to three sub-agents, a task that needs a question answered first, a follow-up, and a nested team. A run SHALL be settled after 30 seconds with no new event on any of its agents' streams. Without credentials or Docker the check SHALL behave as the existing live checks do.

#### Scenario: The question is answered
- **WHEN** a run's task needs a question answered first, and the root sends its first reply
- **THEN** the check sends the root "Maya and Jordan."

#### Scenario: Every run behaves
- **WHEN** the behavior live check runs with Docker and credentials
- **THEN** all 18 runs settle, and each gets its task's expected number of owner replies with none of the faults

### Requirement: The behavior live check fails on any fault
A behavior live check run SHALL fail if it doesn't settle within 6 minutes, if the owner gets a number of replies other than the task's expected number, or on any `list_agents` call, refused or failed tool call, message sent twice to the same receiver with the same text, sub-agent reply of 1 to 9 characters, or model error event. A failure SHALL print the run's transcript.

#### Scenario: A faulty run
- **WHEN** a run's root calls `list_agents`
- **THEN** the check fails and prints that run's transcript

## MODIFIED Requirements

### Requirement: Delegation tools follow the grant
The agent SHALL offer `message_sub_agent`, `spawn_agent` (taking a grant), `list_agents`, `stop_agent`, `start_agent` and `delete_agent` (each taking an ID), and `wait`, only when its grant has `spawn`. An agent without `spawn` SHALL be offered no tools. Each tool other than `message_sub_agent` and `wait` SHALL call the matching runtime route with the agent's own token and return the runtime's answer.

#### Scenario: Agent with spawn
- **WHEN** an agent whose grant has `spawn` calls the model
- **THEN** the model is offered `message_sub_agent`, `spawn_agent`, `list_agents`, `stop_agent`, `start_agent`, `delete_agent` and `wait`

#### Scenario: Agent without spawn
- **WHEN** an agent whose grant lacks `spawn` calls the model
- **THEN** the model is offered no tools

#### Scenario: Spawning a sub-agent
- **WHEN** the model calls `spawn_agent` with the grant `{"spawn": false}`
- **THEN** the runtime creates a child of the agent with that grant, and the call's result holds the new agent's ID

### Requirement: A runtime refusal is a tool error
When the runtime refuses a delegation call, the tool SHALL fail with the runtime's status and error message, so the model sees a result starting with `Error:`, except where a tool's requirement gives the error.

#### Scenario: Unreachable target
- **WHEN** the model calls `stop_agent` with the ID of an agent that isn't its descendant
- **THEN** the call's result starts with `Error:` and holds the status `404`

### Requirement: The agent is told how to work in a tree
The agent SHALL send the model system instructions saying:
- that it is an agent in a tree of agents, and whether its parent is the user or the agent that started it
- its grant, and whether it may start sub-agents
- that the final text of its turn is its reply to its parent and the only way to answer it, so when its parent asks it to send or report something it replies with it, and it ends its turn only with its finished result, complete, or a question only its parent can answer
- that messages from its parent have no sender line, that other messages start with their sender, and that messages from `runtime` report what happened to the tree
- that every message costs its receiver a model call, so it never acknowledges, and never replies to a message that needs no reply

With `spawn`, they SHALL also say:
- that it hands each piece of work to a sub-agent of its own with `message_sub_agent`, lets each sub-agent manage its own, and asks a sub-agent to reply with its result, not to send it
- that it carries on with its own part while sub-agents work, and calls `wait` when it can't go on without an answer
- that it leaves delegated work alone while it waits
- that it asks its parent first when the work needs something only its parent knows
- that when the runtime says a sub-agent stopped, it starts it again, or deletes it and does without it
- that it marks a message urgent only when waiting would cause harm or waste

#### Scenario: Instructions on every call
- **WHEN** the agent calls the model
- **THEN** the call carries the instructions, and they say whether its parent is the user or the agent that started it

#### Scenario: Instructions without spawn
- **WHEN** an agent without `spawn` calls the model
- **THEN** its instructions don't mention `message_sub_agent` or `wait`

### Requirement: An agent delegates and converses in both directions
With Docker running and model credentials configured, a live check SHALL have the owner ask a root agent for work that it delegates to a sub-agent, the sub-agent ask the root a question and get an answer, and the result reach the owner on the root's event stream. A reply SHALL be read as an assistant message from a model response with no tool calls. Without credentials or Docker it SHALL behave as the existing live checks do.

#### Scenario: Delegated work with a question
- **WHEN** the owner messages a root agent with work that needs a sub-agent and a question back
- **THEN** the root spawns a sub-agent, the sub-agent asks the root a question in its reply, the root answers it with `message_sub_agent`, the sub-agent replies with its result, and the root replies to the owner with the result

## REMOVED Requirements

### Requirement: Every agent can send a message
**Reason**: An agent answers its parent by ending its turn, so a send tool that reaches the parent gives it two ways to answer. Sending downward is `message_sub_agent`, offered only with `spawn`.
**Migration**: Call `message_sub_agent` to reach a sub-agent. A reply to the parent is the turn's final text.

### Requirement: A root agent's send to the owner is delivered by saving its result
**Reason**: A root's reply is the final text of its turn, saved on its event stream, where the owner reads it.
**Migration**: Owner clients read a root's replies as assistant messages from model responses with no tool calls.
