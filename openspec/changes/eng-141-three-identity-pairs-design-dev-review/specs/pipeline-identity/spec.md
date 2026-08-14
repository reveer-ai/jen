## Purpose

Defines the identities the pipeline acts under — three roles spanning the six stages, distinguished on the git host where the distinction is load-bearing and sharing one agent on the tracker where it is not — how a run comes to hold the right one, where its credentials come from and where they may not go, and the merge gate that makes a review verdict load-bearing rather than advisory.

## ADDED Requirements

### Requirement: Three roles cover the stages

The pipeline SHALL act under exactly three roles — `design`, `dev`, and `deliver` — and every stage SHALL belong to exactly one of them:

| Role | Stages |
|---|---|
| `design` | `design-task` |
| `dev` | `implement-task` |
| `deliver` | `review-task`, `test-task`, `deliver-task` |

Two roles would satisfy the git host's refusal of a review from a pull request's own author. Three SHALL be used, so that attribution names the work actually done rather than the minimum the constraint demanded.

#### Scenario: A stage runs

- **WHEN** a stage does its work
- **THEN** every action it takes on the git host is attributed to its own role

#### Scenario: The later stages share a role

- **WHEN** `review-task`, `test-task`, or `deliver-task` runs
- **THEN** each acts as `deliver`
- **AND** none of them acts as the role that authored or implemented the change

### Requirement: Roles are distinct on the git host and share one identity on the tracker

Each role SHALL have its own application identity on the git host. All three SHALL share a single agent identity on the tracker.

The asymmetry is deliberate and follows the constraint. Distinct identities are required on the git host because that host refuses a review from a pull request's own author, so the pipeline cannot review its own work without them. The tracker imposes no equivalent constraint: separate tracker identities would carry identical scopes and identical capability, differing only in the name on a comment, at the cost of multiplying the registration an adopter performs by hand. One identity is what the tracker's job — letting an unattended run authenticate at all — actually requires.

No identity SHALL be a human user's account, and none SHALL occupy a paid seat on either surface.

#### Scenario: A stage acts on the pull request

- **WHEN** a stage pushes, opens, reviews, or merges the task's pull request
- **THEN** the git host records that stage's own role as the actor

#### Scenario: A stage acts on the task

- **WHEN** a stage transitions its task's status, comments on it, or attaches an artifact
- **THEN** the tracker records the shared agent as the author
- **AND** not the human who authorized it

#### Scenario: Two roles act on the same task

- **WHEN** one stage and then a later stage in a different role both act on the tracker
- **THEN** both are attributed to the same shared agent
- **AND** the pull request still distinguishes which role performed each git-host action

#### Scenario: No seat is consumed

- **WHEN** the identities are registered
- **THEN** none of them occupies a paid seat on the git host or the tracker

### Requirement: Identities are registered per project, never published centrally

Every identity — each role's application on the git host, and the shared agent on the tracker — SHALL be registered into the adopting project's own organization and its own workspace.

jen SHALL NOT publish an identity common to more than one adopter, and no credential SHALL be minted by, pass through, or depend on the availability of any service the jen project operates. A pipeline that cannot run without somebody else's endpoint being up is not one an adopter owns.

#### Scenario: A project registers its identities

- **WHEN** an adopter registers the three applications and the agent
- **THEN** they exist in that project's own organization and workspace
- **AND** they are usable by that project alone

#### Scenario: No central dependency exists

- **WHEN** a stage authenticates as its role
- **THEN** no request is made to any service operated by the jen project

### Requirement: Pull-request work goes to the git host directly

A stage SHALL perform pull-request work — review comments, threads, verdicts, and merges — against the git host directly, under its role's application identity.

It SHALL NOT route that work through the tracker. The tracker's view of a pull request is derived from an integration that links a tracker user to an account on the git host, and the pipeline's identities have no such account, so that view is empty for every identity the pipeline runs as. Tooling built on it is present but inert.

Issue work — reading a task, moving its status, commenting on it, attaching artifacts — SHALL continue to go to the tracker under the shared agent, which serves it correctly.

#### Scenario: A stage comments on the change under review

- **WHEN** a stage anchors a comment to a file and hunk
- **THEN** it does so against the git host
- **AND** the comment is attributed to the stage's role

#### Scenario: A stage looks for the pull request through the tracker

- **WHEN** a stage authenticated as the pipeline's tracker agent queries the tracker for the task's pull request
- **THEN** nothing is returned
- **AND** the stage does not treat that emptiness as the pull request being absent

#### Scenario: A stage records something on the task

