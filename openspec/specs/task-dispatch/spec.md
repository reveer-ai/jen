# task-dispatch Specification

## Purpose

Defines how the pipeline decides what to run: a single poll-map-gate pass over the tracker that turns tasks sitting in a stage's status into run requests, and the boundaries that keep that decision cheap, repeatable, and identical under every runner.

## Requirements

### Requirement: `jen run` is one tick

`jen run` SHALL perform a single tick — poll the tracker, map each issue to a stage, gate each candidate, and report what it decided — and SHALL then launch a stage session for each candidate that passed, see those sessions through, and exit. It SHALL NOT loop, sleep, or schedule.

The **tick** SHALL name the deciding pass, and the command SHALL name the tick together with the execution that follows it. The two SHALL be separable, and the requirements below that constrain the tick SHALL constrain the deciding pass rather than the command as a whole.

`jen run` SHALL wait for the sessions it launched rather than exiting once they are started. A command that launches sessions and exits immediately orphans them: the runner driving it ends, taking down the very sessions it started, and no process remains that is responsible for them or able to receive a termination signal on their behalf. Waiting on launched work SHALL NOT be read as looping — the pass happens once, and the command exits when what it started has finished.

Driving the tick on an interval SHALL belong to the runner invoking it, and every runner SHALL invoke this same entry point rather than carrying its own poll or its own gate. A runner SHALL NOT hold pipeline state that another runner cannot see.

#### Scenario: A tick runs

- **WHEN** `jen run` is invoked
- **THEN** it polls once, decides, launches the candidates that passed the gate, and exits once those sessions have finished
- **AND** it polls no second time, however long they took

#### Scenario: A second runner is added

- **WHEN** a runner other than the ones jen ships drives the pipeline
- **THEN** it drives it by invoking this same entry point
- **AND** no decision about what to run is reimplemented in the runner

#### Scenario: A session is still running when the decision is done

- **WHEN** the deciding pass has finished and a session it launched is still working
- **THEN** the command stays alive until that session finishes
- **AND** no session is left running with no process responsible for it

### Requirement: The tick writes nothing

The tick SHALL be free of side effects on the tracker, the git host, and the filesystem. It SHALL read, decide, and report, and SHALL NOT comment, move a status, set a field, create a branch, or write a file. This SHALL remain a property of the deciding pass even though the command that performs it goes on to act, and deciding SHALL be runnable on its own so the property can be observed rather than asserted.

Every tracker write in the pipeline SHALL belong to a stage session. This SHALL include the comment that marks a task as taken, which the session SHALL write on its own behalf once it is running rather than the tick writing it in advance. Launching a session SHALL NOT be treated as an exception to this: whatever the session then writes is the session's own, and the code that launched it SHALL write nothing to the tracker itself — not for a session that failed, and not for one that was terminated.

A consequence SHALL be accepted rather than compensated for: a session that dies between being launched and announcing itself leaves no evidence it was started, and the next tick dispatches that task again.

#### Scenario: A tick decides not to dispatch

- **WHEN** a tick examines a task and gates it out
- **THEN** nothing about that task changes on the tracker

#### Scenario: A tick dispatches

- **WHEN** a tick dispatches a task and a session is launched for it
- **THEN** the task is unchanged on the tracker at the moment the session starts
- **AND** what marks it as taken is written by the session itself

#### Scenario: A session fails or is terminated

- **WHEN** a launched session exits without having reported an outcome
- **THEN** nothing writes to the tracker on that session's behalf
- **AND** the task is left exactly as the session left it

#### Scenario: A tick is run twice in succession

- **WHEN** the deciding pass is run twice with no session having started in between
- **THEN** the second sees exactly what the first saw
- **AND** neither has altered the state the other reads

### Requirement: A candidate is a task, and it is in a status that maps to a stage

An issue SHALL be a candidate when it carries the `task` label **and** its status is one that maps to a stage. Both SHALL be required. The tick SHALL NOT consult a queue, a run record, a pipeline-position field, or the task's transition history to decide either.

