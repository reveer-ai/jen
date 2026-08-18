## ADDED Requirements

### Requirement: A stage reads the task's record before it acts

Before doing its work, a stage SHALL read the task's record — its status history, its comments, and its PR with the threads on it.

That record is what tells a stage whether it is resuming an interrupted run, picking up work a later stage routed back and why, what a human has already said about it, and whether the task has been circling the pipeline.

The record SHALL be context and SHALL NOT be a gate. A stage SHALL NOT decline to do its work on account of what it reads there; refusing to dispatch a task belongs to the dispatcher.

#### Scenario: A stage begins work

- **WHEN** any stage starts against a task
- **THEN** it has read the task's status history, comments, and PR threads before producing anything

#### Scenario: The record shows work routed back

- **WHEN** a stage finds the task was moved back to its status by a later stage
- **THEN** it reads why before starting, rather than treating the task as new work

#### Scenario: The record shows a task circling

- **WHEN** a stage finds the task has been routed backward repeatedly
- **THEN** it may say so on the task
- **AND** it still does its work, because stopping the task is not its decision

### Requirement: A stage resumes an interrupted run rather than restarting it

A stage SHALL be re-enterable. A session can be killed at any point, and the task's status is left untouched when it is, so a stage SHALL assume it may be resuming and SHALL establish what a previous run already did before producing more.

A stage SHALL treat a marker that records completion — a checked task, a status command reporting an artifact complete, a file that exists — as a claim rather than as proof, and SHALL check it against the evidence: the commits on the branch, the state of the PR, the threads on it, and the comments on the task. Where a marker and the evidence disagree, the evidence SHALL be what the stage acts on.

This matters because a run is a fresh checkout that is discarded when the run ends. Work that was never committed does not survive the session that produced it, so a marker can outlive the work it claims.

#### Scenario: A stage is re-entered after an interrupted run

- **WHEN** a stage begins against a task already in its own status
- **THEN** it checks for work it has already done before producing more
- **AND** it resumes rather than restarting

#### Scenario: A completion marker has no work behind it

- **WHEN** a stage finds a task marked complete with no commit on the branch implementing it
- **THEN** it treats that work as still to do

#### Scenario: Work exists that no marker records

- **WHEN** a stage finds committed work that the change's own bookkeeping does not reflect
- **THEN** it corrects the bookkeeping rather than redoing the work

### Requirement: Every session ends with a comment on the task

A stage SHALL comment on the task at the end of every session, whatever the outcome — work finished, work stopped early, or work blocked. A stage SHALL NOT finish silently, including when nothing went wrong.

The comment SHALL carry what the stage did, what it decided, where it stopped and why, and what the next stage is picking up. A comment that records only that the stage ran SHALL NOT satisfy this.

This is what makes a completed run distinguishable from a crashed one. Both leave the task's status untouched, and a stage that ends without advancing the task leaves nothing else behind to tell them apart.

#### Scenario: A stage finishes its work

- **WHEN** a stage completes everything it set out to do
- **THEN** it comments on the task saying so before it exits

#### Scenario: A stage stops early

- **WHEN** a stage stops without finishing
- **THEN** it comments with where it stopped and why

#### Scenario: A session is killed mid-run

- **WHEN** a session ends without reaching its own end
- **THEN** no end-of-session comment exists
- **AND** a stage re-entering the task reads that absence as an interrupted run whose markers are unverified

### Requirement: A stage is permitted to run what its instructions require

The permissions a run is granted SHALL cover the commands and tools its stage's instructions tell it to use. A stage instructed to do something the harness denies cannot do its work, and an unattended run has no one to grant the permission when it is asked for.

Permissions that are the same across every project — the version control, git host, and specification tooling the workflow itself uses — SHALL be granted in the assistant configuration jen writes.

Permissions that differ by project or by install SHALL be identified rather than assumed: a project's own typecheck, lint, build, and test commands, which jen cannot know, and the tracker's tooling, whose identifiers differ per install and so cannot be named in shared configuration.

#### Scenario: A stage runs the project's checks

- **WHEN** a stage is instructed to run the project's typecheck, lint, build, or tests
- **THEN** the run is permitted to execute them without asking

#### Scenario: A permission cannot be granted in shared configuration

- **WHEN** a permission's identifier differs per project or per install
- **THEN** it is granted where that difference is known rather than written into configuration shared by every project
