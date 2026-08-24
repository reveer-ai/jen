# stage-execution Specification

## Purpose

Defines how a run request becomes a finished stage session: the isolated working copy each run gets and discards, how the stage and its task are named to the session, what makes the session unable to block on a human and able to run the commands its instructions require, the single identity it acts under, and what is known about the run once it ends — including when it was killed.

## Requirements

### Requirement: A run request becomes exactly one stage session

Execution SHALL consume a run request and start one session for it, running the skill the request names under the role the request names. It SHALL exercise no judgment about what to run: the request SHALL be taken as decided, and execution SHALL NOT re-examine the task's status, re-derive its stage, substitute a different skill, or decline a request on the merits.

Execution SHALL know nothing about what produced the request. The same request SHALL execute identically whether a scheduled job or a long-running local process produced it, so that a difference between runners cannot become a difference in how a stage runs.

#### Scenario: A run request is executed

- **WHEN** execution receives a run request
- **THEN** exactly one session is started, for the task the request names
- **AND** it runs the skill the request names, under the role the request names

#### Scenario: The request disagrees with the tracker

- **WHEN** a task's status changes between being dispatched and its session starting
- **THEN** the session still runs the skill the request named
- **AND** execution does not re-decide what should have run

#### Scenario: The same request runs under a different runner

- **WHEN** the same run request is executed by a different runner
- **THEN** the session is started the same way, with the same isolation, permissions, and identity

### Requirement: Each run works in a fresh clone at the task's branch, discarded when it ends

Every run SHALL begin by obtaining its own working copy of the repository at the task's branch, and SHALL discard it when the run ends, by success, failure, or termination.

No two runs SHALL share a working copy, and no run SHALL be able to observe or disturb another's. Nothing SHALL be carried between runs in the working copy: what a run means to keep it SHALL push to the git host or write to the tracker, and anything else SHALL be understood to be lost when the run ends.

A run SHALL NOT depend on the working copy having been used before. Every run SHALL be a first run as far as the working copy is concerned, and any state a run needs established SHALL be established by the run itself.

#### Scenario: A run starts

- **WHEN** a session is launched for a task
- **THEN** it works in a clone of the repository checked out at that task's branch
- **AND** that clone was created for this run

#### Scenario: Two runs are in flight at once

- **WHEN** two sessions run at the same time
- **THEN** neither can read or modify the other's working copy

#### Scenario: A run ends

- **WHEN** a run finishes, by any means
- **THEN** its working copy is removed
- **AND** work it did not push or record on the tracker is gone with it

### Requirement: The stage and its task are both named to the session

A session SHALL be told which skill to run, by name, and which task to run it against. Neither SHALL be left to inference.

The skill SHALL be invoked explicitly rather than selected by matching the session's situation against skill descriptions. Selecting a skill from its description is a judgment, and judgment about what to run belongs to the dispatch decision rather than to a session nobody is watching.

Naming the task SHALL be required rather than preferred. A stage takes its task as input and, where it cannot identify one, is required to ask — and a session that cannot block on a human has no such recourse. A session started without its task named would therefore stop correctly and do nothing, consuming a dispatch and presenting, from outside, as a stage failure.

#### Scenario: A session is started

- **WHEN** a session is launched from a run request
- **THEN** the skill it is to run is named to it explicitly
- **AND** the task it is to act on is named to it

#### Scenario: A skill is not selected by inference

- **WHEN** a session begins
- **THEN** the stage it runs is the one the run request named
- **AND** no skill was chosen by matching its description against the session's context

### Requirement: A run cannot block on a human

A session SHALL be started in a mode that denies it the ability to ask a person a question, and that denial SHALL hold even where a permission rule would otherwise allow the asking. The stage skills state that they never wait on a human; this requirement SHALL make it enforced rather than trusted.

A run SHALL NOT be left waiting on input that cannot arrive. Where a stage needs a person, it SHALL record what it needs and park the task, which the workflow already requires of it, rather than stalling.

#### Scenario: A stage would ask a question

- **WHEN** a session attempts to ask a person a question
- **THEN** it is denied
- **AND** the run does not wait

#### Scenario: A permission rule would allow asking

- **WHEN** a configuration would otherwise permit the asking
- **THEN** the denial still holds

### Requirement: The permissions a run is granted are in force

A run SHALL ensure the permissions granted to its working copy actually apply to the session, rather than assuming that writing them into the working copy is enough. Establishing this SHALL be the invocation's responsibility, because nothing inside a repository can grant trust for a working copy that does not exist until the run creates it.

A project's own grants SHALL be honoured. The permissions a project declares for itself — its typecheck, build, lint, and test commands, which cannot be known in advance — SHALL be in force in a dispatched run exactly as they are in an attended one. An arrangement in which only a fixed, jen-supplied set of permissions can ever apply SHALL NOT be used, because it leaves a project unable to grant its runs the commands its own checks require.

Getting this wrong SHALL be understood as failing late rather than early: the session starts, works, and is denied only when it reaches the first command it believed it was permitted to run, with nobody present to grant it.

#### Scenario: A stage runs a permitted command

- **WHEN** a session runs a command its working copy's configuration grants
- **THEN** it executes
- **AND** no permission is requested from anyone

#### Scenario: A project grants itself a command jen does not ship

- **WHEN** a project has granted a command specific to its own toolchain
- **THEN** a dispatched run may execute that command
- **AND** the grant is in force without jen having known about it

#### Scenario: A working copy has never been used before

- **WHEN** a run's working copy is one nothing has ever run in
- **THEN** its permissions are in force for that run
- **AND** this holds on every run, not only the first

### Requirement: A run loads the workflow's context and confirms it reached the tracker