The label SHALL be an allow list, on the same principle as the statuses: an issue that does not carry it SHALL never be dispatched, whatever else it carries. An epic sits in a stage's status as a matter of course — it is the parent of tasks that are themselves moving through the pipeline — and it has no design, no change, and no PR, so a stage dispatched against one spends a whole session establishing there is nothing to do. An issue nobody has refined is in the same position for the same reason.

The label SHALL be tested by the tick rather than expressed in the poll's filter, so that an issue sitting in a stage's status without it is fetched, declined, and named in the report. Filtering it away server-side would be cheaper and would make the decline invisible: a person who moved an issue into a stage's status and saw nothing happen would have nowhere to find out why, and silence about it is indistinguishable from a pipeline with nothing to do.

`Todo` and `Pending` SHALL never be candidates. Moving a task out of either is the user's decision, and no stage and no dispatcher makes it. Statuses outside the pipeline SHALL likewise never be candidates.

#### Scenario: A task sits in a stage's status

- **WHEN** an issue labelled `task` has status `In Progress`
- **THEN** it is a candidate for the stage that status maps to

#### Scenario: An epic sits in a stage's status

- **WHEN** an issue labelled `epic` has status `In Progress`
- **THEN** it is not a candidate
- **AND** no run request is emitted for it
- **AND** the report names it and why it was declined

#### Scenario: An unrefined issue is moved into the pipeline

- **WHEN** an issue carrying neither the `task` nor the `epic` label is moved into `In Design`
- **THEN** it is not a candidate
- **AND** the report names it and why it was declined

#### Scenario: A task awaits a human

- **WHEN** a task's status is `Pending`
- **THEN** it is not a candidate
- **AND** nothing about it is dispatched however long it stays there

#### Scenario: A task is refined but not started

- **WHEN** a task's status is `Todo`
- **THEN** it is not a candidate

### Requirement: Status maps to a skill and a role by a fixed table, without judgment

The tick SHALL map a candidate's status to the skill that stage runs and to the identity role that stage acts under, from a table compiled into the dispatcher. The mapping SHALL match the stage table the workflow document states.

The dispatch path SHALL make no model call and SHALL exercise no judgment. Every decision it makes SHALL be a lookup or a comparison, so that two ticks over identical tracker state reach identical conclusions.

The role SHALL be resolved by the tick rather than by the session, because a session that could choose its own role could choose the one that lets it approve its own work.

#### Scenario: A candidate is mapped

- **WHEN** a task in `In Review` is mapped
- **THEN** the run request names the reviewing stage's skill
- **AND** it names the role that stage acts under

#### Scenario: The mapping is exercised

- **WHEN** the tick maps any candidate
- **THEN** no model is consulted
- **AND** the same status always produces the same skill and the same role

### Requirement: A task a session is already working is not a candidate

The tick SHALL treat a task as in flight when the most recent marked comment on the task is a session announcement with no later marked outcome, and SHALL NOT emit a run request for it. It SHALL NOT compare the announcement's stage with the task's current stage: a session may move the status before writing its closing outcome, and the still-open announcement from the prior stage SHALL keep the next stage from starting during that handoff. A task's status alone SHALL NOT be taken as evidence that nothing is working it, because the status stays actionable until the stage moves it.

The announcement SHALL be read from the task's own record so that every runner reaches the same conclusion from the same evidence. A runner's memory of what it launched SHALL NOT be the state consulted, and SHALL be at most a cache of it.

Which announcement is the most recent SHALL be established from the timestamps the tick reads, and SHALL NOT rest on the order the tracker happens to return them in. Where the tick reads a bounded page of a task's record, it SHALL establish from that page whether the page holds the most recent entries, and SHALL read further where it cannot. A bounded page taken on trust is the failure that matters here: if it holds the oldest entries rather than the newest, every announcement is behind the bound, the task reads as never announced, and it is dispatched on every tick forever.

