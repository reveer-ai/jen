# agent-runtime Specification

## Purpose
Defines the jen runtime: the one process that starts, stops, restarts and deletes every jen agent on its Docker engine, keeps the tree of agents and its guarantees, applies grants and bounds, and relays every request to an agent.

## Requirements

### Requirement: The runtime requires its configuration
The runtime SHALL read the owner's token from `JEN_OWNER_TOKEN` and the model settings it gives agents from `JEN_MODEL`, `JEN_API_KEY` and the optional `JEN_BASE_URL`. If `JEN_OWNER_TOKEN`, `JEN_MODEL` or `JEN_API_KEY` is missing or empty, it SHALL exit non-zero at startup with an error naming the variable, and SHALL start no agents and serve nothing.

#### Scenario: Missing owner token
- **WHEN** the runtime starts without `JEN_OWNER_TOKEN`
- **THEN** it exits non-zero and its error names `JEN_OWNER_TOKEN`

### Requirement: Every request carries a credential
The runtime SHALL serve its API on port 8080, and every request but `GET /agents/:id/page` SHALL carry `Authorization: Bearer <token>`, where the token is either the owner's token or the current token of a running agent. Any other request SHALL get `401` with `WWW-Authenticate: Bearer`, and its body SHALL NOT be read. The caller is the principal the token belongs to: the owner, or that agent.

#### Scenario: No token
- **WHEN** a request other than for an agent's page arrives without a bearer token
- **THEN** it gets `401` and nothing changes

#### Scenario: A stopped agent's token
- **WHEN** an agent is stopped and a request presents the token it had while running
- **THEN** it gets `401`

### Requirement: A token is checked again when the runtime acts
The runtime SHALL check an agent's token again when it acts on the request, after any wait for the request's body or for other operations. A request whose token is no longer current by then SHALL get `401` and change nothing.

#### Scenario: A caller stopped while its request waits
- **WHEN** a running agent starts a spawn request, and is stopped, or stopped and started, before the request's body finishes arriving
- **THEN** the request gets `401` and no agent is created

### Requirement: Spawning starts a child of the caller
`POST /agents` with a body `{"grant": <grant>}` SHALL create an agent whose parent is the caller, start it, and answer `201` with the agent. An agent the owner spawns is a root agent. An agent SHALL be described as `{"id", "parent", "grant", "state"}`, where `parent` is null for a root agent and `state` is `running` or `stopped`. A body that isn't JSON, or whose grant isn't a grant, SHALL get `400`.

#### Scenario: The owner spawns a root agent
- **WHEN** the owner posts `{"grant": {"spawn": true}}` to `/agents`
- **THEN** it gets `201` with a new agent whose `parent` is null and whose `state` is `running`

#### Scenario: An agent spawns a sub-agent
- **WHEN** a running agent that has `spawn` posts `{"grant": {"spawn": false}}` with its own token
- **THEN** it gets `201` with a new agent whose `parent` is that agent's ID

#### Scenario: Passing on the workspace grant
- **WHEN** a running agent that has `spawn` and `workspace` posts `{"grant": {"workspace": true}}`
- **THEN** it gets `201` with a new agent whose grant is `{"spawn": false, "workspace": true}`

### Requirement: A spawn body is bounded
A spawn body larger than 16 KiB SHALL get `413` with `Connection: close`, before any capability check, and the runtime SHALL stop reading it once it passes that size, whether its length is declared or it arrives chunked. A client still sending when the connection closes may see the connection reset instead of the `413`.

#### Scenario: An oversized body
- **WHEN** a caller posts a body larger than 16 KiB to `/agents`, declared or chunked
- **THEN** it gets `413` once the body passes 16 KiB, the rest is never read, and no agent is created

### Requirement: A grant never exceeds its parent's
A new agent's grant SHALL be a subset of its parent's, where the owner has every capability. A caller without `spawn` SHALL NOT spawn at all. A request that breaks either rule SHALL get `403` and create nothing.

