# pipeline-runner Specification

## Purpose

Defines what drives the dispatcher on a schedule: the runners jen ships, the rule that keeps each one a wrapper over the shared tick rather than a second implementation of it, and what each runner owns that the other does not.

## Requirements

### Requirement: A runner drives the tick and decides nothing

A runner SHALL invoke `jen run` on some schedule and SHALL make no decision about what to dispatch. Polling, mapping, gating, capping, and reporting SHALL belong to the tick under every runner.

A runner SHALL NOT hold pipeline state that another runner cannot see. Everything a runner knows about what the pipeline is doing SHALL be read from the tracker, so that two runners reading the same tracker reach the same conclusions. A runner's own memory of what it launched SHALL be at most a cache of what the tracker says, never the state consulted.

Resolving the tracker team and project SHALL belong to the runner, which SHALL be free to do it however suits it, and SHALL pass them into the tick. This is the one difference permitted between runners, and it is permitted because it is settled before the tick begins and cannot reach what the tick decides.

#### Scenario: A runner drives a tick

- **WHEN** any runner reaches the moment it is scheduled to act
- **THEN** it invokes the same entry point every other runner invokes
- **AND** it contributes nothing to the decision about what is dispatched

#### Scenario: Two runners see one pipeline

- **WHEN** two runners are pointed at the same project
- **THEN** each establishes what is in flight from the tracker
- **AND** neither consults a record the other cannot read

#### Scenario: A runner is tempted to remember

- **WHEN** a runner has launched a session and ticks again
- **THEN** what keeps that task from being dispatched twice is the announcement on the task
- **AND** not the runner's own memory of having launched it

### Requirement: jen ships two runners, and neither is the fallback

jen SHALL ship a scheduled git-host workflow and a long-running local process, and SHALL present them as peers. Documentation SHALL NOT describe either as the default or as the lesser option.

Choosing the local runner SHALL NOT be presented as leaving the git host. The pipeline opens pull requests, submits review verdicts, and depends on branch protection to make the review load-bearing under either runner, so the pipeline's registered git-host identities SHALL be required by both.

A runner jen does not ship SHALL remain equally valid, and supporting one SHALL require nothing of jen beyond the entry point already published.

#### Scenario: An adopter chooses

- **WHEN** an adopter reads what jen ships
- **THEN** both runners are presented as first-class
- **AND** neither is described as a fallback from the other

#### Scenario: The local runner's git-host requirement

- **WHEN** an adopter chooses the local runner
- **THEN** the git-host identities are still required
- **AND** the documentation says so plainly rather than leaving it to be inferred

#### Scenario: A third runner

- **WHEN** an adopter drives the tick from a timer, a container, or a scheduler jen has never heard of
- **THEN** it works with nothing added to jen

### Requirement: The scheduled workflow polls without checking the repository out

The scheduled workflow SHALL invoke the published CLI directly and SHALL NOT check the repository out. Everything the deciding pass needs SHALL reach it as configuration or as compiled-in data.

This SHALL hold the cost of a poll flat as the repository grows. The only checkout in the pipeline SHALL be the one a stage session makes for itself, taken only when there is work to do.

The tracker team and project SHALL be carried in the workflow file itself, resolved from the registry when the file is written rather than read from repository settings. The pipeline's target SHALL therefore be versioned, diffable, and reviewable alongside everything else jen owns.

#### Scenario: A poll with nothing to do

- **WHEN** the scheduled workflow runs and no task is actionable
- **THEN** the repository was never checked out
- **AND** what the poll cost does not depend on the size of the repository

#### Scenario: The pipeline's target is inspected

- **WHEN** someone asks which tracker project the scheduled runner polls
- **THEN** the answer is readable in the workflow file in the repository
- **AND** it is not held in settings outside the repository

### Requirement: Polls do not overlap

A runner SHALL NOT begin a tick while one it started is still running. The scheduled workflow SHALL express this to the git host so that a scheduled run arriving during a tick waits rather than running beside it, and the local runner SHALL await each tick before scheduling the next.

The configured interval SHALL therefore be a floor between the end of one tick and the start of the next, and SHALL NOT be a guarantee of when a poll occurs. Because a tick waits for the sessions it launched, a long session SHALL delay the following poll.

#### Scenario: A tick outlasts its interval

- **WHEN** a tick is still running when the next one is due
- **THEN** the next tick does not begin beside it
- **AND** it begins once the running tick has finished

#### Scenario: Latency between stages

- **WHEN** a task's stage finishes early in a tick that is waiting on a slower session
- **THEN** that task's next stage is not picked up until the tick ends
- **AND** this is accepted as the cost of not overlapping

### Requirement: The scheduled runner bounds how long a tick may hold a runner

The scheduled workflow SHALL declare a limit on how long its job may run, below the git host's own ceiling.

This SHALL be a liveness bound and SHALL NOT be presented as a bound on how long a stage session may take. Its purpose is that a session which hangs releases the runner and unblocks the next poll rather than holding both until the host's ceiling is reached.

A session stopped by that limit SHALL leave the task exactly as a session stopped by any other signal does.

#### Scenario: A session hangs

- **WHEN** a stage session stops making progress
- **THEN** the job ends at the declared limit rather than at the host's ceiling
- **AND** the next scheduled poll is able to run

#### Scenario: What the bound claims

- **WHEN** the declared limit is read
- **THEN** it is documented as protecting the runner
- **AND** it is not documented as the limit on a stage session's length

