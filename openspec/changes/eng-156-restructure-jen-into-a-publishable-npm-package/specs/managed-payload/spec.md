## ADDED Requirements

### Requirement: The payload is a declared set of managed files

jen SHALL declare, as data rather than as logic, the set of files it owns in an installed project. The declaration SHALL distinguish two kinds:

- **Fixed paths** — a single known location jen always writes. Root `AGENTS.md` is one.
- **Variable sets** — a group of files jen writes into a directory it shares with the project, where the membership of the group can change between versions. The six stage skills in `.claude/skills/` are one.

Skills are one kind of managed file, not the only kind. The declaration SHALL NOT assume a managed file is a skill.

Every path not covered by the declaration is project-owned. jen SHALL NOT modify or delete a project-owned path after it is first written.

#### Scenario: The declaration distinguishes fixed paths from variable sets

- **WHEN** the payload declaration is read
- **THEN** root `AGENTS.md` is declared as a fixed path
- **AND** the six stage skills are declared as a variable set targeting `.claude/skills/`

#### Scenario: A project-authored file outside the declaration is untouched

- **WHEN** a project has authored `.claude/skills/deploy-service/SKILL.md`, which jen does not ship
- **THEN** jen neither overwrites nor deletes it

#### Scenario: Project scaffold is written once

- **WHEN** `registry.yaml` or `openspec/` already exists in the target project
- **THEN** jen leaves the existing content in place rather than overwriting it

### Requirement: jen writes only to `.claude/`

jen SHALL write into `.claude/` and no other assistant directory. jen SHALL NOT maintain a table of target directories, and SHALL NOT write byte-identical copies of a managed file to more than one location.

Support for other assistants is the project's own concern, satisfied by a symlink from that assistant's directory to the corresponding `.claude/` path, which jen neither creates nor reads.

#### Scenario: Only the Claude directory receives the payload

- **WHEN** jen writes its payload into a project
- **THEN** files are created under `.claude/` and at declared root paths only
- **AND** no `.github/`, `.codex/`, or other assistant directory is created or modified

#### Scenario: A symlinked assistant directory receives updates for free

- **WHEN** a project has symlinked `.github/skills` to `.claude/skills` and jen overwrites a stage skill
- **THEN** the updated content is visible through the symlink
- **AND** jen performed no additional write to do so

### Requirement: Files in a variable set carry an ownership stamp

Every file jen writes as part of a variable set SHALL carry a stamp marking it as jen's: the key `jen` with the value `true`, under `metadata` in the file's YAML frontmatter.

The stamp SHALL be a single namespaced key. Its presence is what denotes jen's ownership, so no companion author or version field is required, and the stamp SHALL be constant across releases — a value that changed per version would rewrite every managed file in every project on every release.

Files declared as fixed paths SHALL NOT require a stamp. A fixed path is always written and can never be left orphaned, so it is never a deletion candidate.

Every file jen ships as part of a variable set MUST be capable of carrying the stamp. A format with no frontmatter and no comment syntax — JSON in particular — SHALL NOT be shipped as part of a variable set.

The stamp SHALL be applied when the payload is staged, not stored in the repository's own working copies, since jen's own checkout is not a managed install.

#### Scenario: A staged skill is stamped

- **WHEN** the payload is staged during `prepack`
- **THEN** each staged `SKILL.md` frontmatter contains `jen: true` under `metadata`

#### Scenario: The stamp is stable across releases

- **WHEN** the payload is staged at two different package versions with no change to a skill's content
- **THEN** that skill's staged bytes are identical between the two

#### Scenario: A fixed path carries no stamp

- **WHEN** the staged `AGENTS.md` is read
- **THEN** it contains no jen stamp

#### Scenario: Working copies stay unstamped

- **WHEN** the six stage skills in jen's own `.claude/skills/` are read
- **THEN** none contains a jen stamp

#### Scenario: A stamped skill remains valid

- **WHEN** a stamped `SKILL.md` is parsed as an Agent Skill
- **THEN** it parses successfully with its `name` and `description` intact

### Requirement: Deletion is the stamp intersected with the shipped payload

A file SHALL be deleted if and only if it carries jen's stamp and is absent from the payload jen currently ships. The stamp makes a file a deletion candidate; presence in the shipped payload spares it.

This rule requires no record of what jen wrote previously — the stamps distributed across the files are that record. jen SHALL NOT persist a manifest, ledger, or other state file for this purpose.

Consequently, removing the stamp from a file transfers ownership of it to the project, and jen SHALL thereafter leave it alone.

#### Scenario: A skill jen no longer ships is removed

- **WHEN** a project holds a stamped `.claude/skills/legacy-stage/SKILL.md` and the current payload does not include `legacy-stage`
- **THEN** jen deletes it

#### Scenario: A skill jen still ships is kept

- **WHEN** a project holds a stamped `.claude/skills/design-task/SKILL.md` and the current payload includes `design-task`
- **THEN** jen overwrites it rather than deleting it

#### Scenario: An unstamped file is never deleted

- **WHEN** a project holds an unstamped `.claude/skills/legacy-stage/SKILL.md` and the current payload does not include `legacy-stage`
- **THEN** jen leaves it untouched

#### Scenario: No state file is created

- **WHEN** jen has written its payload into a project
- **THEN** no manifest or equivalent state file recording written paths exists

#### Scenario: Removing the stamp claims the file

- **WHEN** a project copies a stage skill to a new name and deletes the stamp from the copy
- **THEN** jen neither overwrites nor deletes that copy on any subsequent run

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
