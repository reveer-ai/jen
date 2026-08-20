## ADDED Requirements

### Requirement: A stage announces itself on the task before it acts

A stage SHALL comment on the task before producing anything, saying which stage is running and that it has picked the task up. It SHALL do so on its own behalf, once its session is actually running, rather than anything writing the announcement in advance on its behalf.

That announcement SHALL be what marks the task as being worked. The task's status SHALL NOT be read as evidence that nothing is working it, because the status stays actionable until the stage moves it.

A stage re-entering a task it finds already announced SHALL treat the announcement as a claim rather than as proof, exactly as it treats any other completion marker, and SHALL establish from the evidence what a previous run actually did.

#### Scenario: A stage begins

- **WHEN** a session starts against a task
- **THEN** it comments that the stage has picked the task up before it produces anything

#### Scenario: A dispatcher examines a task

- **WHEN** a task in a stage's status carries an announcement from a session that has not reported an outcome
- **THEN** the task is treated as being worked
- **AND** nothing dispatches against it

#### Scenario: A session dies before announcing itself

- **WHEN** a session ends before it comments
- **THEN** the task carries no evidence it was started
- **AND** it is indistinguishable from a task nothing has run against

## MODIFIED Requirements

### Requirement: Every session ends with a comment on the task

A stage SHALL comment on the task at the end of every session, whatever the outcome — work finished, work stopped early, or work blocked. A stage SHALL NOT finish silently, including when nothing went wrong.

The comment SHALL carry what the stage did, what it decided, where it stopped and why, and what the next stage is picking up. A comment that records only that the stage ran SHALL NOT satisfy this.

Together with the announcement a stage opens with, this is what makes a session's record on the task complete: an announcement with no closing comment is a session that died, and the task's status — still the stage's own, since a stage that finishes moves it — says the same thing. The closing comment is also the only thing carrying *why* a task was parked at `Pending`, which the status cannot express.

#### Scenario: A stage finishes its work

- **WHEN** a stage completes everything it set out to do
- **THEN** it comments on the task saying so before it exits

#### Scenario: A stage stops early

- **WHEN** a stage stops without finishing
- **THEN** it comments with where it stopped and why
- **AND** the comment is what says why the task is at `Pending`

#### Scenario: A session is killed mid-run

- **WHEN** a session ends without reaching its own end
- **THEN** an announcement exists with no closing comment
- **AND** the task is still in the stage's own status
- **AND** a stage re-entering the task reads that pairing as an interrupted run whose markers are unverified
