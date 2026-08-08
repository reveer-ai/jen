## ADDED Requirements

### Requirement: Managed paths are declared explicitly

jen SHALL declare, as data rather than as logic, the exact set of paths it owns in an installed project. The declaration SHALL name the six stage skills individually — `refine-epic`, `design-task`, `implement-task`, `review-task`, `test-task`, `deliver-task` — and root `AGENTS.md`. No path SHALL be treated as managed by pattern, glob, or directory sweep.

Every path not named in the declaration is project-owned. jen SHALL NOT modify or delete a project-owned path after it is first written.

#### Scenario: The declaration enumerates the payload

- **WHEN** the managed-path declaration is read
- **THEN** it lists exactly the six stage skills by name and root `AGENTS.md`
- **AND** it contains no glob, wildcard, or directory-wide entry

#### Scenario: A project-authored skill is untouched

- **WHEN** a project has authored `.claude/skills/deploy-service/SKILL.md`, which is not in the declaration
- **THEN** jen neither overwrites nor deletes it

#### Scenario: Project scaffold is written once

- **WHEN** `registry.yaml` or `openspec/` already exists in the target project
- **THEN** jen leaves the existing content in place rather than overwriting it

### Requirement: jen writes only to `.claude/`

jen SHALL write skills to `.claude/skills/` and to no other assistant directory. jen SHALL NOT maintain a table of target directories, and SHALL NOT write byte-identical copies of a skill to more than one location.

Support for other assistants is the project's own concern, satisfied by a symlink from that assistant's directory to `.claude/skills`, which jen neither creates nor reads.

#### Scenario: Only the Claude directory receives the payload

- **WHEN** jen writes its payload into a project
- **THEN** files are created under `.claude/skills/` only
- **AND** no `.github/`, `.codex/`, or other assistant directory is created or modified

#### Scenario: A symlinked assistant directory receives updates for free

- **WHEN** a project has symlinked `.github/skills` to `.claude/skills` and jen overwrites a stage skill
- **THEN** the updated content is visible through the symlink
- **AND** jen performed no additional write to do so

### Requirement: Skills carry an ownership stamp

Every skill jen ships SHALL carry, in its `SKILL.md` YAML frontmatter, a `metadata.author` field with the value `jen` and a `metadata.generatedBy` field holding the jen version that wrote it. Both fields are optional `metadata` under the Agent Skills standard, so a stamped skill SHALL remain a valid skill.

The stamp SHALL be applied when the payload is staged, not stored in the repository's own working copies — the version is known only at pack time, and jen's own checkout is not a managed install.

#### Scenario: A staged skill is stamped

- **WHEN** the payload is staged during `prepack` from a package at version `0.1.0`
- **THEN** each staged `SKILL.md` frontmatter contains `author: jen` and `generatedBy: "0.1.0"`

#### Scenario: Working copies stay unstamped

- **WHEN** the six stage skills in jen's own `.claude/skills/` are read
- **THEN** none contains an `author` or `generatedBy` field

#### Scenario: A stamped skill remains valid

- **WHEN** a stamped `SKILL.md` is parsed as an Agent Skill
- **THEN** it parses successfully with its `name` and `description` intact

### Requirement: Ownership is determined by the stamp

Whether jen may overwrite or delete a skill SHALL be determined solely by the presence of `metadata.author: jen` in that file, and never by a record stored outside it. jen SHALL NOT persist a manifest, ledger, or other state file recording what it has written.

Consequently, removing the `metadata.author` line from a skill transfers ownership of that file to the project, and jen SHALL thereafter leave it alone.

#### Scenario: No state file is created

- **WHEN** jen has written its payload into a project
- **THEN** no `.jen/manifest.json` or equivalent state file exists

#### Scenario: Ownership survives loss of external state

- **WHEN** any directory outside `.claude/skills/` is deleted and jen runs again
- **THEN** jen still correctly identifies which skills are its own, from the stamps alone

#### Scenario: Removing the stamp claims the file

- **WHEN** a project copies `design-task` to `design-task-custom` and deletes the `author: jen` line from the copy
- **THEN** jen neither overwrites nor deletes `design-task-custom` on any subsequent run

### Requirement: Root `AGENTS.md` is owned wholesale

jen SHALL own root `AGENTS.md` in its entirety and overwrite it completely. jen SHALL NOT define marker delimiters, parse the file for a managed region, or merge content into it.

Project-specific agent instructions belong to the nearest `AGENTS.md` at or below `src/`, which is project-owned and outside the managed set.

#### Scenario: The file is replaced, not merged

- **WHEN** a project's root `AGENTS.md` differs from the shipped one and jen writes its payload
- **THEN** the file is byte-identical to the shipped `AGENTS.md` afterward

#### Scenario: No marker syntax exists

- **WHEN** the shipped `AGENTS.md` is searched for marker delimiters
- **THEN** no `JEN:START`, `JEN:END`, or equivalent marker is present

#### Scenario: Project notes below `src/` survive

- **WHEN** a project has authored `src/api/AGENTS.md` and jen writes its payload
- **THEN** `src/api/AGENTS.md` is unchanged
