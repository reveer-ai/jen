# Spec Delta

## ADDED Requirements

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

## MODIFIED Requirements

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

### Requirement: A grant never exceeds its parent's
A new agent's grant SHALL be a subset of its parent's, where the owner has every capability. A caller without `spawn` SHALL NOT spawn at all. A request that breaks either rule SHALL get `403` and create nothing.

#### Scenario: A caller without spawn
- **WHEN** an agent whose grant has `spawn` false posts to `/agents`
- **THEN** it gets `403` and no agent is created

#### Scenario: A caller without workspace
- **WHEN** an agent whose grant has `spawn` and not `workspace` posts `{"grant": {"workspace": true}}`
- **THEN** it gets `403` and no agent is created

### Requirement: Deleting removes everything under an agent
`DELETE /agents/:id` SHALL stop and permanently remove the agent and every one of its descendants, including their stored conversations and their workspaces' files, and answer `204`. Repeating a delete that was interrupted SHALL finish it.

#### Scenario: Deleting a parent
- **WHEN** the owner deletes a root agent that has a child
- **THEN** neither appears in any list, neither's state remains, and they no longer count toward `JEN_MAX_AGENTS`

#### Scenario: Deleting an agent with a workspace
- **WHEN** the owner deletes an agent that has a workspace
- **THEN** no workspace container or volume of that agent remains

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

### Requirement: Each agent is told who it is
Each time an agent starts, the runtime SHALL give it `JEN_AGENT_ID` (its ID), `JEN_PARENT` (its parent's ID, or `owner` for a root agent) and `JEN_GRANT` (its grant as JSON, with both keys).

#### Scenario: A sub-agent's identity
- **WHEN** a root agent spawns a child with `{"spawn": false}`
- **THEN** the child's container has `JEN_AGENT_ID` set to the child's ID, `JEN_PARENT` to the root's ID, and `JEN_GRANT` to `{"spawn":false,"workspace":false}`
