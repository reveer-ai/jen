# stage-conventions Specification

## Purpose

Fixes the rules every stage obeys and none of them owns — how a task's branch and change are named, the single PR that carries it end to end, how a finalized artifact reaches the task, what belongs in a description versus a comment, commit format, thread etiquette, and where a stage records what it learned — so that they are stated once rather than six times.

## Requirements

### Requirement: A stage takes a task as its input

Every stage SHALL act on one task, given directly or inferred from context. A stage that cannot determine which task it is acting on SHALL ask rather than guess.

#### Scenario: The task is not stated

- **WHEN** a stage is invoked without a task and the context does not make one unambiguous
- **THEN** the stage asks which task it is acting on

### Requirement: The branch and the change name derive from the issue's suggested branch name

A task's git branch SHALL be the issue's project-management-suggested branch name verbatim, so the integration that links branch and PR back to the issue matches it.

The task's OpenSpec change name SHALL be that same string lowercased, with any leading `<username>/` segment stripped. OpenSpec requires a lowercase name, and a slash left in the name nests the change directory a level deeper and breaks every `--change` lookup against it.

#### Scenario: A branch is created for a task

- **WHEN** a stage creates the task's branch
- **THEN** the branch name is exactly the name the issue supplies
- **AND** the branch and any PR on it link back to the issue automatically

#### Scenario: A suggested name carries a username prefix

- **WHEN** the issue supplies `josh/ENG-135-implement-workflow`
- **THEN** the branch is `josh/ENG-135-implement-workflow`
- **AND** the change name is `eng-135-implement-workflow`

#### Scenario: A change is looked up by name

- **WHEN** a stage runs an OpenSpec command against the change
- **THEN** the change resolves at a single directory level under `openspec/changes/`

### Requirement: One branch and one PR carry a task end to end

Each task SHALL have exactly one branch and exactly one PR. The PR SHALL be opened as a draft during design, holding the OpenSpec artifacts; implementation, review fixes, and testing fixes SHALL land on that same PR; merging it SHALL be the pipeline's last act and what closes the task out.

A stage SHALL update the existing PR and SHALL NOT open a second one for the same task. Because project-management tooling can read, comment on, review, and merge a PR but not create one, opening it SHALL be done with the git host's own client.

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

### Requirement: Finalized artifacts are attached to the task

Each artifact SHALL be uploaded to the task as a file attachment once it is finalized, titled with the artifact's name. A draft in progress SHALL NOT be uploaded.

Artifacts SHALL be uploaded one at a time, because the signed upload URL expires within a minute and preparing several up front expires the earliest.

There is no update operation for an attachment. A stage that revises an already-finalized artifact SHALL delete the stale attachment and upload the replacement within the same run, so that exactly one copy of each artifact exists on the task and that copy is current. Once the change is archived the task is the durable record of what shipped, and a stale attachment misrepresents it.

#### Scenario: An artifact is finalized

- **WHEN** a stage finalizes an artifact
- **THEN** the artifact is uploaded to the task as an attachment titled with its name

#### Scenario: Several artifacts are finalized in one run

- **WHEN** more than one artifact is ready to upload
- **THEN** each is prepared and uploaded before the next is prepared

#### Scenario: A finalized artifact is revised

- **WHEN** a stage revises an artifact that was already attached
- **THEN** the stale attachment is deleted and the replacement uploaded in the same run
- **AND** the task carries exactly one copy of that artifact

### Requirement: The issue's description is the humans', and comments carry the narrative

No stage SHALL overwrite a task's description. It holds the original ask, which is what the artifacts answer.

Comments SHALL carry the running narrative of the work — blockers, handoffs, and anything needing a person.

#### Scenario: A stage has something to record on the task

- **WHEN** a stage needs to record a blocker or a handoff
- **THEN** it comments on the issue
- **AND** the description is left as its author wrote it

#### Scenario: An artifact answers the original ask

- **WHEN** the proposal is finalized
- **THEN** it is attached to the task rather than written over the description

### Requirement: Commits lead with the issue identifier and are pushed before handoff

Every commit SHALL begin with the task's issue identifier, as in `ENG-135: add resource loader`.

A stage that writes files SHALL commit and push them before handing off to the next stage.

#### Scenario: A stage commits its work

- **WHEN** a stage commits
- **THEN** the message begins with the issue identifier

#### Scenario: A stage hands off

- **WHEN** a stage moves the task to the next status
- **THEN** everything it wrote is already committed and pushed

### Requirement: A review thread is answered only after its fix is pushed

A stage SHALL push the fix for a review thread before replying to that thread and resolving it. A thread SHALL NOT be resolved against unpushed work, because doing so tells the reviewer something untrue.

#### Scenario: A review comment is addressed

- **WHEN** a stage has written the fix for a thread
- **THEN** the fix is pushed first
- **AND** only then is the thread replied to and resolved

### Requirement: A stage records what it learned beside the code it applies to

A convention a change establishes, or a gotcha a future session would otherwise rediscover the hard way, SHALL be written down by the stage that learned it, at the point it learned it, so that it rides in the change's own diff and is reviewed and tested along with everything else.

A stage SHALL write nothing when nothing clears the bar. A note nobody needed is worse than no note.

#### Scenario: A stage establishes a convention

- **WHEN** implementation settles a convention future work will need to follow
- **THEN** the stage records it in the same change, beside the code it applies to

#### Scenario: A stage learns a gotcha late in the pipeline

- **WHEN** testing discovers something expensive that only surfaces when the change is exercised
- **THEN** the stage records it rather than leaving it for the next session to rediscover

#### Scenario: A run turns up nothing worth recording

- **WHEN** a stage finishes and has learned nothing that clears the bar
- **THEN** it writes no note

