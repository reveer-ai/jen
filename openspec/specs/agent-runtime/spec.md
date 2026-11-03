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
The runtime SHALL serve its API on port 8080, and every request SHALL carry `Authorization: Bearer <token>`, where the token is either the owner's token or the current token of a running agent. Any other request SHALL get `401` with `WWW-Authenticate: Bearer`, and its body SHALL NOT be read. The caller is the principal the token belongs to: the owner, or that agent.

#### Scenario: No token
- **WHEN** a request arrives without a bearer token
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
`POST /agents` with a body `{"grant": {"spawn": <boolean>}}` SHALL create an agent whose parent is the caller, start it, and answer `201` with the agent. An agent the owner spawns is a root agent. An agent SHALL be described as `{"id", "parent", "grant", "state"}`, where `parent` is null for a root agent and `state` is `running` or `stopped`. A body that isn't JSON, or whose grant isn't of that shape, SHALL get `400`.

#### Scenario: The owner spawns a root agent
- **WHEN** the owner posts `{"grant": {"spawn": true}}` to `/agents`
- **THEN** it gets `201` with a new agent whose `parent` is null and whose `state` is `running`

#### Scenario: An agent spawns a sub-agent
- **WHEN** a running agent that has `spawn` posts `{"grant": {"spawn": false}}` with its own token
- **THEN** it gets `201` with a new agent whose `parent` is that agent's ID

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

### Requirement: The tree is bounded
The runtime SHALL refuse with `403`, creating nothing, a spawn that would put an agent deeper than `JEN_MAX_DEPTH` (default 3, where a root agent is at depth 1) or make the number of agents exceed `JEN_MAX_AGENTS` (default 10). Every agent that hasn't been deleted counts, whether running or stopped.

#### Scenario: Too deep
- **WHEN** an agent at the maximum depth that has `spawn` tries to spawn
- **THEN** it gets `403`

#### Scenario: Stopped agents count
- **WHEN** the runtime holds `JEN_MAX_AGENTS` agents, some of them stopped, and the owner spawns another
- **THEN** it gets `403`

### Requirement: A caller reaches only its descendants
Every route that names an agent SHALL act only on a descendant of the caller. The owner is an ancestor of every agent, and no agent is its own descendant. An ID that isn't the caller's descendant SHALL get `404`, the same as an ID that doesn't exist.

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
- **THEN** it replies with the word

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
`DELETE /agents/:id` SHALL stop and permanently remove the agent and every one of its descendants, including their stored conversations, and answer `204`. Repeating a delete that was interrupted SHALL finish it.

#### Scenario: Deleting a parent
- **WHEN** the owner deletes a root agent that has a child
- **THEN** neither appears in any list, neither's state remains, and they no longer count toward `JEN_MAX_AGENTS`

### Requirement: A crash restarts only the agent that crashed
When an agent's process exits unexpectedly, the runtime's engine SHALL restart it, up to 3 times, keeping its state and its place in the tree. It SHALL be reported as `running` while it restarts. Its descendants SHALL keep running. If its restarts run out, it SHALL be reported as `stopped`, and its descendants SHALL still keep running.

#### Scenario: A parent crashes
- **WHEN** an agent with a running child exits unexpectedly
- **THEN** the agent comes back on its own with its conversation, and the child keeps running throughout

### Requirement: Requests to an agent are relayed
`POST /agents/:id/messages` and `GET /agents/:id/events` SHALL be relayed to that agent's `agent-protocol` `/messages` and `/events`, passing the body and `Last-Event-ID` through and streaming the agent's response back unchanged. The caller SHALL NOT need, or ever receive, the agent's token. A relay to a stopped agent SHALL get `409`. If the agent's response breaks off, the caller's response SHALL end too.

#### Scenario: The owner talks to a root agent
- **WHEN** the owner posts a message to `/agents/:id/messages` for a running root agent
- **THEN** it gets the agent's reply, and `/agents/:id/events` streams the conversation

#### Scenario: A stopped agent
- **WHEN** the owner posts a message to a stopped agent
- **THEN** it gets `409`

#### Scenario: An agent stops while its events stream
- **WHEN** a caller is reading `/agents/:id/events` and the agent stops or crashes
- **THEN** the caller's stream ends, so it can reconnect

### Requirement: A relay ends with its caller
When the caller hangs up, the runtime SHALL end the relayed request. If the caller hangs up before the relay reaches the agent, the runtime SHALL open no connection to the agent.

#### Scenario: A caller hangs up before the relay reaches the agent
- **WHEN** a caller requests `/agents/:id/events` and disconnects while the runtime is still looking up the agent
- **THEN** no connection to the agent is opened

### Requirement: The runtime has an image of its own
The runtime SHALL be packaged as an OCI image of its own, separate from the agent image. Run with no command, the engine's socket and the runtime's environment, that image SHALL start the runtime and serve its API on port 8080. It SHALL run as root, so the runtime can use the engine's socket, and SHALL declare no volume. Each image SHALL hold only its own side's code: the agent image SHALL contain none of the runtime, and the runtime image none of the agent.

#### Scenario: The runtime image starts the runtime
- **WHEN** the runtime image is run with no command, the engine's socket and the runtime's environment
- **THEN** it serves the runtime's API on port 8080 from a container with no volume

#### Scenario: The agent image holds no runtime
- **WHEN** the agent image is built
- **THEN** it contains no file from `src/runtime/`

### Requirement: The runtime alone decides how an agent runs
The runtime SHALL start every agent from the agent image named by `JEN_AGENT_IMAGE` (default `jen-agent`), with the same fixed settings: its own state volume, the runtime's network, the runtime's model settings, the agent's token and the runtime's address. Nothing a caller sends, other than the validated grant, SHALL reach the agent's container configuration. No agent's port SHALL be published.

#### Scenario: Extra fields are ignored
- **WHEN** a spawn request carries fields besides `grant`
- **THEN** the agent is started with the same settings as without them

### Requirement: An agent's token is renewed each time it starts
Each time an agent starts, the runtime SHALL give it a new random token as `JEN_TOKEN`, along with the runtime's address as `JEN_RUNTIME_URL`. The token SHALL identify that agent to the runtime, and the runtime SHALL use it to relay to the agent. The token from an earlier run SHALL no longer be accepted.

#### Scenario: Old token after a restart through the API
- **WHEN** an agent is stopped and started, and a request presents its token from before the stop
- **THEN** it gets `401`

### Requirement: A failed spawn leaves nothing running
If spawning fails at any step, the runtime SHALL remove whatever the attempt created, including a container whose creation or start was reported as failed. If that cleanup also fails, the agent SHALL remain as a stopped or running agent in the caller's list, and the error response SHALL include its ID.

#### Scenario: The container fails to start
- **WHEN** a spawn's container is created but fails to start
- **THEN** the caller gets an error, and no container, state or list entry for that agent remains

### Requirement: The tree survives a runtime restart
The runtime SHALL keep no state of its own. On startup, before serving, it SHALL recover the tree from its engine, keep every running agent running, remove anything a crash left half done, and delete any agent whose parent no longer exists, along with that agent's descendants.

#### Scenario: Runtime replaced
- **WHEN** the runtime's container is removed while agents run, and a new runtime starts with the same name
- **THEN** the new runtime lists the same agents with the same parents, grants and states, and relays to them

#### Scenario: Detached agent
- **WHEN** the runtime starts and finds an agent whose parent was deleted
- **THEN** that agent and its descendants are deleted before the runtime serves

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