#### Scenario: A caller without spawn
- **WHEN** an agent whose grant has `spawn` false posts to `/agents`
- **THEN** it gets `403` and no agent is created

#### Scenario: A caller without workspace
- **WHEN** an agent whose grant has `spawn` and not `workspace` posts `{"grant": {"workspace": true}}`
- **THEN** it gets `403` and no agent is created

### Requirement: The tree is bounded
The runtime SHALL refuse with `403`, creating nothing, a spawn that would put an agent deeper than `JEN_MAX_DEPTH` (default 3, where a root agent is at depth 1) or make the number of agents exceed `JEN_MAX_AGENTS` (default 10). Every agent that hasn't been deleted counts, whether running or stopped.

#### Scenario: Too deep
- **WHEN** an agent at the maximum depth that has `spawn` tries to spawn
- **THEN** it gets `403`

#### Scenario: Stopped agents count
- **WHEN** the runtime holds `JEN_MAX_AGENTS` agents, some of them stopped, and the owner spawns another
- **THEN** it gets `403`

### Requirement: A caller reaches only its descendants
Every route that names an agent SHALL act only on a descendant of the caller, except that `POST /agents/:id/messages` SHALL also reach the caller's parent. The owner is an ancestor of every agent, and no agent is its own descendant. An ID the caller can't reach SHALL get `404`, the same as an ID that doesn't exist.

#### Scenario: A sibling
- **WHEN** an agent names its sibling in any route
- **THEN** it gets `404` and the sibling is unaffected

#### Scenario: Itself
- **WHEN** an agent tries to stop itself
- **THEN** it gets `404`

### Requirement: Listing shows the caller's descendants
`GET /agents` SHALL answer `200` with every descendant of the caller, so the owner sees every agent. `GET /agents/:id` SHALL answer `200` with one descendant.

#### Scenario: An agent lists its subtree
- **WHEN** an agent with a child and a grandchild lists `/agents`
- **THEN** it gets exactly those two agents, and not itself, its parent or its siblings

### Requirement: Stopping stops everything under an agent
`POST /agents/:id/stop` SHALL stop the agent and every one of its descendants, keeping each one's state, and answer `200` with the agent. Stopping an agent that is already stopped SHALL succeed.

#### Scenario: Stopping a parent
- **WHEN** the owner stops a root agent that has a running child
- **THEN** both are stopped, both still appear in the owner's list, and neither's conversation is lost

### Requirement: Starting resumes an agent from its state
`POST /agents/:id/start` SHALL start a stopped agent with its stored conversation, the runtime's current model settings and the current agent image, and answer `200` with the agent. Starting a running agent SHALL change nothing and succeed. Starting SHALL NOT change the state of the agent's descendants, and SHALL work whatever the state of its parent.

#### Scenario: Resumed with its memory
- **WHEN** an agent is told a word, stopped, started, and asked for the word through the relay
- **THEN** its reply on its event stream holds the word

#### Scenario: Starting after a crash the engine gave up on
- **WHEN** an agent's process keeps exiting until its restarts run out, and the owner then starts it
- **THEN** it starts and is `running`

### Requirement: An agent is reachable when spawn or start answers
Spawning and starting SHALL answer only once the agent accepts connections. If it doesn't accept connections within 30 seconds, the call SHALL fail: a spawn removes what it created, as any failed spawn does, and a start removes the container and leaves the agent stopped with its state.

#### Scenario: Relayed to straight after spawning
- **WHEN** the owner spawns an agent and, as soon as it gets `201`, posts a message to it
- **THEN** the message reaches the agent

#### Scenario: An agent that never comes up
- **WHEN** a stopped agent is started and never accepts connections
- **THEN** the start fails after 30 seconds, and the agent is stopped with its state

### Requirement: Deleting removes everything under an agent
`DELETE /agents/:id` SHALL stop and permanently remove the agent and every one of its descendants, including their stored conversations and their workspaces' files, and answer `204`. Repeating a delete that was interrupted SHALL finish it.

