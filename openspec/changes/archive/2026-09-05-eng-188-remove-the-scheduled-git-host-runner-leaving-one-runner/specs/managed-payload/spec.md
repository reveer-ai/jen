## MODIFIED Requirements

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

## REMOVED Requirements

### Requirement: A managed file may carry values resolved from the registry

**Reason**: The scheduled workflow was the only managed file that carried substituted values, and it is deleted. Nothing jen writes has a value to resolve, so the mechanism has no member left — and a declared capability nothing uses reads to the next person as either a defect or a missing file.

**Migration**: Reading the tracker team and project from the registry is unaffected and moves nowhere: the runner does it at startup, from the checkout it was pointed at, which `pipeline-runner` governs. What is removed is resolving a value into a file at the moment jen writes it. Should a managed file need a registry value again, this returns as its own change, sized to whatever that file actually needs.
