## MODIFIED Requirements

### Requirement: Every finished dispatch is reported as a run record

For each session it saw through, the command SHALL emit a run record naming the task, the stage's skill, the role it acted under, whether it succeeded, what the session reported it cost where it reported one, the session's own identifier where there is one, whether it was stopped rather than finished, and whether its session started at all. Where a transcript was kept, the record SHALL name where it went; where none was kept, the record SHALL say so rather than leaving it unstated.

The record SHALL also carry what the run had to say that was not a failure — what a run worked around rather than stopped over, such as a declaration that scoped nothing. Having nothing to say and saying nothing SHALL be the same fact in the record, so this SHALL be carried as a set that may be empty rather than as something that may be absent. It SHALL NOT bear on whether the run succeeded.

The record SHALL be emitted in a form both a person and a consuming program can read, on the same stream as run requests, so that recording what the pipeline did requires nothing of either runner and reads identically under both. The human-readable report SHALL carry each run's cost beside its outcome, and SHALL carry what the run had to say beside it — on the successful branch as well as the failing one, since a run that says something without failing is the only kind that ever has these to report.

A run record SHALL NOT carry a credential, on the same terms as a run request: it may be logged, printed, or passed between processes. This SHALL hold of what a run had to say as much as of the rest of it — such a note SHALL name a variable rather than carry its value.

Emitting a record SHALL NOT be a tracker write and SHALL NOT be read as one. Nothing about the record SHALL reach the task; what a stage did to its task is the session's own to report.

#### Scenario: A session finishes

- **WHEN** a dispatched session ends
- **THEN** a run record is emitted naming the task, skill, role, outcome, cost, and session identifier
- **AND** it says whether a transcript was kept and where

#### Scenario: A session reported no cost

- **WHEN** a session ends without reporting what it cost
- **THEN** the record is still emitted
- **AND** the absence of a cost is distinguishable from a cost of zero

#### Scenario: A run has something to say without failing

- **WHEN** a session succeeds and the run found something to report that was not a failure
- **THEN** the record carries it
- **AND** the readable report prints it beside the run's outcome
- **AND** the run is still reported as having succeeded

#### Scenario: A run had nothing to say

- **WHEN** a session finishes and the run found nothing to report beyond its outcome
- **THEN** the record still carries the field, holding nothing
- **AND** a consumer does not have to distinguish an absent field from an empty one

#### Scenario: A record is consumed

- **WHEN** the command's output is piped to a program that records what the pipeline did
- **THEN** run requests and run records are distinguishable from one another
- **AND** neither carries a credential

#### Scenario: The same output under either runner

- **WHEN** the same dispatch happens under the runner jen ships and under a runner it does not
- **THEN** the run record is the same
- **AND** neither runner added anything to produce it