#### Scenario: Deleting a parent
- **WHEN** the owner deletes a root agent that has a child
- **THEN** neither appears in any list, neither's state remains, and they no longer count toward `JEN_MAX_AGENTS`

#### Scenario: Deleting an agent with a workspace
- **WHEN** the owner deletes an agent that has a workspace
- **THEN** no workspace container or volume of that agent remains

### Requirement: A crash restarts only the agent that crashed
When an agent's process exits unexpectedly, the runtime's engine SHALL restart it, up to 3 times, keeping its state and its place in the tree. It SHALL be reported as `running` while it restarts. Its descendants SHALL keep running. If its restarts run out, it SHALL be reported as `stopped`, and its descendants SHALL still keep running.

#### Scenario: A parent crashes
- **WHEN** an agent with a running child exits unexpectedly
- **THEN** the agent comes back on its own with its conversation, and the child keeps running throughout

### Requirement: Requests to an agent are relayed
`POST /agents/:id/messages`, `GET /agents/:id/events` and `GET /agents/:id/ui` SHALL be relayed to that agent's `agent-protocol` `/messages`, `/events` and `/ui`, passing the body and `Last-Event-ID` through and streaming the agent's response back unchanged. The caller SHALL NOT need, or ever receive, the agent's token. If the agent's response breaks off, the caller's response SHALL end too. `GET /agents/:id/ui` SHALL be refused with `403` unless the agent is a root whose grant has `workspace`.

#### Scenario: The owner talks to a root agent
- **WHEN** the owner posts a message to `/agents/:id/messages` for a running root agent
- **THEN** it gets `202` once the message is saved, and `/agents/:id/events` streams the conversation, including the agent's reply

#### Scenario: A stopped agent
- **WHEN** the owner posts a message to a stopped agent
- **THEN** the agent is started and the message relayed to it

#### Scenario: An agent stops while its events stream
- **WHEN** a caller is reading `/agents/:id/events` and the agent stops or crashes
- **THEN** the caller's stream ends, so it can reconnect

#### Scenario: A sub-agent's UI
- **WHEN** the owner requests `/agents/:id/ui` for a sub-agent
- **THEN** it gets `403`

#### Scenario: The UI of a root without workspace
- **WHEN** the owner requests `/agents/:id/ui` for a root whose grant has no `workspace`
- **THEN** it gets `403`

### Requirement: A relay ends with its caller
When the caller hangs up, the runtime SHALL end the relayed request. If the caller hangs up before the relay reaches the agent, the runtime SHALL open no connection to the agent.

#### Scenario: A caller hangs up before the relay reaches the agent
- **WHEN** a caller requests `/agents/:id/events` and disconnects while the runtime is still looking up the agent
- **THEN** no connection to the agent is opened

### Requirement: The runtime has an image of its own
The runtime SHALL be packaged as an OCI image of its own, separate from the agent image and the workspace image. Run with no command, the engine's socket and the runtime's environment, that image SHALL start the runtime and serve its API on port 8080. It SHALL run as root, so the runtime can use the engine's socket, and SHALL declare no volume. Each image SHALL hold only its own side's code: the agent image SHALL contain none of the runtime, the runtime image none of the agent, and the workspace image none of jen's code.

#### Scenario: The runtime image starts the runtime
- **WHEN** the runtime image is run with no command, the engine's socket and the runtime's environment
- **THEN** it serves the runtime's API on port 8080 from a container with no volume

#### Scenario: The agent image holds no runtime
- **WHEN** the agent image is built
- **THEN** it contains no file from `src/runtime/`

### Requirement: The runtime alone decides how an agent runs
The runtime SHALL start every agent from the agent image named by `JEN_AGENT_IMAGE` (default `jen-agent`), with the same fixed settings: its own state volume, the runtime's network, the runtime's model settings, the agent's token and the runtime's address. It SHALL start every workspace from the image named by `JEN_WORKSPACE_IMAGE` (default `jen-workspace`) with the workspace's fixed settings. Nothing a caller sends, other than the validated grant and a command's text and timeout, SHALL reach any container's configuration. No agent's port SHALL be published.

