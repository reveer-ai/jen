## ADDED Requirements

### Requirement: Each stage is one skill, triggered by the transition into its status

The workflow SHALL define one skill per stage, and the task's transition *into* that stage's status SHALL be what triggers the skill's work. The stages, their statuses, and their handoffs SHALL be:

| Status | Skill | Hands off |
|---|---|---|
| — | `refine-epic` | tasks land in `Todo` |
| `In Design` | `design-task` | stays at `In Design`; the user promotes |
| `In Progress` | `implement-task` | `In Review` |
| `In Review` | `review-task` | `In Testing`, or back to `In Progress` |
| `In Testing` | `test-task` | `In Delivery`, or back to `In Progress` |
| `In Delivery` | `deliver-task` | `Done` |

The trigger SHALL be the transition rather than the task's residence in the status. A task resting in a status is not by itself a trigger, because residence cannot distinguish work that has finished from work in progress from work nothing has yet run against.

No stage SHALL require any trigger beyond that transition, and the pipeline SHALL NOT record a task's position in it anywhere other than the task's own status and the history of its transitions.

#### Scenario: A task is moved into a stage's status

- **WHEN** a task is moved to `In Progress`
- **THEN** that transition is what triggers `implement-task` to do its work
- **AND** no queue, run record, or separate pipeline-position field is consulted

#### Scenario: A task rests in a status it was already moved into

- **WHEN** a task has been in `In Design` since its last transition and design has already run against it
- **THEN** its presence in that status is not a fresh trigger
- **AND** the stage is not run again on account of the status alone

#### Scenario: A stage completes its work

- **WHEN** a stage that hands off finishes
- **THEN** it moves the task to the status of the stage it hands off to
- **AND** that transition is the next stage's trigger

### Requirement: Design ends at `In Design` and promotion is the user's

`design-task` SHALL NOT advance the task when it finishes. It SHALL leave the task at `In Design`, having written its artifacts, opened the draft PR, and commented.

Moving a task from `In Design` to `In Progress` SHALL be the user's decision, because that transition starts implementation and implementation is user-led. Together with `Todo` → `In Design`, this SHALL be one of two transitions no stage makes.

A design run that finishes SHALL therefore be distinguishable from one that was interrupted, since both leave the task at the same status. The comment every session ends with is what carries that distinction.

#### Scenario: Design finishes its artifacts

- **WHEN** `design-task` completes the full artifact set and validates it
- **THEN** the task is left at `In Design`
- **AND** no stage moves it to `In Progress`

#### Scenario: A designed task is promoted

- **WHEN** a task whose design is complete is moved to `In Progress`
- **THEN** a human made that transition

#### Scenario: A design run is interrupted

- **WHEN** a design session is killed before finishing
- **THEN** the task is left at `In Design`, as a finished design run would also leave it
- **AND** what distinguishes the two is whether the run left its end-of-session comment

### Requirement: Design confirms with the user when it can, and no stage waits on a reply

`design-task` SHALL confirm with the user before each artifact when confirmation is available to it. When it is not — a run in which asking is denied or impossible — `design-task` SHALL write the artifact set without confirming rather than waiting, and the task's draft PR SHALL be the surface on which that confirmation happens afterward.

`design-task` SHALL determine which of these applies from whether confirmation is actually available to it, and SHALL NOT depend on a flag, an environment variable, or a declared mode to tell it.

No stage SHALL wait on a reply. A stage that needs a human SHALL write what is needed to the task or the PR and stop cleanly, leaving the task's status truthful about where the work actually stands.

#### Scenario: Design runs with a user present

- **WHEN** `design-task` is about to write an artifact and can ask
- **THEN** it confirms with the user first

#### Scenario: Design runs with nobody to ask

- **WHEN** `design-task` is about to write an artifact and confirmation is unavailable
- **THEN** it writes the artifact without confirming
- **AND** the artifact reaches the user through the draft PR rather than through a question

#### Scenario: A stage hits something only a human can decide

- **WHEN** a stage cannot proceed without a human
- **THEN** it records what is needed on the task or as a comment anchored to what it concerns
- **AND** the run stops rather than waiting for an answer

#### Scenario: A stage stops early

- **WHEN** a stage stops before finishing its work
- **THEN** the task is left in a status that reflects where the work actually stands
- **AND** the reason it stopped is readable on the task or the PR

## MODIFIED Requirements

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
- **THEN** a human made that transition
- **AND** the pipeline drives itself from `In Progress` onward, the promotion out of `In Design` being the user's as well

## REMOVED Requirements

### Requirement: Each stage is one skill, triggered by the task's status

**Reason**: The trigger is the transition into a status, not residence in it. Once a stage can finish without advancing the task, residence no longer distinguishes finished work from work in progress, and a pipeline reading the status alone would run that stage again on every check.

**Migration**: Replaced by "Each stage is one skill, triggered by the transition into its status", which keeps the stage table and the prohibition on a separate position record, and adds the history of transitions as part of what records position.

### Requirement: Design is attended and every later stage is not

**Reason**: Design's attendedness is conditional rather than absolute — the stage can be run where there is nobody to confirm with, and needed an answer for that case rather than a rule it would break.

**Migration**: Replaced by "Design confirms with the user when it can, and no stage waits on a reply", which keeps the unattended guarantees for every stage and states what design does when confirmation is unavailable.

### Requirement: Backward routing is budgeted across the whole pipeline

**Reason**: Enforcement moves to the dispatcher, which gates a task before dispatching it. A ceiling each of six skills computes for itself is a rule that can be applied inconsistently and disagree with the gate that also applies it; one mechanical enforcement point replaces both.

**Migration**: The dispatcher owns counting backward transitions and refusing to dispatch. Stages read the task's record on entry as context — which surfaces a circling task among other things — but SHALL NOT gate on it. See the `stage-conventions` requirement "A stage reads the task's record before it acts".
