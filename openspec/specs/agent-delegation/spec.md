# agent-delegation Specification

## Purpose
Defines the tools a jen agent uses to work with other agents through the runtime: spawning, messaging, listing, stopping, starting and deleting sub-agents, what the agent knows of itself and its parent, and how its tools follow its grant.

## Requirements

### Requirement: The agent knows who it is
The agent SHALL read its own ID from `JEN_AGENT_ID`, its parent's ID from `JEN_PARENT` and its grant, as JSON, from `JEN_GRANT`. If any of them is missing, empty, or in the grant's case not a valid grant, it SHALL exit non-zero at startup with an error naming the variable, and SHALL serve nothing.

#### Scenario: Missing parent
- **WHEN** the agent starts without `JEN_PARENT`
- **THEN** it exits non-zero and its error names `JEN_PARENT`

#### Scenario: Malformed grant
- **WHEN** the agent starts with `JEN_GRANT` set to text that isn't a grant
- **THEN** it exits non-zero and its error names `JEN_GRANT`

### Requirement: Delegation tools follow the grant
The agent SHALL offer `message_sub_agent`, `spawn_agent` (taking a grant), `list_agents`, `stop_agent`, `start_agent` and `delete_agent` (each taking an ID), and `wait`, only when its grant has `spawn`. It SHALL offer `run_command`, `read_file`, `write_file` and `edit_file`, the workspace tools, only when its grant has `workspace`, and `publish_ui` as `agent-ui` gives it. An agent with neither SHALL be offered no tools. Each tool other than `message_sub_agent` and `wait` SHALL call the matching runtime route with the agent's own token and return the runtime's answer.

#### Scenario: Agent with spawn
- **WHEN** an agent whose grant has `spawn` and not `workspace` calls the model
- **THEN** the model is offered `message_sub_agent`, `spawn_agent`, `list_agents`, `stop_agent`, `start_agent`, `delete_agent` and `wait`

#### Scenario: Agent with workspace only
- **WHEN** an agent whose grant has `workspace` and not `spawn` calls the model
- **THEN** the model is offered the workspace tools, and `publish_ui` if it's a root, and no other tool

#### Scenario: Agent with both
- **WHEN** an agent whose grant has `spawn` and `workspace` calls the model
- **THEN** the model is offered the delegation tools and the workspace tools, and `publish_ui` if it's a root

#### Scenario: Agent without spawn
- **WHEN** an agent whose grant has neither `spawn` nor `workspace` calls the model
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
- that it's in a tree of agents, who its parent is, and its grant
- that its turn's final text is its only reply to its parent, even when asked to send something, and is a finished result or a question only the parent can answer
- that its parent's messages have no sender line, and `runtime` reports on the tree
- that every message costs a model call, so it never acknowledges

#### Scenario: Instructions on every call
- **WHEN** the agent calls the model
- **THEN** the call carries the instructions, and they say whether its parent is the user or the agent that started it

### Requirement: An agent with spawn is told how to delegate
The instructions of an agent whose grant has `spawn` SHALL also say:
- to hand work to its own sub-agents with `message_sub_agent` and ask for results as replies
- to call `wait` when it can't go on, and leave delegated work alone meanwhile
- to ask its parent first for anything only the parent knows
- to restart a sub-agent the runtime says stopped, or delete it and do without it
- to mark a message urgent only when waiting would cause harm or waste

#### Scenario: Instructions without spawn
- **WHEN** an agent without `spawn` calls the model
- **THEN** its instructions don't mention `message_sub_agent` or `wait`

### Requirement: An agent delegates and converses in both directions
With Docker running and model credentials configured, a live check SHALL have the owner ask a root agent for work that it delegates to a sub-agent, the sub-agent ask the root a question and get an answer, and the result reach the owner on the root's event stream. A reply SHALL be read as the text of a model response with no tool call anywhere in it, once the stream has been quiet for a moment. Without credentials or Docker it SHALL behave as the existing live checks do.