#### Scenario: Extra fields are ignored
- **WHEN** a spawn request carries fields besides `grant`
- **THEN** the agent is started with the same settings as without them

#### Scenario: Extra fields on a command
- **WHEN** a command request carries fields besides `command` and `timeout`
- **THEN** the command runs as it would without them

### Requirement: An agent's token is renewed each time it starts
Each time an agent starts, the runtime SHALL give it a new random token as `JEN_TOKEN`, along with the runtime's address as `JEN_RUNTIME_URL`. The token SHALL identify that agent to the runtime, and the runtime SHALL use it to relay to the agent. The token from an earlier run SHALL no longer be accepted.

#### Scenario: Old token after a restart through the API
- **WHEN** an agent is stopped and started, and a request presents its token from before the stop
- **THEN** it gets `401`

### Requirement: A failed spawn leaves nothing running
If spawning fails at any step, the runtime SHALL remove whatever the attempt created, including its workspace container and volume, and a container whose creation or start was reported as failed. If that cleanup also fails, the agent SHALL remain as a stopped or running agent in the caller's list, and the error response SHALL include its ID.

#### Scenario: The container fails to start
- **WHEN** a spawn's container is created but fails to start
- **THEN** the caller gets an error, and no container, state or list entry for that agent remains

#### Scenario: The workspace fails to start
- **WHEN** a spawn with `workspace` fails to start the workspace container
- **THEN** the caller gets an error, and no container, volume or list entry for that agent remains

### Requirement: The tree survives a runtime restart
The runtime SHALL keep no state of its own. On startup, before serving, it SHALL recover the tree from its engine, keep every running agent and its workspace running, remove anything a crash left half done, and delete any agent whose parent no longer exists, along with that agent's descendants. It SHALL remove every workspace container whose agent isn't running, and every workspace volume whose agent no longer exists.

#### Scenario: Runtime replaced
- **WHEN** the runtime's container is removed while agents run, and a new runtime starts with the same name
- **THEN** the new runtime lists the same agents with the same parents, grants and states, and relays to them

#### Scenario: Detached agent
- **WHEN** the runtime starts and finds an agent whose parent was deleted
- **THEN** that agent and its descendants are deleted before the runtime serves

#### Scenario: A workspace left behind
- **WHEN** the runtime starts and finds a workspace container whose agent is stopped, and a workspace volume whose agent is gone
- **THEN** both are removed before the runtime serves

### Requirement: One runtime per name
Agents belong to the runtime named by `JEN_RUNTIME_NAME` (default `jen`), and a runtime SHALL see and act on only its own agents. At most one runtime with a given name SHALL run on an engine. A runtime that finds another running runtime with its name SHALL exit non-zero at startup with an error, having changed nothing. A runtime that finds a dead one SHALL take its place.

#### Scenario: A second runtime
- **WHEN** a runtime is running and another starts on the same engine with the same name
- **THEN** the second exits non-zero, and the first keeps serving its agents

#### Scenario: Two names
- **WHEN** two runtimes with different names run on one engine
- **THEN** neither lists, relays to or changes the other's agents

### Requirement: Unknown routes are not found
A request with a valid credential to a route the runtime doesn't serve SHALL get `404`.

#### Scenario: Unknown route
- **WHEN** the owner sends `GET /nothing`
- **THEN** it gets `404`

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

### Requirement: An exit is checked when its turn in the queue comes
The runtime SHALL check an exit in the tree-operation queue, against the tree as it is then, and SHALL report nothing for a container that no longer exists, is no longer exited, or is no longer the agent's current container.

#### Scenario: A stop queued ahead of the exit
- **WHEN** the owner's stop of a parent is queued before its child's exhausted exit is handled
- **THEN** the stop succeeds, nothing is sent, and the parent stays stopped