- **WHEN** a stage comments on the issue or moves its status
- **THEN** it does so through the tracker under the shared agent

### Requirement: A run holds its stage's identity and never selects one

A run SHALL begin with the credentials of its stage's role already in place, and a stage SHALL NOT choose which role it acts as, switch roles mid-run, or obtain a credential belonging to another role.

Selecting the identity is the dispatcher's, because a stage that could choose its own could also choose the one that lets it approve its own work.

#### Scenario: A stage begins

- **WHEN** a stage session starts
- **THEN** the credentials for exactly one role are available to it
- **AND** that role is the one the stage table assigns to that stage

#### Scenario: A stage attempts to act as another role

- **WHEN** a stage would need another role's identity to do something
- **THEN** it cannot obtain it
- **AND** the action fails rather than succeeding under the wrong identity

### Requirement: Credentials resolve from the environment and are never written to disk

Every credential a role needs SHALL be supplied through the run's environment and resolved from it at the point of use.

jen SHALL NOT write a credential to disk, SHALL NOT read one from a file it manages, and SHALL NOT record one in the registry or any other tracked file. A run SHALL leave no credential behind on the host that executed it.

When a credential a run requires is absent, the run SHALL refuse to start and SHALL name which one is missing, rather than proceeding far enough to fail partway through a stage's work.

#### Scenario: Credentials are supplied for a run

- **WHEN** a run begins with its role's credentials in the environment
- **THEN** they are read from there
- **AND** no file is consulted for them

#### Scenario: A run ends

- **WHEN** a run finishes, by success or by failure
- **THEN** no credential it used remains on the host

#### Scenario: A required credential is absent

- **WHEN** a run begins without a credential its role requires
- **THEN** it refuses to start
- **AND** it names the missing credential

#### Scenario: The registry is inspected

- **WHEN** `registry.yaml` is read
- **THEN** it holds no secret of any kind

### Requirement: A role's git-host token is short-lived and minted per run

The token a run uses on the git host SHALL be minted for that run, scoped to its role's installation, and SHALL expire. A long-lived personal access token SHALL NOT be used in its place.

#### Scenario: A run needs git-host access

- **WHEN** a run begins
- **THEN** a token is minted for its role
- **AND** it is scoped to that role's installation rather than to a human's full access

#### Scenario: A later run needs access

- **WHEN** a subsequent run begins
- **THEN** it mints its own token
- **AND** does not reuse a previous run's

### Requirement: The default branch admits only a change a third identity approved

The default branch SHALL require at least one approving review, and SHALL require that approval to postdate the most recent reviewable push.

Together those two exclude both the pull request's author and whoever pushed to it last. Because `design` opens the pull request and `dev` pushes the implementation, `deliver` is the only pipeline role that can satisfy the requirement — the guarantee therefore holds by construction rather than by naming a reviewer, which matters because the git host's required-reviewer setting cannot name an application identity at all.

No role SHALL be permitted to bypass the requirement. A human MAY retain a bypass, since somebody has to be able to break the glass.

#### Scenario: The implementing role attempts to approve

- **WHEN** `dev` has pushed the implementation and an approval is submitted under `dev`
- **THEN** the change is not mergeable on that approval

#### Scenario: The authoring role attempts to approve

- **WHEN** an approval is submitted under the role that opened the pull request
- **THEN** the git host refuses it

#### Scenario: A change reaches delivery unreviewed

- **WHEN** delivery attempts to merge a pull request carrying no approving review
- **THEN** the merge is refused

#### Scenario: A change reaches delivery reviewed

- **WHEN** delivery attempts to merge a pull request approved by `deliver` after the last push
- **THEN** the merge is permitted

#### Scenario: A role attempts to bypass

- **WHEN** any of the three roles attempts to merge without satisfying the requirement
- **THEN** it cannot, because no role holds a bypass

### Requirement: A verdict is submitted under the delivering role's own credential

A review verdict SHALL be submitted with a credential belonging to the `deliver` role's application identity.

It SHALL NOT be submitted with the credential a CI platform supplies to a workflow by default. Such a review is recorded and displayed like any other but does not count toward a required approval, which makes it the most dangerous available failure: the pipeline appears to have reviewed the change while the gate remains unsatisfied.

#### Scenario: A verdict is recorded

- **WHEN** `review-task` submits its verdict
- **THEN** it is submitted under the `deliver` role
- **AND** it counts toward the default branch's approval requirement

#### Scenario: A CI platform's default credential is available

- **WHEN** a stage runs on a CI platform that exposes a default workflow credential
- **THEN** that credential is not what the verdict is submitted with
