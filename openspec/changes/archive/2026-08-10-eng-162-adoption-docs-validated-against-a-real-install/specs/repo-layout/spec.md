## MODIFIED Requirements

### Requirement: jen's own source lives at `cli/`

jen's CLI source SHALL live in a top-level `cli/` directory. It SHALL NOT live in `src/`.

`src/` names the same location in jen and in every project that adopts it: the project's own sources, sitting where a repository root would conventionally hold them, beneath a root the workflow owns. jen's own code is workflow-level and belongs beside `src/` rather than inside it, so that an adopter's `src/` and jen's mean the same thing.

Whether that location is tracked is a property of the repository, not of the workflow. An adopted project's sources ARE its repository's content and SHALL be tracked there. jen's own repository governs no sources of its own, so its `src/` holds only working checkouts and is ignored. jen SHALL NOT impose either arrangement on a project: it writes no ignore file, and the `project-install` capability forbids it from modifying one.

#### Scenario: CLI source is at the top level

- **WHEN** the repository is listed
- **THEN** the CLI's TypeScript sources are under `cli/`
- **AND** no jen source file exists under `src/`

#### Scenario: `src/` remains untracked

- **WHEN** jen's own repository's tracked files are listed
- **THEN** no path under `src/` appears

#### Scenario: An adopted project tracks its sources under `src/`

- **WHEN** a project that has adopted the workflow commits its own application sources
- **THEN** they are tracked under `src/` in the same repository as the workflow's files
- **AND** no ignore rule written by jen excludes them

#### Scenario: Adoption does not import jen's ignore rules

- **WHEN** jen writes its payload into a project
- **THEN** the project's ignore rules are unchanged
- **AND** `src/` is not excluded on jen's account
