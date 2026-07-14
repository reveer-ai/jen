# openspec-integration Specification

## Purpose
TBD - created by archiving change eng-131-initialize-jen. Update Purpose after archive.
## Requirements
### Requirement: OpenSpec is available to agents without out-of-band setup

The repository SHALL carry OpenSpec's skills and command wrappers in-tree, so that an agent working in a fresh clone can drive a change through the artifact progression with no installation or configuration step of its own.

#### Scenario: An agent works in a fresh clone

- **WHEN** an agent clones the repository and begins a change
- **THEN** the OpenSpec skills and `opsx` commands are already present
- **AND** no setup step is required before the first artifact is created

#### Scenario: A skill is invoked by name

- **WHEN** an agent invokes one of the `openspec-*` skills
- **THEN** the skill is resolvable from the repository's own `.claude/skills/`

### Requirement: Spec-driven development follows an ordered artifact progression

Changes SHALL progress through the ordered artifacts defined by the workflow schema in use. A task's status mirrors its current stage, and moving the task to its next status is what triggers the work for that stage.

#### Scenario: A change is created

- **WHEN** a change is started
- **THEN** its artifacts are produced in the order the schema defines
- **AND** an artifact whose dependencies are unmet is not yet available to write

#### Scenario: A task advances

- **WHEN** a task is moved to the status for the next stage
- **THEN** that transition is the trigger for an agent to do that stage's work

### Requirement: Changes and specs live under a single `openspec/` directory

The repository SHALL hold one `openspec/` directory at its root, containing in-flight changes, archived changes, and the specs they resolve to. A fork SHALL NOT carry more than one.

#### Scenario: A change is created in a fork

- **WHEN** a change is created in a project forked from jen
- **THEN** it is written under the single root `openspec/`
- **AND** no second `openspec/` directory is created for a subtree

#### Scenario: A change is archived

- **WHEN** a change completes
- **THEN** its delta specs resolve into the specs under `openspec/`
- **AND** the change moves into the archive

