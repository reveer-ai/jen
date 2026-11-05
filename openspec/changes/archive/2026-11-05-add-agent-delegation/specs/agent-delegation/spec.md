# Spec Delta

## Purpose

Defines the tools a jen agent uses to work with other agents through the runtime: spawning, messaging, listing, stopping, starting and deleting sub-agents, what the agent knows of itself and its parent, and how its tools follow its grant.

## ADDED Requirements

### Requirement: The agent knows who it is
The agent SHALL read its own ID from `JEN_AGENT_ID`, its parent's ID from `JEN_PARENT` and its grant, as JSON, from `JEN_GRANT`. If any of them is missing, empty, or in the grant's case not a valid grant, it SHALL exit non-zero at startup with an error naming the variable, and SHALL serve nothing.

#### Scenario: Missing parent
- **WHEN** the agent starts without `JEN_PARENT`
- **THEN** it exits non-zero and its error names `JEN_PARENT`

#### Scenario: Malformed grant
- **WHEN** the agent starts with `JEN_GRANT` set to text that isn't a grant
- **THEN** it exits non-zero and its error names `JEN_GRANT`

### Requirement: Every agent can send a message
The agent SHALL always offer the model a `send_message` tool taking `to`, `text` and an optional boolean `urgent`. A send to another agent SHALL post the message to that agent through the runtime with the agent's own token, and its result SHALL be `delivered` once the runtime confirms the message is in the receiver's inbox.

#### Scenario: A child answers its parent
- **WHEN** a sub-agent's model calls `send_message` with `to` set to its parent's ID and the text "done"
- **THEN** the runtime receives a message for the parent from the sub-agent, and the call's result is `delivered`

#### Scenario: An urgent send
- **WHEN** the model calls `send_message` with `urgent` true
- **THEN** the message is posted with `"urgent": true` in its body

### Requirement: A root agent's send to the owner is delivered by saving its result
A send to `owner` from a root agent SHALL call nothing, and its result SHALL be `delivered`. Saving that result SHALL be the delivery: a send to `owner` whose saved result is anything else SHALL count as not delivered.

#### Scenario: Root reports to the owner
- **WHEN** a root agent's model calls `send_message` with `to` set to `owner`
- **THEN** no request is made to the runtime, the call's result is `delivered`, and the owner reads the call and its result on the root's event stream

### Requirement: Delegation tools follow the grant
The agent SHALL offer `spawn_agent` (taking a grant), `list_agents`, `stop_agent`, `start_agent` and `delete_agent` (each taking an ID) only when its grant has `spawn`. Each SHALL call the matching runtime route with the agent's own token and return the runtime's answer.

#### Scenario: Agent with spawn
- **WHEN** an agent whose grant has `spawn` calls the model
- **THEN** the model is offered `send_message`, `spawn_agent`, `list_agents`, `stop_agent`, `start_agent` and `delete_agent`

#### Scenario: Agent without spawn
- **WHEN** an agent whose grant lacks `spawn` calls the model
- **THEN** the model is offered only `send_message`

#### Scenario: Spawning a sub-agent
- **WHEN** the model calls `spawn_agent` with the grant `{"spawn": false}`
- **THEN** the runtime creates a child of the agent with that grant, and the call's result holds the new agent's ID

### Requirement: A runtime refusal is a tool error
When the runtime refuses a delegation call, the tool SHALL fail with the runtime's status and error message, so the model sees a result starting with `Error:`.

#### Scenario: Unreachable target
- **WHEN** the model calls `send_message` to an agent that isn't its parent or descendant
- **THEN** the call's result starts with `Error:` and holds the status `404`

### Requirement: The agent is told how to work in a tree
The agent SHALL send the model system instructions naming its ID, its parent's ID and its grant, and saying that its text output reaches no one, that messages arrive as user messages naming their sender, that to wait for an answer it ends its turn, that it tells its parent when its work is done, that it sends only what the receiver needs, and that it marks a message urgent only when waiting would cause harm or waste.

#### Scenario: Instructions on every call
- **WHEN** the agent calls the model
- **THEN** the call carries instructions holding the agent's ID and its parent's ID

### Requirement: An agent delegates and converses in both directions
With Docker running and model credentials configured, a live check SHALL have the owner ask a root agent for work that it delegates to a sub-agent, the sub-agent ask the root a question and get an answer, and the result reach the owner on the root's event stream. Without credentials or Docker it SHALL behave as the existing live checks do.

#### Scenario: Delegated work with a question
- **WHEN** the owner messages a root agent with work that needs a sub-agent and a question back
- **THEN** the root spawns a sub-agent, the sub-agent sends the root a question, the root answers it, the sub-agent sends its result, and the root sends the result to `owner`
