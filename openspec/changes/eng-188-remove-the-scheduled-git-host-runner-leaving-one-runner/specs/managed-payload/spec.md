## ADDED Requirements

### Requirement: A retired path is deleted from a project that still holds it

The payload declaration SHALL be able to name a **retired path**: a target jen previously wrote as a fixed path and no longer ships. jen SHALL delete a file found at a retired path, and SHALL report the deletion exactly as it reports the deletion of a stamped orphan.

Retirement exists because a fixed path cannot be reconciled by the stamp. A fixed path is always written and so can never be orphaned, which is why it carries none — and that reasoning ends the moment jen stops writing it. Without an explicit retirement, dropping a fixed path from the declaration leaves the file behind forever, still doing whatever it did, with nothing in the project marking it as jen's to remove.

Deletion SHALL be unconditional on the file's content, and SHALL NOT depend on it matching anything jen previously shipped. A fixed path is replaced wholesale on every run, so an edit made there was already lost at the next update; removing the file is that same contract's last act rather than a new claim over the project's work.

Only a path jen previously declared as a fixed path SHALL be retired. A retired path SHALL name a file and SHALL NOT name a directory, so that retirement can never remove a path the project authored beside jen's.

A retired path SHALL NOT also be a shipped target. A path that is both would be written and deleted in the same run, and the declaration SHALL be rejected rather than resolved by an order of operations.

Retirement SHALL be a declaration jen ships, not state written into the project. This SHALL NOT be read as the manifest that *Deletion is the stamp intersected with the shipped payload* forbids: that rule forbids jen recording, in the project, what it wrote there. A retired path records nothing about a project — it is the same kind of statement as the payload itself, read from the version of jen that is running.

#### Scenario: A retired path is removed

- **WHEN** the payload declares `.github/workflows/jen.yml` as a retired path and a project holds a file there
- **THEN** jen deletes it
- **AND** the deletion appears in the run's report

#### Scenario: A retired path the project does not hold

- **WHEN** the payload declares a retired path and the project has no file there
- **THEN** nothing is deleted and nothing is reported

#### Scenario: A retired file the project edited

- **WHEN** a project holds a retired path whose contents differ from anything jen shipped
- **THEN** jen deletes it anyway
- **AND** it is not spared, because a fixed path was replaced wholesale on every previous run

#### Scenario: A path is both shipped and retired

- **WHEN** the payload declares one target as both a shipped file and a retired path
- **THEN** the declaration is rejected

#### Scenario: Retirement does not reach the directory

- **WHEN** a retired path is removed from a directory holding files the project authored
- **THEN** those files are untouched
- **AND** the directory itself is not removed by having declared a path inside it

## MODIFIED Requirements

### Requirement: The payload is a declared set of managed files

jen SHALL declare, as data rather than as logic, the set of files it owns in an installed project. The declaration SHALL distinguish three kinds:

- **Fixed paths** — a single known location jen always writes. Root `AGENTS.md` is one.
- **Variable sets** — a group of files jen writes into a directory it shares with the project, where the membership of the group can change between versions. The skills jen ships into `.claude/skills/` are one.
- **Retired paths** — a target jen previously wrote as a fixed path and now deletes. Nothing is ever written to one.

Skills are one kind of managed file, not the only kind. The declaration SHALL NOT assume a managed file is a skill.

A shipped skill need not be a stage of the pipeline. The set of skills jen ships SHALL be free to hold a skill that no status triggers, so the set SHALL NOT be defined as the stages.

At most one variable set SHALL declare any given target directory. Two sets sharing a directory would derive the same member shape and search the same locations, so a single stamped orphan would be counted for deletion once per set.

Every path not covered by the declaration is project-owned. jen SHALL NOT modify or delete a project-owned path after it is first written.

#### Scenario: The declaration distinguishes fixed paths from variable sets

- **WHEN** the payload declaration is read
- **THEN** root `AGENTS.md` is declared as a fixed path
- **AND** the shipped skills are declared as a variable set targeting `.claude/skills/`

#### Scenario: The declaration distinguishes a retired path from both

- **WHEN** the payload declaration is read
- **THEN** a path jen no longer ships is declared as a retired path
- **AND** nothing is written to it

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

### Requirement: Deletion is the stamp intersected with the shipped payload

A file SHALL be deleted if it carries jen's stamp and is absent from the payload jen currently ships, or if it sits at a declared retired path. These SHALL be the only two grounds for deleting a file, and the stamp SHALL remain the only one that applies to a variable set's members: presence in the shipped payload spares a stamped file, and nothing spares a retired path.

The stamp rule requires no record of what jen wrote previously — the stamps distributed across the files are that record. Retirement is a record of what jen *shipped* previously, which is a statement about jen rather than about any project. jen SHALL NOT persist a manifest, ledger, or other state file in a project for either purpose.

Consequently, removing the stamp from a file transfers ownership of it to the project, and jen SHALL thereafter leave it alone. Removing the stamp SHALL NOT spare a retired path, which never carried one.

#### Scenario: A skill jen no longer ships is removed

- **WHEN** a project holds a stamped `.claude/skills/legacy-stage/SKILL.md` and the current payload does not include `legacy-stage`
- **THEN** jen deletes it

#### Scenario: A skill jen still ships is kept

- **WHEN** a project holds a stamped `.claude/skills/design-task/SKILL.md` and the current payload includes `design-task`
- **THEN** jen overwrites it rather than deleting it

#### Scenario: An unstamped file is never deleted

- **WHEN** a project holds an unstamped `.claude/skills/legacy-stage/SKILL.md` and the current payload does not include `legacy-stage`
- **THEN** jen leaves it untouched

#### Scenario: An unstamped file at a retired path is deleted

- **WHEN** a project holds an unstamped file at a declared retired path
- **THEN** jen deletes it
- **AND** the absence of a stamp does not spare it, because a fixed path never carried one

#### Scenario: No state file is created

- **WHEN** jen has written its payload into a project
- **THEN** no manifest or equivalent state file recording written paths exists

#### Scenario: Removing the stamp claims the file

- **WHEN** a project copies a stage skill to a new name and deletes the stamp from the copy
- **THEN** jen neither overwrites nor deletes that copy on any subsequent run

## REMOVED Requirements

### Requirement: A managed file may carry values resolved from the registry

**Reason**: The scheduled workflow was the only managed file that carried substituted values, and it is deleted. Nothing jen writes has a value to resolve, so the mechanism has no member left — and a declared capability nothing uses reads to the next person as either a defect or a missing file.

**Migration**: Reading the tracker team and project from the registry is unaffected and moves nowhere: the runner does it at startup, from the checkout it was pointed at, which `pipeline-runner` governs. What is removed is resolving a value into a file at the moment jen writes it. Should a managed file need a registry value again, this returns as its own change, sized to whatever that file actually needs.
