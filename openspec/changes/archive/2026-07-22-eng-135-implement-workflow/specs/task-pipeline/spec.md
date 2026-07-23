## ADDED Requirements

### Requirement: Each stage is one skill, triggered by the task's status

The workflow SHALL define one skill per stage, and the task reaching that stage's status SHALL be what triggers the skill's work. The stages, their statuses, and their handoffs SHALL be:

| Status | Skill | Hands off |
|---|---|---|
| — | `refine-epic` | tasks land in `Todo` |
| `In Design` | `design-task` | `In Progress` |
| `In Progress` | `implement-task` | `In Review` |
| `In Review` | `review-task` | `In Testing`, or back to `In Progress` |
| `In Testing` | `test-task` | `In Delivery`, or back to `In Progress` |
| `In Delivery` | `deliver-task` | `Done` |

No stage SHALL require any trigger beyond the status, and the pipeline SHALL NOT record a task's position in it anywhere other than the task's own status.

#### Scenario: A task reaches a stage's status

- **WHEN** a task is moved to `In Design`
- **THEN** that transition is what triggers `design-task` to do its work
- **AND** no queue, run record, or separate pipeline-position field is consulted

#### Scenario: A stage completes its work

- **WHEN** a stage finishes
- **THEN** it moves the task to the status of the stage it hands off to
- **AND** that transition is the next stage's trigger

#### Scenario: A stage is re-entered after an interrupted run

- **WHEN** a stage begins against a task already in its own status
- **THEN** it checks for work it has already done before producing more
- **AND** it resumes rather than restarting

### Requirement: Refinement precedes the pipeline and ends in `Todo`

`refine-epic` SHALL turn an idea into an epic and its sub-issue tasks, and SHALL leave everything it produces in `Todo`. `Backlog` SHALL hold unrefined placeholders and `Todo` SHALL hold refined tasks ready to design.

Promoting a task from `Todo` to `In Design` SHALL be the user's decision. No stage SHALL make that transition.

#### Scenario: An idea is refined

- **WHEN** `refine-epic` finishes breaking an epic down
- **THEN** the epic and its tasks are in `Todo`
- **AND** none of them has been moved into `In Design`

#### Scenario: An idea is logged without being refined

- **WHEN** an idea is captured that nobody has thought through
- **THEN** it is created in `Backlog`

#### Scenario: A refined task is picked up

- **WHEN** a task in `Todo` is moved to `In Design`
- **THEN** a human made that transition, and the pipeline drives itself from there

### Requirement: Design is attended and every later stage is not

`design-task` SHALL confirm with the user before each artifact. Every stage after it SHALL run unattended and SHALL NOT wait on a reply.

An unattended stage that needs a human SHALL write what is needed to the Linear issue or the PR and stop cleanly, leaving the task's status truthful about where the work actually is.

#### Scenario: Design produces an artifact

- **WHEN** `design-task` is about to write an artifact
- **THEN** it confirms with the user first

#### Scenario: An unattended stage hits something only a human can decide

- **WHEN** a stage after design cannot proceed without a human
- **THEN** it records what is needed on the issue or as a comment anchored to what it concerns
- **AND** the run stops rather than waiting for an answer

#### Scenario: An unattended stage stops early

- **WHEN** a stage stops before finishing its work
- **THEN** the task is left in a status that reflects where the work actually stands
- **AND** the reason it stopped is readable on the issue or the PR

### Requirement: A stage may route a task backward

A stage that finds the previous stage's output unusable SHALL move the task back to the status that owns the fix rather than doing that work itself. Review and testing SHALL route to `In Progress`; implementation SHALL route to `In Design` when there is no usable design to implement.

#### Scenario: Review finds the implementation wanting

- **WHEN** `review-task` requests changes
- **THEN** the task moves back to `In Progress`
- **AND** the comments backing the verdict are what implementation acts on

#### Scenario: Implementation finds no usable design

- **WHEN** `implement-task` finds the design absent or self-contradictory
- **THEN** the task moves back to `In Design`
- **AND** the blocker is recorded against the artifact it belongs to

### Requirement: Backward routing is budgeted across the whole pipeline

Backward routing SHALL be governed by a single budget shared by every stage, not one budget per stage or per pair of stages.

Before starting its work, a stage SHALL count the backward transitions in the issue's `stateHistory` — every move to a status earlier in the pipeline than the one the task was in. On the third such transition the stage SHALL NOT begin: it SHALL comment on the issue with what sent the task back each round and what appears unresolvable, and SHALL leave the task's status unchanged.

#### Scenario: A task has been sent back once

- **WHEN** a stage begins and the issue's history shows one backward transition
- **THEN** the stage does its work normally

#### Scenario: A task has exhausted the budget

- **WHEN** a stage begins and the issue's history shows three backward transitions
- **THEN** the stage does not start the work
- **AND** it comments with what sent the task back each round and what looks unresolvable
- **AND** the task's status is left where it is

#### Scenario: A task oscillates between two different pairs of stages

- **WHEN** a task is routed backward once between review and implementation, and twice between testing and implementation
- **THEN** the budget counts three backward transitions in total
- **AND** the third stops the run, because the budget is shared rather than per-pair
