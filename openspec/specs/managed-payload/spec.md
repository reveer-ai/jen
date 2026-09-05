# managed-payload Specification

## Purpose

Defines the set of files jen owns inside a project it governs, and the rules by which those files are written, recognized as jen's, and eventually removed — so that an update can reconcile an installed project without a state file and without ever touching what the project itself authored.

## Requirements

### Requirement: The payload is a declared set of managed files

jen SHALL declare, as data rather than as logic, the set of files it owns in an installed project. The declaration SHALL distinguish two kinds:

- **Fixed paths** — a single known location jen always writes. Root `AGENTS.md` is one.
- **Variable sets** — a group of files jen writes into a directory it shares with the project, where the membership of the group can change between versions. The skills jen ships into `.claude/skills/` are one.

Skills are one kind of managed file, not the only kind. The declaration SHALL NOT assume a managed file is a skill.

A shipped skill need not be a stage of the pipeline. The set of skills jen ships SHALL be free to hold a skill that no status triggers, so the set SHALL NOT be defined as the stages.

At most one variable set SHALL declare any given target directory. Two sets sharing a directory would derive the same member shape and search the same locations, so a single stamped orphan would be counted for deletion once per set.

Every path not covered by the declaration is project-owned. jen SHALL NOT modify or delete a project-owned path after it is first written.

#### Scenario: The declaration distinguishes fixed paths from variable sets

- **WHEN** the payload declaration is read
- **THEN** root `AGENTS.md` is declared as a fixed path
- **AND** the shipped skills are declared as a variable set targeting `.claude/skills/`

#### Scenario: A shipped skill that is not a stage

- **WHEN** the payload declares a skill that no pipeline status triggers
- **THEN** it is a member of the same variable set as the stage skills
- **AND** it is written, stamped, and reconciled exactly as they are

#### Scenario: One set per target directory

- **WHEN** the payload declaration is read
- **THEN** no two variable sets declare the same target directory

#### Scenario: A project-authored file outside the declaration is untouched

- **WHEN** a project has authored `.claude/skills/deploy-service/SKILL.md`, which jen does not ship
- **THEN** jen neither overwrites nor deletes it

#### Scenario: Project scaffold is written once

- **WHEN** `registry.yaml` or `openspec/` already exists in the target project
- **THEN** jen leaves the existing content in place rather than overwriting it

### Requirement: Assistant instructions go to `.claude/` and nowhere else

jen SHALL write the instructions it ships — the workflow document and the skills — into `.claude/` and to declared root paths, and into no other assistant's directory. jen SHALL NOT maintain a table of assistant directories, and SHALL NOT write byte-identical copies of a managed file to more than one location.

Support for other assistants is the project's own concern, satisfied by a symlink from that assistant's directory to the corresponding `.claude/` path, which jen neither creates nor reads.

This SHALL constrain where *instructions* go, and SHALL NOT be read as a rule that jen writes nowhere else at all. A managed file that is not an instruction — configuration the project's automation reads — SHALL be declared at the path its consumer requires, because there is no second location it could be written to and no duplication to avoid. Each such path SHALL be declared individually; jen SHALL NOT claim a directory outside `.claude/` wholesale.

No such file is currently declared: everything jen writes lands in `.claude/` or at a root path. The rule SHALL survive that, because it governs what happens when one is declared again and not whether one exists today.

#### Scenario: Instructions reach one directory

- **WHEN** jen writes the workflow document and the skills into a project
- **THEN** they are created under `.claude/` and at declared root paths only
- **AND** no `.codex/`, `.cursor/`, or other assistant directory is created or modified

#### Scenario: A symlinked assistant directory receives updates for free

- **WHEN** a project has symlinked another assistant's skills directory to `.claude/skills` and jen overwrites a stage skill
- **THEN** the updated content is visible through the symlink
- **AND** jen performed no additional write to do so

#### Scenario: Every written path is `.claude/` or a root path

- **WHEN** the payload declaration is read
- **THEN** every target jen writes is under `.claude/` or at the repository root

#### Scenario: A declared path outside `.claude/`

- **WHEN** the payload declares a file the project's automation reads at the path that consumer requires
- **THEN** jen writes it there
- **AND** it writes no copy of it anywhere else
- **AND** no other file in that directory is claimed by having declared it

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

- **WHEN** the skills jen ships are read in jen's own `.claude/skills/`
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

