# agent-instructions Specification

## Purpose
TBD - created by archiving change eng-131-initialize-jen. Update Purpose after archive.
## Requirements
### Requirement: A single authoritative workflow document

The repository SHALL carry exactly one document stating the workflow, at `AGENTS.md` in the repository root. Any agent acting within the repository MUST adhere to it. No other file may restate the workflow.

A nested `AGENTS.md` at or below `src/` is not a second copy of the workflow and does not violate this: it holds notes about the project's own code, which the workflow does not describe and the root document does not carry.

#### Scenario: An agent begins work in the repository

- **WHEN** an agent starts work in a repository forked from jen
- **THEN** `AGENTS.md` is present at the repository root
- **AND** it states the workflow the agent is bound to

#### Scenario: A second copy of the workflow is proposed

- **WHEN** a change would add workflow text to a file other than `AGENTS.md`
- **THEN** the change is rejected in favor of amending `AGENTS.md`
- **AND** the other file points at `AGENTS.md` instead of restating it

#### Scenario: A nested instruction file holds project notes

- **WHEN** an `AGENTS.md` exists at or below `src/` holding notes about the project's own code
- **THEN** it coexists with the root document
- **AND** neither restates the other

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

### Requirement: The workflow document states the stages and the conventions they share

`AGENTS.md` SHALL state the pipeline's stages — each status, the skill it triggers, the work that stage does, and where it hands off — and the conventions every stage obeys.

A stage's own instructions SHALL NOT restate a shared convention. Six copies of a rule are six things to edit and six chances to disagree, and because each stage reads only its own instructions the disagreement goes unnoticed.

#### Scenario: An agent needs to know what a stage does

- **WHEN** an agent reads `AGENTS.md`
- **THEN** it finds every stage, the status that triggers it, and the status it hands off to

#### Scenario: A shared convention changes

- **WHEN** a convention every stage obeys is amended
- **THEN** only `AGENTS.md` is edited
- **AND** no stage's instructions require a corresponding edit

#### Scenario: A stage's instructions are read on their own

- **WHEN** one stage's instructions are read in isolation
- **THEN** they presume the conventions stated in `AGENTS.md` rather than repeating them

### Requirement: Project notes live in the nearest `AGENTS.md`, never the root one

A convention or gotcha specific to the project's own code SHALL be written to the `AGENTS.md` nearest the code it applies to. Such notes SHALL live at or below `src/`, as deep as the thing they describe, and SHALL NOT be written to the root `AGENTS.md`.

The root document is the workflow, shared with every fork; a project's notes do not belong in the file every other project also carries.

#### Scenario: A project note is written

- **WHEN** work establishes something a future session working on that code would need to know
- **THEN** it is written to the `AGENTS.md` nearest that code, at or below `src/`

#### Scenario: A project note is aimed at the root document

- **WHEN** a note about the project's own code would be added to the root `AGENTS.md`
- **THEN** it is redirected to the nearest `AGENTS.md` at or below `src/`

