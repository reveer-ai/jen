# openspec-integration Specification

## Purpose
TBD - created by archiving change eng-131-initialize-jen. Update Purpose after archive.
## Requirements
### Requirement: OpenSpec is available to agents without out-of-band setup

OpenSpec SHALL be obtained from the version jen declares as a dependency, and SHALL NOT be carried in-tree as copied skills or command wrappers. A vendored copy is a snapshot that goes stale silently as OpenSpec releases, and it obliges jen to know OpenSpec's file list.

`jen init` SHALL initialize OpenSpec in the target project by invoking the OpenSpec CLI resolved from jen's own dependency tree, so that adoption is a single command. It SHALL do so only when the project is not already OpenSpec-initialized, and SHALL leave an initialized project's OpenSpec configuration untouched.

An adopted project SHALL be able to run OpenSpec for the life of the project, since every stage of the workflow depends on it. Installing jen as a project dependency is what satisfies this for an attended checkout, bringing OpenSpec with it and pinning both versions in the project's lockfile. jen SHALL NOT create or modify the project's package manifest to achieve this; where OpenSpec would not resolve from the project after initialization, `jen init` SHALL report it, so that a project installed some other way is told rather than left to discover it at the first stage.

A dispatched stage session is not an attended checkout and the project-dependency install does not reach it: it runs in a bare clone that the pipeline never installs dependencies into, so OpenSpec resolves neither from the clone's own tree nor from a global install of jen, whose bin links cover jen's entrypoint alone and not a dependency's. The pipeline SHALL make the OpenSpec CLI reachable to the session it launches, invoking the same entrypoint jen resolves from its own dependency tree. The session SHALL thereby run the OpenSpec version jen depends on, with no separate install, network fetch, or version pin of its own, and however a stage's skills invoke it — as `openspec` or as `npx openspec`. This SHALL hold identically whichever runner launched the session.

#### Scenario: An agent works in a fresh clone

- **WHEN** a fresh clone of an adopted project has its dependencies installed
- **THEN** the OpenSpec skills and command wrappers are present
- **AND** no setup step beyond the install is required before the first artifact is created

#### Scenario: A skill is invoked by name

- **WHEN** an agent invokes one of the `openspec-*` skills
- **THEN** the skill is resolvable from the project's own `.claude/skills/`
- **AND** it was produced from the declared dependency rather than from a copy tracked in the repository

#### Scenario: OpenSpec is initialized during adoption

- **WHEN** `jen init` runs in a project that is not OpenSpec-initialized
- **THEN** OpenSpec is initialized in that project
- **AND** its skills and command wrappers are present afterward

#### Scenario: An initialized project is left alone

- **WHEN** `jen init` runs in a project that already holds an `openspec/` directory
- **THEN** OpenSpec initialization is skipped
- **AND** the existing OpenSpec configuration is unchanged

#### Scenario: No OpenSpec file is carried in-tree

- **WHEN** jen's shipped payload is listed
- **THEN** it contains no OpenSpec skill and no OpenSpec command wrapper

#### Scenario: An unreachable OpenSpec is reported

- **WHEN** `jen init` completes in a project from which the OpenSpec CLI would not resolve
- **THEN** the command reports it, naming how to make OpenSpec available

#### Scenario: The package manifest is not written

- **WHEN** `jen init` runs in a project with a package manifest
- **THEN** the manifest is unchanged

#### Scenario: A dispatched stage session runs OpenSpec

- **WHEN** a stage session is launched into a bare clone that has had no dependency install
- **THEN** the OpenSpec CLI is invokable from the session, both as `openspec` and via `npx openspec`
- **AND** the version it runs is the one jen declares as a dependency
- **AND** no network fetch and no additional install step is required for it

#### Scenario: The same session under either runner

- **WHEN** the same stage session is launched by the runner jen ships and by a runner it does not
- **THEN** the OpenSpec CLI is reachable to the session in the same way under both

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

The repository SHALL hold one `openspec/` directory at its root, containing in-flight changes, archived changes, and the specs they resolve to. A project SHALL NOT carry more than one, whatever else the repository holds and however many things deploy out of it.

The directory sits at the repository root rather than beside the sources it describes, alongside the rest of what the workflow owns, so that a project's specs are one set regardless of how its sources under `src/` are organized.

#### Scenario: A change is created in an adopted project

- **WHEN** a change is created in a project that has adopted the workflow
- **THEN** it is written under the single root `openspec/`
- **AND** no second `openspec/` directory is created for a subtree

#### Scenario: A change is created in a fork

- **WHEN** a change is created in a git fork of an adopted project's repository
- **THEN** it is written under that repository's single root `openspec/`
- **AND** forking the repository neither adds a second `openspec/` nor changes where changes are written

#### Scenario: A change is archived

- **WHEN** a change completes
- **THEN** its delta specs resolve into the specs under `openspec/`
- **AND** the change moves into the archive

#### Scenario: Sources are organized without splitting the specs

- **WHEN** a project's sources under `src/` are divided into several deployable parts
- **THEN** the specs describing them remain in the one root `openspec/`