#### Scenario: A start queued ahead of the exit
- **WHEN** a start of the child is queued before its exhausted exit is handled
- **THEN** the child runs in a new container and nothing is sent

### Requirement: The runtime tells a started agent its sub-agents are stopped
When the runtime starts an agent that has stopped children, for a message or an explicit start, it SHALL send the agent, from `runtime`, `You were stopped and have been started again. Your sub-agents <ids> are still stopped. Messaging one starts it.` That start SHALL always hold the agent's loop until the notice arrives.

#### Scenario: Explicit start with stopped children
- **WHEN** the owner stops a root agent with a child and then starts the root
- **THEN** the root is started with `JEN_WAKE`, receives the notice naming its child as its only message, and the child stays stopped

### Requirement: A message from the runtime has a deadline
The runtime SHALL give up on a message it sends to an agent if the agent hasn't answered within 10 seconds, and treat it as a message that couldn't be sent, so no tree operation waits on an agent that never answers.

#### Scenario: An agent takes a notice and never answers
- **WHEN** an agent accepts a notice's request and never responds, during an explicit start
- **THEN** the start still returns, and the next tree operation runs

### Requirement: Each agent is told who it is
Each time an agent starts, the runtime SHALL give it `JEN_AGENT_ID` (its ID), `JEN_PARENT` (its parent's ID, or `owner` for a root agent) and `JEN_GRANT` (its grant as JSON, with both keys).

#### Scenario: A sub-agent's identity
- **WHEN** a root agent spawns a child with `{"spawn": false}`
- **THEN** the child's container has `JEN_AGENT_ID` set to the child's ID, `JEN_PARENT` to the root's ID, and `JEN_GRANT` to `{"spawn":false,"workspace":false}`

### Requirement: A grant is an object of known capabilities
A grant SHALL be a JSON object whose keys are known capabilities, `spawn` and `workspace`, each with a boolean value. A key that's missing SHALL mean `false`, so `{"spawn": true}` grants `spawn` alone. A grant with any other key, or a value that isn't a boolean, SHALL get `400`. The runtime SHALL always describe an agent's grant with both keys.

#### Scenario: A missing key
- **WHEN** the owner posts `{"grant": {"spawn": true}}` to `/agents`
- **THEN** it gets `201` with an agent whose grant is `{"spawn": true, "workspace": false}`

#### Scenario: An unknown key
- **WHEN** the owner posts `{"grant": {"spawn": true, "network": true}}` to `/agents`
- **THEN** it gets `400` and no agent is created

#### Scenario: An agent saved before workspaces
- **WHEN** the runtime recovers an agent whose stored grant has no `workspace`
- **THEN** the agent's grant reads `{"spawn": <as stored>, "workspace": false}`, and it has no workspace

### Requirement: A workspace's exit is never an agent's
A workspace container exiting, restarting or being removed SHALL NOT be reported to any agent's parent, and SHALL NOT change any agent's state.

#### Scenario: A workspace container dies
- **WHEN** a sub-agent's workspace container exits
- **THEN** the sub-agent's parent receives nothing from `runtime`, and the sub-agent is still `running`

### Requirement: A root agent's page is relayed without a credential
`GET /agents/:id/page` SHALL be relayed to the agent's `/page` without a credential, only when the agent is a running root whose grant has `workspace`. For any other ID, whether a stopped agent, a sub-agent, a root without `workspace` or one that doesn't exist, it SHALL answer one `404`, `no UI for agent <id>`, and start nothing.

#### Scenario: The owner opens a root's page
- **WHEN** a browser requests `/agents/:id/page` for a running root agent with `workspace` and no `Authorization` header
- **THEN** it gets the agent's page

#### Scenario: A sub-agent's page
- **WHEN** a request without a credential asks for a running sub-agent's page
- **THEN** it gets the same `404` as for an ID that doesn't exist

#### Scenario: The page of a root without workspace
- **WHEN** a request without a credential asks for the page of a running root whose grant has no `workspace`
- **THEN** it gets the same `404` as for an ID that doesn't exist
