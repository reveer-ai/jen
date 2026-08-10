## MODIFIED Requirements

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
