## ADDED Requirements

### Requirement: jen ships one runner, and a runner it does not ship is equally valid

jen SHALL ship exactly one runner: a long-running process that drives the tick on an interval. It SHALL be called *the runner*, without a qualifier, and SHALL NOT be called *local* — in this specification *local* meant "not the git host" rather than "the operator's machine", and with nothing to contrast against, a reader has only the wrong reading left. Where a sentence must distinguish it from a runner jen does not ship, it SHALL be *the runner jen ships*.

Running the runner SHALL NOT be presented as leaving the git host. The pipeline opens pull requests, submits review verdicts, and depends on branch protection to make the review load-bearing, so the pipeline's registered git-host identities SHALL be required regardless of where the poll runs.

A runner jen does not ship SHALL remain equally valid, and supporting one SHALL require nothing of jen beyond the entry point already published. This SHALL include driving the tick from a git host's scheduled job. jen SHALL NOT ship a template, a workflow file, or a worked example for any such runner: what jen publishes is the entry point, and an adopter who drives it elsewhere owns the file that does so.

#### Scenario: The runner is named

- **WHEN** the documentation or the specification refers to the runner jen ships
- **THEN** it is called the runner
- **AND** it is not qualified as local

#### Scenario: An adopter expects the runner to remove the git host

- **WHEN** an adopter reads what the runner requires
- **THEN** the git-host identities are still required
- **AND** the documentation says so plainly rather than leaving it to be inferred

#### Scenario: A runner jen does not ship

- **WHEN** an adopter drives the tick from a timer, a container, a scheduled git-host job, or a scheduler jen has never heard of
- **THEN** it works with nothing added to jen
- **AND** the file that drives it is the adopter's own, because jen ships none

### Requirement: The runner drives the tick on an interval until it is stopped

jen SHALL provide a command that performs a tick, waits a configurable interval, and repeats, until it is stopped. The interval SHALL be settable.

The default SHALL be chosen for what a tick actually costs the operator, which is a handful of tracker requests. How often the runner asks SHALL NOT be read as pipeline state.

#### Scenario: The loop runs

- **WHEN** the runner is started
- **THEN** it ticks, waits the interval, and ticks again
- **AND** it continues until it is stopped

#### Scenario: The interval is changed

- **WHEN** an operator sets a different interval
- **THEN** the loop honours it
- **AND** nothing else about what is dispatched changes

### Requirement: The runner refuses to start against an unbound project, naming what is absent

The runner SHALL determine the tracker team and project by reading the registry in the checkout it was pointed at, and SHALL pass those values into the tick. An operator SHALL be able to override them.

Where neither the registry nor an override supplies them, the runner SHALL refuse to start, SHALL name what is absent and the checkout it read, and SHALL NOT poll. A project is in this state between installation and binding. Refusing SHALL be preferred to polling nothing, because a runner quietly polling an empty team name is indistinguishable from a pipeline with nothing to do — which is the one state this pipeline must never be confused with.

The refusal SHALL reach the operator as the process failing in front of them. This SHALL be understood as the replacement for a git host mailing a failed scheduled run to a repository's owner, and as a better one: the person who started the runner is present at the moment it refuses, where the mail arrived wherever it arrived.

The tick SHALL still read no file. This resolution SHALL happen in the runner, before the tick begins, which is what keeps a runner that has a checkout and a runner that does not from taking different paths through the deciding pass.

#### Scenario: The runner is pointed at a project

- **WHEN** the runner is started against a checkout whose registry names a tracker team and project
- **THEN** it reads them from there
- **AND** it passes them into the tick rather than letting the tick read them

#### Scenario: The operator overrides

- **WHEN** an operator names a team or project explicitly
- **THEN** that value is used in place of what the registry says

#### Scenario: jen is installed but not yet bound

- **WHEN** the runner is started against a checkout whose registry names no tracker project, and none was given
- **THEN** it refuses rather than guessing
- **AND** it names what is missing and the checkout it read
- **AND** nothing is dispatched

### Requirement: The runner holds nothing that a restart would lose

The runner SHALL keep no lock file, no ledger, no queue, and no record of what it has launched. Restarting it SHALL re-establish everything it needs from the tracker.

Two instances pointed at one project SHALL behave exactly as two runners do, and SHALL be governed by the same in-flight test and the same cap, represented in the tracker. The runner SHALL NOT attempt to serialize itself against another instance through anything held on the host.

Sessions launched by a runner that is killed SHALL be stopped with it, and the announcements they left SHALL remain open, which the pipeline reads as a task still being worked until a person moves it.

#### Scenario: The runner is restarted

- **WHEN** the runner is stopped and started again
- **THEN** it re-establishes what is in flight from the tracker
- **AND** nothing it knew before the restart was needed

#### Scenario: Two instances on one project

- **WHEN** two runners are pointed at the same project
- **THEN** each is governed by the in-flight test and the cap the tracker represents
- **AND** neither consults a lock held on either host

#### Scenario: The runner is killed mid-session

- **WHEN** the runner is killed while a session it launched is running
- **THEN** that session is stopped with it
- **AND** the task's open announcement keeps it from being dispatched again until a person moves it

## MODIFIED Requirements

### Requirement: Polls do not overlap

A runner SHALL NOT begin a tick while one it started is still running. The runner SHALL await each tick before scheduling the next.

The configured interval SHALL therefore be a floor between the end of one tick and the start of the next, and SHALL NOT be a guarantee of when a poll occurs. Because a tick waits for the sessions it launched, a long session SHALL delay the following poll.

#### Scenario: A tick outlasts its interval

- **WHEN** a tick is still running when the next one is due
- **THEN** the next tick does not begin beside it
- **AND** it begins once the running tick has finished

#### Scenario: Latency between stages

- **WHEN** a task's stage finishes early in a tick that is waiting on a slower session
- **THEN** that task's next stage is not picked up until the tick ends
- **AND** this is accepted as the cost of not overlapping

## REMOVED Requirements

### Requirement: jen ships two runners, and neither is the fallback

**Reason**: jen ships one runner. The peer framing, and the rule against calling either a fallback, describe a choice an adopter no longer has.

**Migration**: What survived is restated in *jen ships one runner, and a runner it does not ship is equally valid* — the git-host identities remain required, and a runner jen does not ship remains equally valid.

### Requirement: The scheduled workflow polls without checking the repository out

**Reason**: The scheduled workflow is deleted. Both halves of this requirement were about it: that a poll costs the same on a repository of any size because nothing is checked out, and that the tracker team and project are carried in the workflow file and resolved when it is written.

**Migration**: The property survives without being stated, because the runner never checked the repository out either — it reads one file, the registry in the checkout it was pointed at, which *The runner refuses to start against an unbound project* governs. The pipeline's target is no longer versioned in a managed file; it is the registry, which the project has always owned.

### Requirement: The scheduled runner bounds how long a tick may hold a runner

**Reason**: The bound was a property of the git host's job, declared in the deleted workflow. It protected a paid runner from being held by a hung session and unblocked the next scheduled poll.

**Migration**: None. The runner has no equivalent bound: a hung session hangs the loop, and stopping it is the operator's — which the adopter documentation already states. This is a real capability the pipeline loses, and giving the runner its own liveness bound is deliberately left to its own change rather than folded into this one.

### Requirement: An unbound project's scheduled poll fails and names what is missing

**Reason**: There is no scheduled poll to fail.

**Migration**: The safety is restated on the runner in *The runner refuses to start against an unbound project, naming what is absent*, which strengthens it — the operator who started the runner is present when it refuses, where a failed scheduled run was mailed to the repository's owner.
