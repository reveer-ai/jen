## REMOVED Requirements

### Requirement: Tracking is default-deny with an explicit allowlist

**Reason**: Superseded by the `repo-layout` requirement "The repository tracks files by default", which shipped in this change. The default-deny allowlist was a fork-template artifact, written so the template ignored everything a project added. It could not survive jen becoming a publishable package: the CLI's own source has to be trackable, and under an allowlist every new source file needs a `.gitignore` edit before git will record it — an omission that produces no error or warning.

**Migration**: `.gitignore` is now a conventional ignore file naming what is excluded — build output, dependencies, `src/`, the locally regenerated OpenSpec artifacts, and per-install files. A fork still carrying the `*`-plus-negation form replaces it with the conventional one. Nothing previously tracked becomes untracked; paths that were admitted by negation are simply no longer excluded to begin with.

## MODIFIED Requirements

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
