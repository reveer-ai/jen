## MODIFIED Requirements

### Requirement: A single authoritative workflow document

The repository SHALL carry exactly one document stating the workflow, at `AGENTS.md` in the repository root. Any agent acting within the repository MUST adhere to it. No other file may restate the workflow.

A nested `AGENTS.md` at or below `src/` is not a second copy of the workflow and does not violate this: it holds notes about the project's own code, which the workflow does not describe and the root document does not carry.

#### Scenario: An agent begins work in the repository

- **WHEN** an agent starts work in a project that has adopted the workflow
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

### Requirement: The workflow states the repository model

`AGENTS.md` SHALL state that a project adopts the workflow by installing jen into the project's own repository, not by forking jen and not by creating a separate repository for jen to point at.

It SHALL state how that repository is arranged: the root is jen's, holding the workflow document, the shipped skills, `openspec/`, and `registry.yaml`; and `src/` holds what would conventionally sit at the repository root — the project's own sources, tracked in the same repository.

It SHALL state that source, specs, and history stay unified in that one repository, however many things deploy out of it, and that project-management projects and repositories are not necessarily one-to-one.

It SHALL NOT describe forking as the adoption model, and SHALL NOT describe the project's sources as living in a repository separate from the one the workflow runs in.

#### Scenario: A project is set up

- **WHEN** a new project adopts the workflow
- **THEN** it installs jen into its own repository
- **AND** it neither forks jen nor creates a separate repository for jen to point at

#### Scenario: An agent locates the project's own sources

- **WHEN** an agent reads `AGENTS.md` to find where the project's code lives
- **THEN** it is directed to `src/`
- **AND** the document states that those sources are tracked by the same repository

#### Scenario: Two project-management projects target one repository

- **WHEN** more than one project-management project tracks work in the same repository
- **THEN** the model permits it, because the mapping is not one-to-one

#### Scenario: Forking is not described as adoption

- **WHEN** `AGENTS.md` is read for how a project takes up the workflow
- **THEN** no passage presents forking jen as the way to do it

### Requirement: Project notes live in the nearest `AGENTS.md`, never the root one

A convention or gotcha specific to the project's own code SHALL be written to the `AGENTS.md` nearest the code it applies to. Such notes SHALL live at or below `src/`, as deep as the thing they describe, and SHALL NOT be written to the root `AGENTS.md`.

The root document is the workflow, shipped to and overwritten in every project that adopts it; a project's notes do not belong in a file the next update replaces wholesale.

#### Scenario: A project note is written

- **WHEN** work establishes something a future session working on that code would need to know
- **THEN** it is written to the `AGENTS.md` nearest that code, at or below `src/`

#### Scenario: A project note is aimed at the root document

- **WHEN** a note about the project's own code would be added to the root `AGENTS.md`
- **THEN** it is redirected to the nearest `AGENTS.md` at or below `src/`

#### Scenario: A note in the root document does not survive an update

- **WHEN** a project has written its own notes into the root `AGENTS.md` and `jen update` runs
- **THEN** those notes are gone, because the file is replaced wholesale
