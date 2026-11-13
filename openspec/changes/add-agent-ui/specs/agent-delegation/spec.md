## MODIFIED Requirements

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

### Requirement: The behavior live check fails on any fault
A behavior live check run SHALL fail if it doesn't settle within 6 minutes, if the owner gets a number of replies other than the task's expected number, or on any `list_agents` call, refused or failed tool call other than a `read_file` of a file that doesn't exist, message sent twice to the same receiver with the same text, sub-agent reply of 1 to 9 characters, model error event, or `publish_ui` call. A command task's run SHALL also fail if its reply lacks the line, or its workspace file shows the command ran more than once. A file task's run SHALL also fail unless the changed file matches the expected bytes exactly and the created file matches the given text, with or without a final newline. Replies SHALL be read as in the delegation live check. A failure SHALL print the run's transcript.

#### Scenario: A faulty run
- **WHEN** a run's root calls `list_agents`
- **THEN** the check fails and prints that run's transcript

#### Scenario: The command run twice
- **WHEN** the command task's root runs the command a second time, in any form, to find the line
- **THEN** the check fails and prints that run's transcript

#### Scenario: An edit that changes more
- **WHEN** the file task's root changes any byte of the generated file other than the asked-for line
- **THEN** the check fails and prints that run's transcript

#### Scenario: Checking before creating
- **WHEN** a root calls `read_file` on a file that doesn't exist yet, then creates it
- **THEN** the not-found error isn't a fault

#### Scenario: An edit that doesn't match
- **WHEN** the file task's root calls `edit_file` with an `old_string` the file doesn't hold
- **THEN** the check fails on the failed tool call, even if a later call succeeds

#### Scenario: An unasked-for UI
- **WHEN** a root publishes a UI in a run whose task asked for none
- **THEN** the check fails and prints that run's transcript