An announcement SHALL NOT expire. A task in a stage's status whose session announced itself and never reported an outcome SHALL remain undispatched until a human moves it, which is what makes a stage that fails deterministically fail once rather than on every tick.

#### Scenario: A session is running

- **WHEN** a tick examines a task whose session has announced itself and not yet reported
- **THEN** no run request is emitted for it

#### Scenario: A later tick sees a run emitted by an earlier tick

- **WHEN** one tick emits a run and that session announces itself before another tick examines the same task
- **THEN** the later tick reads the announcement from the task
- **AND** it emits no second run for it

#### Scenario: Two runners examine the same unannounced snapshot

- **WHEN** two runners examine the same task before either emitted session has announced itself
- **THEN** each tick may emit a run for the task from that same marker-free snapshot
- **AND** this dispatch-to-announcement overlap is accepted rather than serialized by shared state

#### Scenario: A session died without reporting

- **WHEN** a task carries an announcement whose session ended without moving the status or reporting an outcome
- **THEN** later ticks continue to treat it as in flight
- **AND** it is dispatched again only after a human moves its status

#### Scenario: The record is longer than one page

- **WHEN** a task has accumulated more entries since its last session than one page holds
- **THEN** the tick still establishes the most recent announcement
- **AND** it does so whichever order the tracker returned the page in

#### Scenario: The record is longer than the tick will read

- **WHEN** a task's record runs past the pages one tick reads for a single task
- **THEN** the tick declines it and reports that whether a session is working it is unproven
- **AND** it does not dispatch, because a record it could not finish reading is not evidence that nothing is working the task

#### Scenario: A task re-enters a stage it was in before

- **WHEN** a task is moved back into a status a session previously announced itself against
- **THEN** the earlier announcement does not make it in flight
- **AND** it is a candidate again

### Requirement: Simultaneous runs are capped

The tick SHALL enforce a ceiling on how many runs are in flight in the tracker snapshot it observes plus the run requests it emits, and SHALL emit no run request that would exceed that ceiling within one tick. It SHALL never emit two run requests for the same task in one tick.

The count SHALL be derived from the same announcements that establish in-flight state, so later ticks driven by any runner share the ceiling represented in the tracker rather than relying on runner-local memory. The tick SHALL NOT claim to serialize overlapping runners: two ticks that observe the same snapshot before either emitted session announces may each spend up to the cap.

#### Scenario: The ceiling is reached

- **WHEN** the number of tasks in flight equals the cap
- **THEN** the tick emits no further run requests
- **AND** the candidates it declined are unchanged and will be seen again next tick

#### Scenario: A later runner shares the observed ceiling

- **WHEN** a runner ticks after sessions emitted by another runner have announced themselves
- **THEN** it counts those announcements against the same cap

#### Scenario: Two runners overlap before announcements

- **WHEN** two runners tick against one project before either emitted session has announced itself
- **THEN** each enforces the cap against its own identical observed snapshot and emitted requests
- **AND** their combined emissions may temporarily exceed the cap

### Requirement: The tick reports what it decided, in a form a person can read

A tick SHALL report every candidate it considered and what it decided about each — dispatched, or declined with the reason. It SHALL also report every issue it declined for not being a task, so that the report accounts for everything sitting in a stage's status rather than only for what was eligible. A run request SHALL be emitted in a form both a person and a consuming executor can read.

Answering what the pipeline would do at that moment SHALL remain possible without doing it, and SHALL NOT require that anything consume the tick's output.

#### Scenario: A tick with nothing to do

- **WHEN** no candidate passes the gate
- **THEN** the tick reports each candidate and why it was declined
- **AND** exits successfully

#### Scenario: An issue in a stage's status is not a task

- **WHEN** a tick sees an issue in a stage's status that carries no `task` label
- **THEN** the report names it and says it was declined for not being a task
- **AND** nothing about it is dispatched

#### Scenario: A bounded read did not reach everything

- **WHEN** more issues sit in a stage's status than the tick's page bound reads
- **THEN** the report says the remainder was not examined
- **AND** it does not pass over them in silence, which would be indistinguishable from a pipeline with nothing to do