#### Scenario: Delegated work with a question
- **WHEN** the owner messages a root agent with work that needs a sub-agent and a question back
- **THEN** the root spawns a sub-agent, the sub-agent asks the root a question in its reply, the root answers it with `message_sub_agent`, the sub-agent replies with its result, and the root replies to the owner with the result

### Requirement: An agent messages only its own sub-agents
An agent whose grant has `spawn` SHALL be offered a `message_sub_agent` tool taking `to`, `text` and an optional boolean `urgent`. It SHALL post the message to `to` through the runtime with the agent's own token, and its result SHALL be `delivered. The reply will come to you. Call wait when you have nothing else to do.` once the runtime confirms the message is in the receiver's inbox. Its description SHALL NOT mention the agent's parent.

#### Scenario: A task for a sub-agent
- **WHEN** a root's model calls `message_sub_agent` with `to` set to its sub-agent's ID and the text "write a haiku"
- **THEN** the runtime receives a message for the sub-agent from the root, and the call's result is `delivered. The reply will come to you. Call wait when you have nothing else to do.`

#### Scenario: An urgent send
- **WHEN** the model calls `message_sub_agent` with `urgent` true
- **THEN** the message is posted with `"urgent": true` in its body

### Requirement: A send to anyone but a direct sub-agent fails
Before it records a debt or posts, `message_sub_agent` SHALL look `to` up through the runtime and go on only if `to`'s parent is this agent. A send that fails the check SHALL post nothing and record no debt. It, and a post the runtime answers `404`, SHALL fail with `Error: you have no sub-agent <to>. To answer your parent, end your turn with your reply.`

#### Scenario: A send to the parent
- **WHEN** a sub-agent's model calls `message_sub_agent` with `to` set to its parent's ID
- **THEN** nothing is posted, and the call's result is `Error: you have no sub-agent <parent's ID>. To answer your parent, end your turn with your reply.`

#### Scenario: A send to a grandchild
- **WHEN** a root's model calls `message_sub_agent` with `to` set to the ID of its sub-agent's sub-agent
- **THEN** nothing is posted, the grandchild doesn't owe a reply, and the call's result is the no-sub-agent error

#### Scenario: A send to a made-up name for the parent
- **WHEN** a root's model calls `message_sub_agent` with `to` set to "[user]"
- **THEN** nothing is posted, and the call's result is `Error: you have no sub-agent [user]. To answer your parent, end your turn with your reply.`

#### Scenario: A sub-agent deleted before the post
- **WHEN** the lookup finds the sub-agent, and the runtime answers the post `404`
- **THEN** the sub-agent doesn't owe a reply, and the call's result is the no-sub-agent error

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
The only agent IDs the agent SHALL show its model are its sub-agents'. `spawn_agent` SHALL return the new agent's ID, grant and state, with no parent, and so SHALL `stop_agent` and `start_agent` for the agent they name. `list_agents` SHALL list only the agent's own sub-agents, each with its ID, grant and state, with no parent. The agent's instructions SHALL name neither its own ID nor its parent's.

#### Scenario: Spawn result
- **WHEN** the model calls `spawn_agent` and the runtime answers with the new agent's ID, parent, grant and state
- **THEN** the call's result holds the ID, grant and state, and not the parent

#### Scenario: Stop and start results
- **WHEN** the model calls `stop_agent` or `start_agent` and the runtime answers with the agent's ID, parent, grant and state
- **THEN** the call's result holds the ID, grant and state, and not the parent

#### Scenario: Only direct sub-agents are listed
- **WHEN** the agent has sub-agent `a1`, which has sub-agent `b1`, and the model calls `list_agents`
- **THEN** the result lists `a1` with its grant and state, and neither `b1` nor any parent field

#### Scenario: Instructions hold no IDs
- **WHEN** the agent calls the model
- **THEN** its instructions hold neither its own ID nor its parent's
