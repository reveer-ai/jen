## MODIFIED Requirements

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

## ADDED Requirements

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
