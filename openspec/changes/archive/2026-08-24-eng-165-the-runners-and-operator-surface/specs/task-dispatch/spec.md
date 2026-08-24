## ADDED Requirements

### Requirement: A paused project halts dispatch

The tick SHALL read the tracker project's own status before it polls, and SHALL halt without dispatching when that status means the project is not being worked. It SHALL report which status it found and SHALL launch nothing.

Two kinds of status SHALL halt, distinguished by whose name the status is.

A status the workspace named SHALL be identified by its **type**, so that a workspace which has renamed or added statuses is still understood by the category the tracker files it under. The types that halt SHALL be completed and cancelled. They SHALL be named individually rather than expressed as "anything but active" — a project that sits in a backlog or planning status while its tasks move is ordinary, and halting on it would stop a working pipeline silently.

The pause SHALL be a status the pipeline prescribes and SHALL be identified by its **name**, matched as every other status the pipeline names is matched: trimmed and case-folded, and nothing further. It SHALL be filed under the tracker's in-progress category, which every working project shares and which therefore SHALL NOT halt on its own. Identifying it by name is what the prescription buys: the category can carry no signal, and the alternative — filing a pause under a completed or cancelled category so that the type could carry it — would make the tracker assert that a live project is finished or abandoned.

It follows that renaming the prescribed status disables the halt. This SHALL be documented where an operator creating it will read it, because the failure is silent and is discovered only when the halt is reached for.

This SHALL be the pipeline's halt: it stops dispatch without deleting a schedule, stopping a runner, or editing any task's status, and it is reached from the tracker, which is the one place every runner already looks. Every runner SHALL therefore honour it with nothing added to any of them, and un-pausing SHALL resume the pipeline with no runner restarted and no configuration changed.

A halt SHALL leave every task exactly where it is. Sessions already running SHALL NOT be stopped by it — the halt governs dispatch, and a session that has announced itself owns its task until it reports.

#### Scenario: The project is paused

- **WHEN** a tick begins against a project carrying the prescribed pause status
- **THEN** it halts before polling
- **AND** it reports the status it found by name
- **AND** nothing is dispatched

#### Scenario: The pause status is filed under the in-progress category

- **WHEN** the prescribed pause status's type is the one ordinary working projects carry
- **THEN** the tick still halts on it
- **AND** a project carrying any other status of that same type dispatches normally

#### Scenario: The pause is lifted

- **WHEN** the project's status is moved back to an active one
- **THEN** the next tick polls and dispatches normally
- **AND** no runner was restarted and no configuration was changed

#### Scenario: A project in a backlog status

- **WHEN** a tick begins against a project whose status type is backlog or planned
- **THEN** it polls and dispatches normally

#### Scenario: A completed or cancelled project

- **WHEN** a tick begins against a project whose status type is completed or cancelled
- **THEN** it halts before polling, whatever that status is named

#### Scenario: The prescribed pause status has been renamed

- **WHEN** a workspace renames the prescribed pause status
- **THEN** the tick no longer halts on it
- **AND** the project dispatches as though it were not paused

#### Scenario: A session is running when the project is paused

- **WHEN** a project is paused while a session it dispatched is still working
- **THEN** that session is not interrupted
- **AND** no further task is dispatched

### Requirement: The project the tick polls is resolved unambiguously

The tick SHALL resolve the tracker project it was told to act on to exactly one project, and SHALL refuse when the name it was given matches more than one.

Matching a project by name and reading whatever comes back cannot tell one project from two sharing a name, and the failure is silent in the direction that matters: issues from an unrelated project are polled, mapped, and dispatched as though they belonged to the pipeline. Refusing names the ambiguity where nothing else would surface it.

#### Scenario: One project matches

- **WHEN** the name the tick was given matches exactly one project
- **THEN** it polls that project

#### Scenario: Two projects share the name

- **WHEN** the name matches more than one project
- **THEN** the tick refuses, names the ambiguity, and dispatches nothing

#### Scenario: No project matches

- **WHEN** the name matches no project
- **THEN** the tick refuses rather than polling nothing and reporting a quiet pipeline

### Requirement: Every finished dispatch is reported as a run record

For each session it saw through, the command SHALL emit a run record naming the task, the stage's skill, the role it acted under, whether it succeeded, what the session reported it cost where it reported one, the session's own identifier where there is one, whether it was stopped rather than finished, and whether its session started at all. Where a transcript was kept, the record SHALL name where it went; where none was kept, the record SHALL say so rather than leaving it unstated.

The record SHALL be emitted in a form both a person and a consuming program can read, on the same stream as run requests, so that recording what the pipeline did requires nothing of either runner and reads identically under both. The human-readable report SHALL carry each run's cost beside its outcome.

A run record SHALL NOT carry a credential, on the same terms as a run request: it may be logged, printed, or passed between processes.

Emitting a record SHALL NOT be a tracker write and SHALL NOT be read as one. Nothing about the record SHALL reach the task; what a stage did to its task is the session's own to report.

#### Scenario: A session finishes

- **WHEN** a dispatched session ends
- **THEN** a run record is emitted naming the task, skill, role, outcome, cost, and session identifier
- **AND** it says whether a transcript was kept and where

#### Scenario: A session reported no cost

- **WHEN** a session ends without reporting what it cost
- **THEN** the record is still emitted
- **AND** the absence of a cost is distinguishable from a cost of zero

#### Scenario: A record is consumed

- **WHEN** the command's output is piped to a program that records what the pipeline did
- **THEN** run requests and run records are distinguishable from one another
- **AND** neither carries a credential

#### Scenario: The same output under either runner

- **WHEN** the same dispatch happens under the scheduled runner and under the local one
- **THEN** the run record is the same
- **AND** neither runner added anything to produce it

## MODIFIED Requirements

### Requirement: A run request names everything the executor needs and nothing it must decide

A run request SHALL carry the task it is for, the stage's skill, the role that stage acts under, and the task's branch name as the tracker supplies it.

It SHALL NOT carry a credential. Resolving the role's credential SHALL belong to whatever launches the session, so that a run request may be logged, printed, or passed between processes without carrying a secret.

A run request SHALL identify itself as one. It shares its output stream with the run record emitted when that session finishes, and a consumer that cannot tell the two apart cannot record either reliably. Every kind of object the command emits on that stream SHALL therefore say which kind it is.

#### Scenario: A run request is emitted

- **WHEN** the tick emits a run request
- **THEN** it names the task, the skill, the role, and the branch
- **AND** it identifies itself as a run request rather than as any other kind of emitted object

#### Scenario: A run request is recorded

- **WHEN** a run request is written to a log or printed
- **THEN** it contains no credential
