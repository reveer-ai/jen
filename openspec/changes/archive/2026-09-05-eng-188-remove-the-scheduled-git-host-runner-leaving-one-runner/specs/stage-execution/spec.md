## MODIFIED Requirements

### Requirement: A run request becomes exactly one stage session

Execution SHALL consume a run request and start one session for it, running the skill the request names under the role the request names. It SHALL exercise no judgment about what to run: the request SHALL be taken as decided, and execution SHALL NOT re-examine the task's status, re-derive its stage, substitute a different skill, or decline a request on the merits.

Execution SHALL know nothing about what produced the request. The same request SHALL execute identically whether the runner jen ships or a runner it does not produced it, so that a difference between runners cannot become a difference in how a stage runs.

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

### Requirement: A terminated run leaves the task as the session left it

Termination SHALL be treated as ordinary operation rather than as a crash. A stopping runner and a cancelled job driving one both terminate their sessions, so a run SHALL expect this and SHALL handle it deterministically.

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
