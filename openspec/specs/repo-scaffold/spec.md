# repo-scaffold Specification

## Purpose
TBD - created by archiving change eng-131-initialize-jen. Update Purpose after archive.
## Requirements
### Requirement: Tracking is default-deny with an explicit allowlist

`.gitignore` SHALL ignore all paths (`*`) and then re-admit, by explicit negation, each path the repository owns. A path not named in the allowlist SHALL NOT be tracked.

#### Scenario: A file jen owns is added

- **WHEN** a file the repository owns is added and named in `.gitignore` as an exception
- **THEN** git tracks it

#### Scenario: A project adds its own file

- **WHEN** a project working in a fork creates a file not named in the allowlist
- **THEN** git ignores it
- **AND** the project must admit it deliberately to track it

#### Scenario: A new directory is introduced without being admitted

- **WHEN** a change creates a directory but does not add a matching exception
- **THEN** the directory exists on disk and git does not record it
- **AND** the omission produces no error or warning

### Requirement: Ignored files stay visible to search tooling

The repository SHALL carry an `.ignore` file that re-admits every path (`!*`) for editor and search tooling, counteracting the default-deny `.gitignore` for tools that honor ignore files when searching.

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