#### Scenario: A tick is run by hand

- **WHEN** a person invokes the command asking it to decide without acting
- **THEN** its report is readable on its own
- **AND** nothing has been changed by having run it

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

### Requirement: Credentials resolve from the environment, and a missing one refuses the tick

The tick SHALL read every credential it needs from its environment at the point of use. It SHALL NOT read one from a file, SHALL NOT write one to disk, and SHALL NOT keep one after the process exits.

When a credential the tick requires is absent, it SHALL refuse to run and SHALL name which one is missing, rather than polling far enough to fail partway through.

#### Scenario: The tick runs with its credentials present

- **WHEN** a tick begins with the tracker credential in its environment
- **THEN** it reads it from there
- **AND** consults no file for it

#### Scenario: A credential is absent

- **WHEN** a tick begins without the tracker credential
- **THEN** it refuses to run
- **AND** names the missing credential

#### Scenario: The host is inspected after a tick

- **WHEN** a tick has finished
- **THEN** no credential it used remains anywhere on the host

### Requirement: A tick refuses a project the pipeline cannot park a task in

The tick SHALL verify at startup that the tracker team carries the `Pending` status, and SHALL refuse to run when it does not, naming what is missing.

A project without it has stages that can pick a task up and then have nowhere to put it when they need a human — the task would be left in a stage status, which the pipeline reads as a session still working it. Refusing the tick is the cheaper failure, and it fails before any session is started rather than partway through one.

#### Scenario: The tracker lacks `Pending`

- **WHEN** a tick begins against a team carrying no `Pending` status
- **THEN** it refuses to run
- **AND** names `Pending` as missing
- **AND** dispatches nothing

#### Scenario: The tracker carries `Pending`

- **WHEN** a tick begins against a team carrying the status
- **THEN** the check passes and the tick proceeds to poll

### Requirement: The tick receives its project identity and discovers nothing

The tracker team and project the tick acts on SHALL be supplied to it as explicit input. The tick SHALL NOT read the registry or any other file to find them, and SHALL NOT call an API to infer them.

Resolving them SHALL belong to the runner, which SHALL be free to do it however suits it. This keeps a difference between runners inside the wrapper, where it is harmless, rather than inside the tick, where it would be the divergence a single shared entry point exists to prevent.

#### Scenario: A tick is invoked

- **WHEN** `jen run` runs
- **THEN** the team and project reached it as input
- **AND** it read no file to obtain them

#### Scenario: A runner resolves the project

- **WHEN** a runner running inside a checkout determines which project to act on
- **THEN** it may read the registry to do so
- **AND** it passes the values into the tick rather than letting the tick read them

#### Scenario: The project identity is absent

- **WHEN** a tick is invoked without being told which team and project to act on
- **THEN** it refuses to run rather than guessing

### Requirement: Deciding is invocable without acting

The command SHALL offer a way to perform the tick and stop there — reporting every decision and launching nothing. Acting SHALL be the default and declining to act SHALL be the flagged case, because running the pipeline is the ordinary invocation and inspecting it is the exception.

Invoked this way, the command SHALL leave the tracker, the git host, and the filesystem untouched, and SHALL reach the same decisions it would have reached had it gone on to act. It SHALL NOT be a separate code path that could decide differently from the one that runs unattended: a preview that does not predict is worse than no preview, because it is trusted.

#### Scenario: The pipeline is inspected before it is trusted

- **WHEN** an operator asks the command to decide without acting
- **THEN** it reports what it would dispatch and what it declined, with reasons
- **AND** no session is launched, no repository is cloned, and nothing is written anywhere

#### Scenario: The preview matches the run

- **WHEN** the command decides without acting and is then invoked normally against unchanged tracker state
- **THEN** the second invocation dispatches exactly what the first said it would

#### Scenario: The default is to act

- **WHEN** the command is invoked with no flag asking it to hold back
- **THEN** it launches the sessions it dispatched

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
