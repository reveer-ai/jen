## MODIFIED Requirements

### Requirement: The documentation says how autonomy is turned on, and what it does once it is

The adopter's documentation SHALL carry the step from an installed, bound project to one that acts on its own: which runner to choose, what each runner requires configured, and how to start it.

The runners SHALL be presented as peers. The documentation SHALL give the grounds on which an adopter chooses between them rather than naming one as the default, and SHALL state plainly that choosing the local runner does not remove the git host from the pipeline — pull requests, review verdicts, and the merge gate are the same under both, and so are the registered identities they depend on.

The documentation SHALL state the conditions that come with each runner and are not obvious from choosing it. For the scheduled runner these SHALL include that a git host may disable a schedule on a repository that has been inactive, which is a real failure mode for a pipeline whose ordinary state is quiet, and what an adopter does about it. For the local runner they SHALL include that a session dies with the process that launched it, and what the pipeline then reads on that task.

Where a value a runner needs may be supplied in more than one form, the documentation SHALL name every accepted form and SHALL state what choosing each one costs. Model access is that case: the pipeline runs on an API key or on a subscription token, and the variable names alone answer neither which to use nor what follows from the answer. The documentation SHALL state how the subscription token is obtained, that the subscription's usage limits are shared with the adopter's own interactive use of the same account — so a polling pipeline can exhaust a window they were about to work in, surfacing as a stage dying mid-run rather than as a bill — and that the token is a long-lived personal credential where an API key is scoped and revocable per key. It SHALL state that a runner holds exactly one, and that setting both is refused rather than resolved in the adopter's favour by a precedence.

The alternative spellings of one value SHALL NOT be presented as additional values. The documentation states how many values a runner needs, and an adopter who counts a credential twice looks for a secret they were never meant to store and cannot tell a complete configuration from an incomplete one.

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

#### Scenario: An adopter already pays for a subscription

- **WHEN** an adopter who does not want to fund an API key reads what model access requires
- **THEN** the documentation names the subscription token as an accepted form
- **AND** says how it is obtained

#### Scenario: An adopter weighs the subscription against a key

- **WHEN** an adopter reads what choosing the subscription costs
- **THEN** the documentation states that its usage limits are shared with their own interactive work
- **AND** states that the token is a long-lived personal credential where an API key is revocable per key

#### Scenario: An adopter holds both forms

- **WHEN** an adopter reads what happens if both model credentials are set
- **THEN** the documentation states that the run refuses rather than choosing one

#### Scenario: An adopter counts what they must store

- **WHEN** an adopter reads how many values their runner needs
- **THEN** the two spellings of model access are counted as one value

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
