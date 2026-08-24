## ADDED Requirements

### Requirement: Assistant instructions go to `.claude/` and nowhere else

jen SHALL write the instructions it ships — the workflow document and the skills — into `.claude/` and to declared root paths, and into no other assistant's directory. jen SHALL NOT maintain a table of assistant directories, and SHALL NOT write byte-identical copies of a managed file to more than one location.

Support for other assistants is the project's own concern, satisfied by a symlink from that assistant's directory to the corresponding `.claude/` path, which jen neither creates nor reads.

This SHALL constrain where *instructions* go, and SHALL NOT be read as a rule that jen writes nowhere else at all. A managed file that is not an instruction — configuration the project's automation reads — SHALL be declared at the path its consumer requires, because there is no second location it could be written to and no duplication to avoid. Each such path SHALL be declared individually; jen SHALL NOT claim a directory outside `.claude/` wholesale.

#### Scenario: Instructions reach one directory

- **WHEN** jen writes the workflow document and the skills into a project
- **THEN** they are created under `.claude/` and at declared root paths only
- **AND** no `.codex/`, `.cursor/`, or other assistant directory is created or modified

#### Scenario: A symlinked assistant directory receives updates for free

- **WHEN** a project has symlinked another assistant's skills directory to `.claude/skills` and jen overwrites a stage skill
- **THEN** the updated content is visible through the symlink
- **AND** jen performed no additional write to do so

#### Scenario: A declared path outside `.claude/`

- **WHEN** the payload declares the pipeline's scheduled workflow at the path the git host requires
- **THEN** jen writes it there
- **AND** it writes no copy of it anywhere else
- **AND** no other file in that directory is claimed by having declared it

### Requirement: A managed file may carry values resolved from the registry

The payload declaration SHALL be able to mark a managed file as carrying substituted values. Substitution SHALL resolve a closed set of named values, declared as data, and SHALL NOT be a general template language: no conditionals, no loops, no expressions, and no name jen has not declared.

The values SHALL be resolved from the project's registry, which remains the one place the project authors them. Substitution SHALL happen when the file is written, so that a file jen owns can carry a value the project owns without either one editing the other's file.

Resolution SHALL be total. A name that cannot be resolved SHALL be written as empty, and SHALL NOT be left in the output as the placeholder text: a placeholder surviving into a file its consumer reads is a wrong value that looks like a configured one, where an empty value fails the way an absent one does. The run's report SHALL name every value that did not resolve and SHALL say why, so that the state is discoverable at the moment it is created.

Substitution SHALL NOT change what the run writes to. A substituted file is written to its declared target exactly as any other managed file is, is refreshed by an update exactly as any other is, and is subject to the same rules about symlinks and project boundaries.

#### Scenario: A value resolves

- **WHEN** a managed file declares a substituted value and the registry supplies it
- **THEN** the written file carries the registry's value
- **AND** the registry file itself is unchanged

#### Scenario: A value does not resolve

- **WHEN** the registry does not supply a declared value
- **THEN** the written file carries an empty value in its place
- **AND** the placeholder text does not appear in the written file
- **AND** the report names the value that did not resolve

#### Scenario: The registry changes

- **WHEN** the registry is edited and the project is updated
- **THEN** the substituted file is rewritten with the new values

#### Scenario: Substitution is not a template language

- **WHEN** the payload's substitution is examined
- **THEN** it resolves only names jen has declared
- **AND** nothing in a managed file can express a condition, a loop, or a computation

## REMOVED Requirements

### Requirement: jen writes only to `.claude/`

**Reason**: Narrowed rather than dropped. The rule was written to stop jen fanning byte-identical copies of the same *instructions* into every assistant's directory, and it named `.github/` as an example of one — accurate when the only thing in question was an assistant's skills folder. jen now ships the pipeline's scheduled workflow, which is configuration its consumer reads from a path the git host fixes, not an instruction with alternative homes. Keeping the rule as written would have forbidden the file on the strength of an example rather than of the reason behind it.

**Migration**: Replaced by "Assistant instructions go to `.claude/` and nowhere else", which states the same constraint over the same files and says what it does not cover. Nothing about where instructions are written changes: `.claude/` and declared root paths, one copy each, no directory claimed wholesale. Projects take one new declared path, `.github/workflows/jen.yml`, on their next update.
