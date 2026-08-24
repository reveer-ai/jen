## ADDED Requirements

### Requirement: The documentation says how autonomy is turned on, and what it does once it is

The adopter's documentation SHALL carry the step from an installed, bound project to one that acts on its own: which runner to choose, what each runner requires configured, and how to start it.

The runners SHALL be presented as peers. The documentation SHALL give the grounds on which an adopter chooses between them rather than naming one as the default, and SHALL state plainly that choosing the local runner does not remove the git host from the pipeline — pull requests, review verdicts, and the merge gate are the same under both, and so are the registered identities they depend on.

The documentation SHALL state the conditions that come with each runner and are not obvious from choosing it. For the scheduled runner these SHALL include that a git host may disable a schedule on a repository that has been inactive, which is a real failure mode for a pipeline whose ordinary state is quiet, and what an adopter does about it. For the local runner they SHALL include that a session dies with the process that launched it, and what the pipeline then reads on that task.

The documentation SHALL state what the pipeline will do while nobody is watching: which transition a human still owns, that a stage may park a task where a person is needed, and how much may run at once.

It SHALL state how to stop it. The halt SHALL be documented as the tracker's project status, applying under either runner, rather than as stopping a runner or editing task statuses.

Because the status that pauses the pipeline is one the adopter creates, the documentation SHALL name it exactly, SHALL say which category to file it under, and SHALL state that renaming it disables the halt without any other symptom. An adopter who never creates it SHALL be told what they do not have, since a pipeline missing only its halt runs indistinguishably from one that has it.

#### Scenario: An adopter chooses a runner

- **WHEN** an adopter reads the documentation to decide how to run the pipeline
- **THEN** both runners are presented with what distinguishes them
- **AND** neither is presented as the default or the fallback

#### Scenario: An adopter expects the local runner to remove the git host

- **WHEN** an adopter reads about the local runner
- **THEN** the documentation states that the git host identities and the merge gate are still required

#### Scenario: An adopter turns the pipeline on

- **WHEN** an adopter follows the documented steps for their chosen runner
- **THEN** the values and credentials each one needs are named
- **AND** the pipeline polls their project

#### Scenario: An adopter wants it stopped

- **WHEN** an adopter looks for how to halt the pipeline
- **THEN** the documentation names the project status that halts dispatch
- **AND** says where to create it and which category it belongs under
- **AND** does not require deleting a schedule or editing task statuses

#### Scenario: An adopter reads what the halt costs

- **WHEN** an adopter reads how the pause status is matched
- **THEN** the documentation states that renaming it turns the halt off silently

#### Scenario: A quiet pipeline is disabled by the git host

- **WHEN** an adopter's scheduled runner has been disabled for inactivity
- **THEN** the documentation has already named that this can happen
- **AND** says how to re-enable it

## MODIFIED Requirements

### Requirement: The ownership boundary is stated before the instructions

The adopter's documentation SHALL state which files jen owns and overwrites and which the project owns, and SHALL state it ahead of the installation steps.

An adopter who hand-edits a managed file loses that edit on the next update. Discovering the boundary after the loss is the failure this ordering exists to prevent, so the boundary SHALL NOT be relegated to a later section, a footnote, or a reference to the specifications.

The statement SHALL cover, at minimum: that root `AGENTS.md` and the shipped skills are jen's and are replaced wholesale; that the pipeline's scheduled workflow is jen's on the same terms, and is the one managed file written outside `.claude/` and the repository root; that `registry.yaml` and the assistant settings are written once and never touched again; that everything else — the project's sources, its specs, and any skill it authors — is the project's; and what the ownership stamp does, which is to mark a file as jen's to *remove* rather than to decide whether it is overwritten.

Where a managed file carries values resolved from the registry, the documentation SHALL say so and SHALL name the registry as the place to change them. An adopter who edits the derived file directly loses that edit on the next update, which is the same failure this requirement exists to prevent, reached through a file that reads as configuration.

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

#### Scenario: An adopter wants to change which project the pipeline polls

- **WHEN** an adopter looks for where the scheduled runner's tracker project is set
- **THEN** the documentation names the registry as the place to change it
- **AND** states that editing the workflow file directly is lost on the next update
