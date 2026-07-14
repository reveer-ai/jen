# agent-instructions Specification

## Purpose
TBD - created by archiving change eng-131-initialize-jen. Update Purpose after archive.
## Requirements
### Requirement: A single authoritative workflow document

The repository SHALL carry exactly one document stating the workflow, at `AGENTS.md` in the repository root. Any agent acting within the repository MUST adhere to it. No other file may restate the workflow.

#### Scenario: An agent begins work in the repository

- **WHEN** an agent starts work in a repository forked from jen
- **THEN** `AGENTS.md` is present at the repository root
- **AND** it states the workflow the agent is bound to

#### Scenario: A second copy of the workflow is proposed

- **WHEN** a change would add workflow text to a file other than `AGENTS.md`
- **THEN** the change is rejected in favor of amending `AGENTS.md`
- **AND** the other file points at `AGENTS.md` instead of restating it

### Requirement: Tool-specific instruction files are pointers

A coding assistant that reads its own filename rather than `AGENTS.md` SHALL be served by a file whose entire content is a pointer to `AGENTS.md`. `CLAUDE.md` SHALL be such a pointer.

#### Scenario: Claude Code reads its instruction file

- **WHEN** Claude Code loads `CLAUDE.md`
- **THEN** the file's content directs it to `AGENTS.md`
- **AND** the workflow text itself appears only in `AGENTS.md`

#### Scenario: The workflow is amended

- **WHEN** `AGENTS.md` is edited
- **THEN** no pointer file requires a corresponding edit
- **AND** every assistant reads the amended workflow on its next load

### Requirement: The workflow states what the work is anchored to

`AGENTS.md` SHALL state that the task, tracked in project-management software, is the source of truth, and that OpenSpec changes, git branches, and PRs trace back to a task and exist to serve it.

#### Scenario: An agent must decide where a decision is recorded

- **WHEN** an agent records why work was done a particular way
- **THEN** `AGENTS.md` directs it to the task rather than to the git log

#### Scenario: An artifact exists without a task

- **WHEN** an OpenSpec change, branch, or PR cannot be traced to a task
- **THEN** it contradicts the stated source of truth and is not valid workflow output

### Requirement: The workflow states the repository model

`AGENTS.md` SHALL state that a project's repository is a fork of jen rather than a separate repository jen references, that source, specs, and history stay unified in that one repository, and that project-management projects and repositories are not necessarily one-to-one.

#### Scenario: A project is set up

- **WHEN** a new project adopts the workflow
- **THEN** it forks jen and fills the fork in
- **AND** it does not create a separate repository for jen to point at

#### Scenario: Two project-management projects target one repository

- **WHEN** more than one project-management project tracks work in the same fork
- **THEN** the model permits it, because the mapping is not one-to-one