A session SHALL be started with the workflow document, the skills, the assistant configuration, and the tracker tooling available to it. Where the invocation uses a mode that skips discovering these, it SHALL supply each of them explicitly. A session missing them is not a stage — the instructions defining the stage are exactly what would be absent.

A run SHALL establish that the tracker tooling actually connected, rather than inferring it from the session having started. A tracker connection that fails to initialize SHALL NOT be allowed to pass unnoticed: a session that cannot reach the tracker cannot announce itself, and a task with no announcement is dispatched again by the next tick, so this failure feeds directly back into repeated dispatch.

#### Scenario: A session starts

- **WHEN** a stage session begins
- **THEN** the workflow document, the stage's skill, and the tracker tooling are available to it

#### Scenario: The tracker tooling fails to connect

- **WHEN** a session's tracker connection does not initialize
- **THEN** the run establishes that this happened
- **AND** it is reported rather than left to appear as a session that simply did nothing

### Requirement: A run holds exactly one role's credentials and leaves none behind

A run SHALL be given the credentials of the single role its run request names, resolved from its environment at the point of use. It SHALL NOT be given another role's credentials, and a session SHALL NOT be able to obtain one.

No credential SHALL be written to a file the run leaves behind, committed, or recorded on the tracker, and no credential SHALL remain on the host once the run has ended. Where a credential a run requires is absent, the run SHALL fail before starting the session and SHALL name which one is missing, rather than starting work that cannot be completed.

#### Scenario: A session runs

- **WHEN** a session is started for a run request naming a role
- **THEN** it holds that role's credentials
- **AND** it cannot obtain the credentials of any other role

#### Scenario: A required credential is missing

- **WHEN** a run is to be started without a credential its role requires
- **THEN** no session is started
- **AND** the missing credential is named

#### Scenario: The host is inspected after a run

- **WHEN** a run has ended
- **THEN** no credential it used remains on the host

### Requirement: A run's outcome is established from what the session reported

A run SHALL capture, for each session, whether it succeeded, what it cost, and a record of what it did, and SHALL make these available to whatever records runs.

Success SHALL NOT be concluded from the session's exit status alone. A failure occurring inside a session — an authentication failure being the plain case — is reported in the session's own structured result, and a run that consulted only the exit status could therefore treat a session that did nothing as one that succeeded. The run SHALL treat the session's reported result as authoritative and the exit status as corroboration, so that a failure signalled by either is a failure.

#### Scenario: A session succeeds

- **WHEN** a session completes its stage
- **THEN** the run records that it succeeded, what it cost, and a record of what it did

#### Scenario: A session fails inside itself

- **WHEN** a session fails in a way reported in its result rather than by its exit status
- **THEN** the run records it as a failure

#### Scenario: A session fails by exiting non-zero

- **WHEN** a session exits non-zero
- **THEN** the run records it as a failure

### Requirement: A terminated run leaves the task as the session left it

Termination SHALL be treated as ordinary operation rather than as a crash. A cancelled scheduled job and a stopping local runner both terminate their sessions, so a run SHALL expect this and SHALL handle it deterministically.

On termination a run SHALL let the session stop, SHALL discard its working copy and any state it established for it, and SHALL write nothing to the tracker on the session's behalf. The task SHALL be left carrying the announcement its session wrote and no closing outcome, which is what every later tick reads as a session still working it, and it SHALL remain undispatched until a person moves it.

Closing the announcement for a session that did not close it SHALL NOT be done. A task that can be dispatched again after its session died is a task a deterministically failing stage can be dispatched against repeatedly, and the non-expiring announcement exists precisely so such a stage fails once instead of every tick. It would also place a tracker write outside a stage session, which the dispatch capability prohibits.

#### Scenario: A run is terminated

- **WHEN** a run receives a termination signal
- **THEN** its session stops, its working copy is discarded, and nothing is written to the tracker for it

#### Scenario: The task after a terminated run

- **WHEN** a tick later examines a task whose session was terminated
- **THEN** it reads the task as still being worked
- **AND** dispatches nothing for it until a person moves it

#### Scenario: A scheduled job is cancelled

- **WHEN** the job driving a run is cancelled
- **THEN** the run terminates in this same way
- **AND** leaves no partially cleaned working copy or credential behind

### Requirement: A session's transcript is kept only where the operator asks for it

A run SHALL discard the session's transcript with the rest of the run's working state unless the operator has named a place to keep it. Where one is named, the run SHALL write that session's transcript there and the run's record SHALL name the file.

Keeping one SHALL be the operator's decision rather than jen's default. A transcript is the session's entire stream — the repository's content, every tool result, and whatever the stage read along the way — so a durable copy of it is a disclosure, and jen SHALL NOT make one on an operator's behalf.

Where a transcript is kept, it SHALL be written outside the run's own working directory, which is removed when the run ends. It SHALL NOT be written into the project's checkout, which is discarded, and SHALL NOT be committed or pushed by the run.

A failure to write a transcript SHALL NOT change the session's outcome. It SHALL be reported alongside the run's other failures rather than raised over them, on the same terms as a failed cleanup: the session's own result is what the report exists to carry.

#### Scenario: No location was named

- **WHEN** a run finishes and the operator named no place to keep transcripts
- **THEN** the transcript goes with the run's working state
- **AND** the run's record says no transcript was kept

#### Scenario: A location was named

- **WHEN** a run finishes and the operator named a directory for transcripts
- **THEN** the session's transcript is written there
- **AND** the run's record names the file it was written to

#### Scenario: The transcript outlives the run

- **WHEN** a kept transcript is looked for after the run has ended
- **THEN** it is still there
- **AND** the run's own working directory, with the credentials it held, is gone

#### Scenario: A transcript cannot be written

- **WHEN** the named location cannot be written to
- **THEN** the failure is reported with the run's other failures
- **AND** it does not turn a successful session into a failed one