### Requirement: An unbound project's scheduled poll fails and names what is missing

Where the tracker team and project have not been resolved into the workflow, the scheduled poll SHALL fail naming what is absent, and SHALL NOT be silently skipped.

A project is in this state between installation and binding. Failing SHALL be preferred to skipping because the git host reports a failed scheduled run to the repository's owner, and a poll that quietly does nothing is indistinguishable from a pipeline with nothing to do — which is the one state this pipeline must never be confused with.

#### Scenario: jen is installed but not yet bound

- **WHEN** the scheduled workflow runs before the project has been bound
- **THEN** it fails naming the missing tracker team
- **AND** nothing is dispatched

#### Scenario: The project is bound

- **WHEN** the project is bound and the workflow's values are refreshed
- **THEN** the next scheduled poll proceeds normally

### Requirement: The local runner drives the tick on an interval until it is stopped

jen SHALL provide a command that performs a tick, waits a configurable interval, and repeats, until it is stopped. The interval SHALL be settable.

Its interval and the scheduled runner's SHALL be free to differ, and their defaults SHALL be chosen for their own constraints: a local tick costs a handful of tracker requests, while a scheduled one is billed by the git host in whole minutes. Differing intervals SHALL NOT be read as the runners diverging — how often a runner asks is not pipeline state.

#### Scenario: The loop runs

- **WHEN** the local runner is started
- **THEN** it ticks, waits the interval, and ticks again
- **AND** it continues until it is stopped

#### Scenario: The interval is changed

- **WHEN** an operator sets a different interval
- **THEN** the loop honours it
- **AND** nothing else about what is dispatched changes

### Requirement: The local runner resolves the project identity from its checkout

The local runner SHALL determine the tracker team and project by reading the registry in the checkout it was pointed at, and SHALL pass those values into the tick. An operator SHALL be able to override them.

The tick SHALL still read no file. This resolution SHALL happen in the runner, before the tick begins, which is what keeps a runner that has a checkout and a runner that does not from taking different paths through the deciding pass.

#### Scenario: The runner is pointed at a project

- **WHEN** the local runner is started against a checkout whose registry names a tracker team and project
- **THEN** it reads them from there
- **AND** it passes them into the tick rather than letting the tick read them

#### Scenario: The operator overrides

- **WHEN** an operator names a team or project explicitly
- **THEN** that value is used in place of what the registry says

#### Scenario: The registry names no tracker

- **WHEN** the checkout's registry names no tracker project and none was given
- **THEN** the runner refuses rather than guessing

### Requirement: The local runner holds nothing that a restart would lose

The local runner SHALL keep no lock file, no ledger, no queue, and no record of what it has launched. Restarting it SHALL re-establish everything it needs from the tracker.

Two instances pointed at one project SHALL behave exactly as two runners do, and SHALL be governed by the same in-flight test and the same cap, represented in the tracker. The local runner SHALL NOT attempt to serialize itself against another instance through anything held on the host.

Sessions launched by a runner that is killed SHALL be stopped with it, and the announcements they left SHALL remain open, which the pipeline reads as a task still being worked until a person moves it.

#### Scenario: The runner is restarted

- **WHEN** the local runner is stopped and started again
- **THEN** it re-establishes what is in flight from the tracker
- **AND** nothing it knew before the restart was needed

#### Scenario: Two instances on one project

- **WHEN** two local runners are pointed at the same project
- **THEN** each is governed by the in-flight test and the cap the tracker represents
- **AND** neither consults a lock held on either host

#### Scenario: The runner is killed mid-session

- **WHEN** the local runner is killed while a session it launched is running
- **THEN** that session is stopped with it
- **AND** the task's open announcement keeps it from being dispatched again until a person moves it

### Requirement: A failed tick does not end the loop, and an impossible one does

The local runner SHALL report a failed tick and continue to the next. A tracker error, a rate limit, a bounded read it could not finish, and a paused project SHALL all be treated this way, because each can resolve without the process being restarted.

The local runner SHALL exit non-zero when a tick refuses for a reason that cannot change while the process runs — a missing credential, or a tracker team and project that could not be resolved. Repeating a tick that cannot succeed produces the same error indefinitely and hides nothing that a person needs to see twice.

#### Scenario: The tracker is briefly unreachable

- **WHEN** a tick fails because the tracker could not be reached
- **THEN** the failure is reported
- **AND** the next tick runs at the next interval

#### Scenario: The project is paused

- **WHEN** a tick halts because the project is paused
- **THEN** the loop continues, so that unpausing resumes the pipeline with no restart

#### Scenario: A credential is absent

- **WHEN** a tick refuses because a required credential is not in the environment
- **THEN** the loop ends and the process exits non-zero
- **AND** the missing credential is named

### Requirement: Stopping a runner stops the sessions it launched

A runner receiving a termination signal SHALL stop scheduling further work, forward the stop to the sessions in flight, wait for them to end, and exit. It SHALL NOT leave a session running with no process responsible for it, and SHALL NOT write anything to the tracker on a stopped session's behalf.

#### Scenario: A runner is asked to stop

- **WHEN** a runner is signalled while sessions it launched are running
- **THEN** it starts no further tick
- **AND** each running session is stopped rather than orphaned

#### Scenario: What a stopped session leaves

- **WHEN** a session is stopped by its runner being stopped
- **THEN** the task is left exactly as that session left it
- **AND** nothing writes to the tracker in its place
