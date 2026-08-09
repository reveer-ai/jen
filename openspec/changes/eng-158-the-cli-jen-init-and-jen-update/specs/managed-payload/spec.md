## MODIFIED Requirements

### Requirement: Root `AGENTS.md` is owned wholesale

jen SHALL own root `AGENTS.md` in its entirety and overwrite it completely. jen SHALL NOT define marker delimiters, parse the file for a managed region, or merge content into it.

Wholesale ownership SHALL begin at adoption. A fixed path carries no ownership stamp, so on first contact jen cannot distinguish a file it wrote from one the project authored; `jen init` therefore refuses to overwrite an existing, differing fixed path unless forced, as required by the `project-install` capability. From that point on — every `jen update`, and every subsequent `jen init` — the file is jen's and is replaced without regard to its current content.

Project-specific agent instructions belong to the nearest `AGENTS.md` at or below `src/`, which is project-owned and outside the managed set.

#### Scenario: The file is replaced, not merged

- **WHEN** a project has adopted the workflow and its root `AGENTS.md` differs from the shipped one and jen writes its payload
- **THEN** the file is byte-identical to the shipped `AGENTS.md` afterward

#### Scenario: An unadopted project's file is not replaced

- **WHEN** a project that has never adopted the workflow holds a root `AGENTS.md` of its own and `jen init` runs without `--force`
- **THEN** the file is unchanged

#### Scenario: No marker syntax exists

- **WHEN** the shipped `AGENTS.md` is searched for marker delimiters
- **THEN** no `JEN:START`, `JEN:END`, or equivalent marker is present

#### Scenario: Project notes below `src/` survive

- **WHEN** a project has authored `src/api/AGENTS.md` and jen writes its payload
- **THEN** `src/api/AGENTS.md` is unchanged
