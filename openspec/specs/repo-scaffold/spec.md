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

### Requirement: Assistant configuration is shared except where it is per-install

Assistant configuration SHALL be split in two. The permissions the workflow's stages depend on are identical in every clone and SHALL be tracked, in `.claude/settings.json`, so they are granted once rather than per install.

Configuration whose values differ from one install to the next — `.claude/settings.local.json`, which carries MCP server ids meaningless in anyone else's clone — SHALL NOT be tracked.

#### Scenario: A clone needs the permissions the stages use

- **WHEN** the repository is cloned
- **THEN** `.claude/settings.json` is present with the workflow's permissions
- **AND** they do not have to be re-granted

#### Scenario: Per-install configuration is written

- **WHEN** an install writes `.claude/settings.local.json`
- **THEN** git does not record it
- **AND** it stays local to that install

