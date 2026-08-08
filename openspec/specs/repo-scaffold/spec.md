# repo-scaffold Specification

## Purpose
TBD - created by archiving change eng-131-initialize-jen. Update Purpose after archive.
## Requirements
### Requirement: Ignored files stay visible to search tooling

The repository SHALL carry an `.ignore` file that re-admits every path (`!*`) for editor and search tooling, so that paths `.gitignore` excludes — the governed project's sources under `src/`, build output, and dependencies — stay readable to tools that honor ignore files when searching.

#### Scenario: An agent searches the working tree

- **WHEN** an agent searches with tooling that honors ignore files
- **THEN** files ignored by `.gitignore` are still returned
- **AND** the project's own untracked sources are readable

#### Scenario: The same file is searched and committed

- **WHEN** a file is admitted by `.ignore` but not by `.gitignore`
- **THEN** search tooling shows it
- **AND** git still refuses to track it

### Requirement: The project's own sources live untracked under `src/`

`src/` SHALL be the location for the sources the workflow acts on, and SHALL NOT be tracked by this repository.

#### Scenario: A resource is checked out to work on

- **WHEN** the workflow needs the sources for a registered resource
- **THEN** they are placed under `src/`
- **AND** git does not record them

### Requirement: Resources are declared in a registry

All work SHALL happen in the context of resources declared in `registry.yaml`, which records each resource with its access and setup information.

#### Scenario: An agent starts a task

- **WHEN** an agent needs to know what it is acting on
- **THEN** it consults `registry.yaml` for the resources relevant to the task

