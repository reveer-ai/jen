## ADDED Requirements

### Requirement: Pull-request work goes to the git host and task work to the tracker

A stage SHALL act on the pull request through the git host's own client, and on the task through the project-management tracker. Reading the threads on a pull request, anchoring a comment to a line of the diff, replying to a thread, resolving it, recording a review verdict, and merging SHALL all be done against the git host. Status, comments, and artifact attachments SHALL be done against the tracker.

A stage SHALL NOT act on a pull request through the tracker's tooling, even where that tooling exposes the capability. A tracker's view of a pull request is derived from an integration that binds a tracker user to a git-host account, so it is available only to identities that have one; an identity acting as an application has no such account, and its every read of that surface returns empty. The failure is silent — the tooling is offered to every identity regardless, and an empty result is indistinguishable from a pull request with nothing on it — so the division SHALL be held by instruction rather than discovered at runtime.

The issue's suggested branch name is the one value that crosses: it is read from the tracker and used to name the branch, as required by the naming convention.

#### Scenario: A stage reads the threads on a pull request

- **WHEN** a stage needs the review threads on a task's PR and whether each is resolved
- **THEN** it reads them from the git host

#### Scenario: A stage records something on the task

- **WHEN** a stage sets a status, comments, or attaches a finalized artifact
- **THEN** it does so on the tracker

#### Scenario: The pipeline runs under an identity that is not a person's

- **WHEN** a stage acts on a pull request while running as an application rather than as a human user
- **THEN** its reads and writes reach the pull request, because they go to the git host

#### Scenario: A capability is offered on both surfaces

- **WHEN** the tracker's tooling exposes a pull-request operation the git host also offers
- **THEN** the stage uses the git host

### Requirement: A review verdict is recorded as a host review event, and as a comment when the reviewer authored the PR

A stage that reaches a verdict SHALL record it on the git host as a review event — approval, or changes requested — so that it counts toward the host's own merge gate.

A git host MAY refuse a verdict from the pull request's own author. Before choosing the event, a stage SHALL compare the pull request's author to the identity it is authenticated as. Where the comparison reports the same identity, the stage SHALL record the verdict as a plain review comment stating the verdict in its body. Where it reports different identities, the stage SHALL record the real event.

A host MAY NOT report an authenticated identity for every kind of token it accepts, so the comparison MAY be unanswerable. Where it is, the stage SHALL attempt the real event and, if the host refuses it, SHALL record the verdict as a review comment instead. A refusal of that fallback is a failed run and SHALL NOT be recorded as a verdict.

The determination SHALL be made from the author and the authenticated identity, both of which the host reports, and SHALL NOT be made by interpreting the text of a refusal: a refused self-review and a transport failure are indistinguishable from the message alone. Where the comparison is unanswerable, a refusal SHALL trigger the fallback without being interpreted for its cause.

#### Scenario: The reviewer is not the author

- **WHEN** a stage submits a verdict on a pull request opened by a different identity
- **THEN** the verdict is recorded as a review event of the kind the verdict calls for

#### Scenario: The reviewer is the author

- **WHEN** a stage submits a verdict on a pull request whose author the comparison reports as the identity it is authenticated as
- **THEN** the verdict is recorded as a review comment carrying the verdict in its body
- **AND** the stage does not attempt the event the host would refuse

#### Scenario: The authenticated identity cannot be determined

- **WHEN** a stage submits a verdict while holding a token the host reports no identity for
- **THEN** the stage attempts the review event the verdict calls for
- **AND** records the verdict as a review comment if the host refuses that event
- **AND** does not read the refusal for its cause

#### Scenario: A verdict submission fails

- **WHEN** recording a verdict fails
- **THEN** the stage does not infer the cause from the message
- **AND** the run does not treat the verdict as recorded

## MODIFIED Requirements

### Requirement: One branch and one PR carry a task end to end

Each task SHALL have exactly one branch and exactly one PR. The PR SHALL be opened as a draft during design, holding the OpenSpec artifacts; implementation, review fixes, and testing fixes SHALL land on that same PR; merging it SHALL be the pipeline's last act and what closes the task out.

A stage SHALL update the existing PR and SHALL NOT open a second one for the same task. Opening it, and every subsequent act upon it, SHALL be done with the git host's own client.

#### Scenario: Design produces its first artifact

- **WHEN** the first artifact lands on the branch
- **THEN** a draft PR is opened for the task
- **AND** it contains the OpenSpec artifacts and nothing else

#### Scenario: Implementation begins

- **WHEN** implementation starts on a task whose design is complete
- **THEN** its commits land on the task's existing PR
- **AND** no second PR is opened

#### Scenario: Specs and code are reviewed

- **WHEN** the PR is reviewed
- **THEN** the artifacts and the implementation are visible in the same diff

#### Scenario: The task is delivered

- **WHEN** the task's PR is merged
- **THEN** that merge is what closes the task out
