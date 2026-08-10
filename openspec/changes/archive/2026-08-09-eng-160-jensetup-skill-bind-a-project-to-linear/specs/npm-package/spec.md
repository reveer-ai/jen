## MODIFIED Requirements

### Requirement: `prepack` stages the payload

A `prepack` script SHALL compile the CLI to `dist/` and stage the payload into `dist/templates/`, placing each skill the payload declares at `dist/templates/skills/<name>/SKILL.md` and the workflow document at `dist/templates/AGENTS.md`. Staging SHALL apply the ownership stamp defined by the `managed-payload` capability.

The staged tree SHALL be generated, never committed, and SHALL NOT be hand-edited. Its layout SHALL be tool-neutral: no path within it SHALL be named for a particular assistant.

Staging SHALL be deterministic — the same repository state produces byte-identical staged output.

#### Scenario: Staging produces the payload

- **WHEN** `prepack` runs
- **THEN** `dist/templates/skills/` contains one directory for each skill the payload declares and no others, each holding a stamped `SKILL.md`
- **AND** `dist/templates/AGENTS.md` matches the repository's root `AGENTS.md` in content

#### Scenario: The staged layout names no assistant

- **WHEN** the paths under `dist/templates/` are listed
- **THEN** no path segment is `.claude`, `.github`, `.codex`, or any other assistant directory

#### Scenario: Staging is repeatable

- **WHEN** `prepack` runs twice against the same repository state
- **THEN** the staged files are byte-identical between runs

#### Scenario: The staged tree is not tracked

- **WHEN** the repository's tracked files are listed
- **THEN** no path under `dist/` appears
