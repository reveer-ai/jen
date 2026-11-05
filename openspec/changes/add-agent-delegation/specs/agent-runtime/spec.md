# Spec Delta

## ADDED Requirements

### Requirement: The owner and the runtime have reserved IDs
The owner's ID SHALL be `owner` and the runtime's `runtime`. No agent SHALL be given either ID. Every route that names `owner` or `runtime` as an agent SHALL get `404`, so no caller can message, inspect or act on either through the API.

#### Scenario: Messaging the runtime
- **WHEN** an agent posts to `/agents/runtime/messages`
- **THEN** it gets `404`

#### Scenario: Messaging the owner through the API
- **WHEN** a root agent posts to `/agents/owner/messages`
- **THEN** it gets `404`

### Requirement: Every relayed message carries its true sender
The runtime SHALL add `Jen-From: <caller>` to every relayed `POST /agents/:id/messages`, where the caller is the agent the token belongs to or `owner`. A `Jen-From` header sent by the caller SHALL NOT reach the agent. The message body SHALL pass through unchanged.

#### Scenario: A forged sender
- **WHEN** an agent posts a message to its child with the header `Jen-From: owner`
- **THEN** the child receives the message from the agent's own ID

#### Scenario: Urgent passes through
- **WHEN** the owner posts `{"text": "stop", "urgent": true}` to a running root agent
- **THEN** the agent receives the body unchanged, from `owner`

### Requirement: An agent can message its parent
`POST /agents/:id/messages` SHALL be open to the caller's parent as well as its descendants. Every other route SHALL still reach only the caller's descendants.

#### Scenario: A child asks its parent
- **WHEN** a sub-agent posts a message to `/agents/<parent>/messages` with its own token
- **THEN** the parent receives it from the sub-agent's ID

#### Scenario: A child can't stop its parent
- **WHEN** a sub-agent posts to `/agents/<parent>/stop`
- **THEN** it gets `404` and the parent keeps running

#### Scenario: A grandchild can't message its grandparent
- **WHEN** an agent posts a message to its parent's parent
- **THEN** it gets `404`

### Requirement: A message to a stopped agent starts it
When the target of `POST /agents/:id/messages` is stopped, the runtime SHALL start it, in the same order as every other tree operation, and then relay the message. If the start fails, the request SHALL fail as a failed start does. Its sub-agents SHALL stay stopped. `GET /agents/:id/events` on a stopped agent SHALL still get `409`.

#### Scenario: A child's question wakes its parent
- **WHEN** a parent is stopped and its running child sends it a message
- **THEN** the parent is started, the message is in its inbox, and the child gets `202`

#### Scenario: Watching doesn't wake
- **WHEN** the owner opens `/agents/:id/events` on a stopped agent
- **THEN** it gets `409` and the agent stays stopped

### Requirement: A start with messages holds the agent until they arrive
When the runtime starts an agent to deliver messages, it SHALL give the container a new random `JEN_WAKE`, and relay the waking message first and any notice after it. A start with nothing to deliver SHALL set no `JEN_WAKE`.

#### Scenario: Woken by a message
- **WHEN** a stopped agent with stopped children is sent a message
- **THEN** it is started with `JEN_WAKE`, and receives the message first and then the runtime's notice

#### Scenario: Plain start
- **WHEN** the owner starts a stopped agent that has no stopped children
- **THEN** it is started without `JEN_WAKE`

### Requirement: The runtime tells a parent its child's restarts ran out
When an agent's container exits and won't be restarted, the runtime SHALL send its parent, from `runtime`, `Your sub-agent <id> stopped: its process kept exiting and its restarts ran out. Message it to start it again.`, starting the parent first if it's stopped. A root agent's exhausted restarts SHALL send nothing.

#### Scenario: A child keeps crashing
- **WHEN** a sub-agent's process keeps exiting until its restarts run out
- **THEN** its parent receives that notice from `runtime`

#### Scenario: A root keeps crashing
- **WHEN** a root agent's restarts run out
- **THEN** no message is sent, and the owner sees it as `stopped`

### Requirement: The runtime tells a started agent its sub-agents are stopped
When the runtime starts an agent that has stopped children, for a message or an explicit start, it SHALL send the agent, from `runtime`, `You were stopped and have been started again. Your sub-agents <ids> are still stopped. Messaging one starts it.` That start SHALL always hold the agent's loop until the notice arrives.

#### Scenario: Explicit start with stopped children
- **WHEN** the owner stops a root agent with a child and then starts the root
- **THEN** the root is started with `JEN_WAKE`, receives the notice naming its child as its only message, and the child stays stopped

### Requirement: Each agent is told who it is
Each time an agent starts, the runtime SHALL give it `JEN_AGENT_ID` (its ID), `JEN_PARENT` (its parent's ID, or `owner` for a root agent) and `JEN_GRANT` (its grant as JSON).

#### Scenario: A sub-agent's identity
- **WHEN** a root agent spawns a child with `{"spawn": false}`
- **THEN** the child's container has `JEN_AGENT_ID` set to the child's ID, `JEN_PARENT` to the root's ID, and `JEN_GRANT` to `{"spawn":false}`

## MODIFIED Requirements

### Requirement: A caller reaches only its descendants
Every route that names an agent SHALL act only on a descendant of the caller, except that `POST /agents/:id/messages` SHALL also reach the caller's parent. The owner is an ancestor of every agent, and no agent is its own descendant. An ID the caller can't reach SHALL get `404`, the same as an ID that doesn't exist.

#### Scenario: A sibling
- **WHEN** an agent names its sibling in any route
- **THEN** it gets `404` and the sibling is unaffected

#### Scenario: Itself
- **WHEN** an agent tries to stop itself
- **THEN** it gets `404`

### Requirement: Starting resumes an agent from its state
`POST /agents/:id/start` SHALL start a stopped agent with its stored conversation, the runtime's current model settings and the current agent image, and answer `200` with the agent. Starting a running agent SHALL change nothing and succeed. Starting SHALL NOT change the state of the agent's descendants, and SHALL work whatever the state of its parent.

#### Scenario: Resumed with its memory
- **WHEN** an agent is told a word, stopped, started, and asked for the word through the relay
- **THEN** its reply on its event stream holds the word

#### Scenario: Starting after a crash the engine gave up on
- **WHEN** an agent's process keeps exiting until its restarts run out, and the owner then starts it
- **THEN** it starts and is `running`

### Requirement: Requests to an agent are relayed
`POST /agents/:id/messages` and `GET /agents/:id/events` SHALL be relayed to that agent's `agent-protocol` `/messages` and `/events`, passing the body and `Last-Event-ID` through and streaming the agent's response back unchanged. The caller SHALL NOT need, or ever receive, the agent's token. If the agent's response breaks off, the caller's response SHALL end too.

#### Scenario: The owner talks to a root agent
- **WHEN** the owner posts a message to `/agents/:id/messages` for a running root agent
- **THEN** it gets `202` once the message is saved, and `/agents/:id/events` streams the conversation, including the agent's reply

#### Scenario: A stopped agent
- **WHEN** the owner posts a message to a stopped agent
- **THEN** the agent is started and the message relayed to it

#### Scenario: An agent stops while its events stream
- **WHEN** a caller is reading `/agents/:id/events` and the agent stops or crashes
- **THEN** the caller's stream ends, so it can reconnect
