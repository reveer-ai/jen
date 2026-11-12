# Spec Delta

## MODIFIED Requirements

### Requirement: Delegation tools follow the grant
The agent SHALL offer `message_sub_agent`, `spawn_agent` (taking a grant), `list_agents`, `stop_agent`, `start_agent` and `delete_agent` (each taking an ID), and `wait`, only when its grant has `spawn`. It SHALL offer `run_command` only when its grant has `workspace`. An agent with neither SHALL be offered no tools. Each tool other than `message_sub_agent` and `wait` SHALL call the matching runtime route with the agent's own token and return the runtime's answer.

#### Scenario: Agent with spawn
- **WHEN** an agent whose grant has `spawn` and not `workspace` calls the model
- **THEN** the model is offered `message_sub_agent`, `spawn_agent`, `list_agents`, `stop_agent`, `start_agent`, `delete_agent` and `wait`

#### Scenario: Agent with workspace only
- **WHEN** an agent whose grant has `workspace` and not `spawn` calls the model
- **THEN** the model is offered `run_command` and no other tool

#### Scenario: Agent with both
- **WHEN** an agent whose grant has `spawn` and `workspace` calls the model
- **THEN** the model is offered the delegation tools and `run_command`

#### Scenario: Agent without spawn
- **WHEN** an agent whose grant has neither `spawn` nor `workspace` calls the model
- **THEN** the model is offered no tools

#### Scenario: Spawning a sub-agent
- **WHEN** the model calls `spawn_agent` with the grant `{"spawn": false}`
- **THEN** the runtime creates a child of the agent with that grant, and the call's result holds the new agent's ID

### Requirement: Agents behave on the live check's tasks
With Docker running and model credentials configured, a behavior live check SHALL start its own runtime and run seven owner tasks three times each, in parallel, each with its own root: one delegation, a direct answer, fan-out to three sub-agents, a task that needs a question answered first, a follow-up, a nested team, and a command whose output is far over the cap. The first six SHALL keep their roots' grants, and the command task's root SHALL have `workspace`. A run SHALL be settled after 30 seconds with no new event on any of its agents' streams. Without credentials or Docker the check SHALL behave as the existing live checks do.

#### Scenario: The question is answered
- **WHEN** a run's task needs a question answered first, and the root sends its first reply
- **THEN** the check sends the root "Maya and Jordan."

#### Scenario: The command task
- **WHEN** the command task's root is asked to run a given command exactly once and report one line from its output
- **THEN** the command prints a log far over the cap with that line in neither the start nor the end the result keeps, and appends to a file in the workspace each time it runs

#### Scenario: Every run behaves
- **WHEN** the behavior live check runs with Docker and credentials
- **THEN** all 21 runs settle, and each gets its task's expected number of owner replies with none of the faults

### Requirement: The behavior live check fails on any fault
A behavior live check run SHALL fail if it doesn't settle within 6 minutes, if the owner gets a number of replies other than the task's expected number, or on any `list_agents` call, refused or failed tool call, message sent twice to the same receiver with the same text, sub-agent reply of 1 to 9 characters, or model error event. A command task's run SHALL also fail if its reply lacks the line, or its workspace file shows the command ran more than once. Replies SHALL be read as in the delegation live check. A failure SHALL print the run's transcript.

#### Scenario: A faulty run
- **WHEN** a run's root calls `list_agents`
- **THEN** the check fails and prints that run's transcript

#### Scenario: The command run twice
- **WHEN** the command task's root runs the command a second time, in any form, to find the line
- **THEN** the check fails and prints that run's transcript
