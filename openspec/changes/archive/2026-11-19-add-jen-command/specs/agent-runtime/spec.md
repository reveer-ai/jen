## MODIFIED Requirements

### Requirement: Spawning starts a child of the caller
`POST /agents` with a body `{"grant": <grant>}` SHALL create an agent whose parent is the caller, start it, and answer `201` with the agent. An agent the owner spawns is a root agent, and the owner's body SHALL also carry its `"name"`. An agent SHALL be described as `{"id", "parent", "name", "grant", "state"}`, where `parent` is null for a root agent, `name` is null for a sub-agent, and `state` is `running` or `stopped`. A body that isn't JSON, or whose grant isn't a grant, SHALL get `400`.

#### Scenario: The owner spawns a root agent
- **WHEN** the owner posts `{"grant": {"spawn": true}, "name": "home"}` to `/agents`
- **THEN** it gets `201` with a new agent whose `parent` is null, whose `name` is `home` and whose `state` is `running`

#### Scenario: An agent spawns a sub-agent
- **WHEN** a running agent that has `spawn` posts `{"grant": {"spawn": false}}` with its own token
- **THEN** it gets `201` with a new agent whose `parent` is that agent's ID and whose `name` is null

#### Scenario: Passing on the workspace grant
- **WHEN** a running agent that has `spawn` and `workspace` posts `{"grant": {"workspace": true}}`
- **THEN** it gets `201` with a new agent whose grant is `{"spawn": false, "workspace": true}`

## ADDED Requirements

### Requirement: A root agent has a name of its own
A root's name SHALL be 1 to 32 characters of lowercase letters, digits and hyphens, starting with a letter. The owner's spawn SHALL get `400` when its name is missing or malformed, and `409` when another of the runtime's roots has that name, creating nothing either way. An agent's spawn that carries a `name` SHALL get `400`. A name SHALL be fixed for the root's life, and SHALL survive a runtime restart.

#### Scenario: A name already taken
- **WHEN** the owner spawns a root named `home` while another root is named `home`
- **THEN** it gets `409`, and no agent is created

#### Scenario: A malformed name
- **WHEN** the owner spawns a root named `Home`, or without a name
- **THEN** it gets `400`, and no agent is created

#### Scenario: A sub-agent can't be named
- **WHEN** an agent that has `spawn` posts `{"grant": {"spawn": false}, "name": "helper"}`
- **THEN** it gets `400`, and no agent is created

#### Scenario: The name survives a restart
- **WHEN** the runtime is replaced after the owner spawned a root named `home`
- **THEN** the new runtime describes that root with `name` `home`, and refuses another root named `home`

#### Scenario: A root from before names
- **WHEN** the runtime reads a root whose volume has no name
- **THEN** it describes that root with `name` null, and that root's missing name blocks no name for a new root
