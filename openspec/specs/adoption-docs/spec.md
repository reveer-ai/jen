# adoption-docs Specification

## Purpose

Defines what the project's documentation must tell someone adopting jen — where the boundary between jen's files and theirs falls, how to get from an empty project to a running pipeline, and what the workflow does not yet do — and requires that the path described has been executed rather than only written.

## Requirements

### Requirement: The published front page addresses the adopter

The repository's `README.md` SHALL document adopting and operating jen. It SHALL NOT be a contributor guide.

The registry publishes `README.md` as the package's front page irrespective of which paths the manifest's `files` field selects, so this file is an adopter's first contact with the project whether or not it was written for them.

#### Scenario: The package page documents adoption

- **WHEN** the published package's front page is read
- **THEN** it describes installing jen and running the workflow
- **AND** it does not lead with instructions for building or packaging jen itself

#### Scenario: Documentation reaches the registry without being selected

- **WHEN** the published tarball is inspected
- **THEN** `README.md` is present, though `files` names only the build output

### Requirement: The ownership boundary is stated before the instructions

The adopter's documentation SHALL state which files jen owns and overwrites and which the project owns, and SHALL state it ahead of the installation steps.

An adopter who hand-edits a managed file loses that edit on the next update. Discovering the boundary after the loss is the failure this ordering exists to prevent, so the boundary SHALL NOT be relegated to a later section, a footnote, or a reference to the specifications.

The statement SHALL cover, at minimum: that root `AGENTS.md` and the shipped skills are jen's and are replaced wholesale; that `registry.yaml` and the assistant settings are written once and never touched again; that everything else — the project's sources, its specs, and any skill it authors — is the project's; and what the ownership stamp does, which is to mark a file as jen's to *remove* rather than to decide whether it is overwritten.

The documentation SHALL NOT present removing the stamp as a way to keep an edit to a skill jen currently ships. It does not: the payload is written to its declared paths unconditionally, and the next update restores both the file and its stamp. Stating otherwise would tell an adopter their edit is safe in exactly the case where it is lost.

#### Scenario: The boundary precedes the install instructions

- **WHEN** the adopter's documentation is read from the top
- **THEN** the ownership boundary appears before the installation command

#### Scenario: An adopter checks whether an edit will survive

- **WHEN** an adopter wants to know whether editing a shipped skill is safe
- **THEN** the documentation states that the file is jen's and that an update replaces it
- **AND** it states that removing the stamp does not prevent that
- **AND** it names authoring a separate skill as the way to hold code the update will not touch

#### Scenario: An adopter learns what the stamp actually governs

- **WHEN** the documentation describes the ownership stamp
- **THEN** it states that a stamped file jen no longer ships is deleted on update
- **AND** that removing the stamp from such a file keeps it
- **AND** that a file jen never shipped is left alone whether or not it is stamped

### Requirement: The adoption path is documented end to end

The documentation SHALL carry the complete path from an unadopted project to a running pipeline: installing the package, running `jen init`, running the binding skill, and running `jen update` to take a later version.

Each step SHALL be given as the command an adopter runs. The documentation SHALL distinguish the steps the CLI performs from the step that requires a conversation with the user, since binding is a skill rather than a subcommand and no command will perform it.

#### Scenario: An adopter reaches a bound project

- **WHEN** an adopter follows the documented path in order
- **THEN** the payload is installed, the project is bound to its tracker, and the pipeline can be driven

#### Scenario: Binding is identified as the user's step

- **WHEN** the documentation describes reaching a bound project
- **THEN** it names the binding skill as a step the user invokes
- **AND** it does not present binding as something installation performed

#### Scenario: Taking a later version is documented

- **WHEN** an adopter on an earlier version wants the current one
- **THEN** the documentation names the command that refreshes the managed files and removes those jen no longer ships

### Requirement: The documented path has been executed

Before the documentation is published, the path it describes SHALL have been run end to end against a project that did not previously hold jen — installing the package as an adopter installs it, initializing, binding, editing a managed file, and updating — and the documentation SHALL be corrected from what that run actually did.

The run SHALL exercise the published artifact rather than the working tree: installing from a packed tarball or the registry, so that staging, the manifest's file selection, and dependency resolution are all exercised as an adopter meets them.

Documentation that has not been executed SHALL NOT be treated as satisfying this capability.

#### Scenario: The path is run before publication

- **WHEN** the adopter's documentation is published
- **THEN** every command in it has been run against a project that did not previously hold jen
- **AND** any step that behaved differently from its description has been corrected

#### Scenario: The run uses the packaged artifact

- **WHEN** the adoption path is validated
- **THEN** jen is installed from a tarball or the registry rather than executed from a working tree

### Requirement: Contributor material lives outside the adopter's document

Material addressed to someone changing jen — building, packaging, testing, and the repository's own layout — SHALL live in a document separate from the adopter's, and the adopter's document SHALL link to it rather than carry it.

This SHALL NOT displace the notes convention: a gotcha about a particular part of the code belongs in the `AGENTS.md` nearest it, and the contributor document SHALL NOT restate those notes.

#### Scenario: Build instructions are not on the package page

- **WHEN** the adopter's documentation is read
- **THEN** it does not carry the build, typecheck, packaging, or staging instructions
- **AND** it links to the document that does

#### Scenario: A contributor finds the checks

- **WHEN** someone intending to change jen reads the contributor document
- **THEN** it names the commands CI runs on every pull request

### Requirement: Documentation states which assistants the payload reaches

The documentation SHALL state that jen writes into `.claude/` only, and that support for another assistant is a symlink the project creates from that assistant's directory to the corresponding `.claude/` path — something jen neither creates nor reads.

#### Scenario: An adopter on another assistant learns where they stand

- **WHEN** an adopter using an assistant other than Claude Code reads the documentation
- **THEN** it states that jen writes `.claude/` only
- **AND** it names the symlink as the project's own step

### Requirement: The documentation states what adoption does not yet cover

The documentation SHALL state that jen does not migrate a project that already holds a conflicting managed file, that `jen init` refuses such a project rather than merging into it, and what the option to override that refusal does.

An adopter meeting the refusal SHALL be able to recognize it from the documentation as a stated limit rather than as a malfunction.

#### Scenario: A project holding its own root instructions is warned

- **WHEN** an adopter whose project already carries a root `AGENTS.md` reads the documentation
- **THEN** it states that initialization will refuse the project and that no file will be written
- **AND** it states what overriding the refusal replaces

### Requirement: The documentation states the permissions the pipeline needs granted

The adopter's documentation SHALL state which permissions the pipeline's stages require and which of them the adopter has to grant.

It SHALL state that jen writes the permissions common to every project, and that the project's own typecheck, lint, build, and test commands are not among them, because jen cannot know what they are. Without them the stages that run those checks cannot complete an unattended run.

Because the assistant configuration is written once at installation and owned by the project from then on, jen SHALL NOT be presented as able to add these later. The documentation is what reaches an install that already exists.

#### Scenario: An adopter prepares a project for unattended runs

- **WHEN** the adopter's documentation is read
- **THEN** it names the project's own check commands as permissions the adopter must add
- **AND** it says what fails if they are not granted

#### Scenario: An existing install predates the guidance

- **WHEN** a project was installed before this guidance existed
- **THEN** the documentation tells the adopter to edit the configuration themselves
- **AND** does not suggest that an update will add the permissions for them
