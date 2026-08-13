## Purpose

Defines the identities the pipeline acts under — three roles spanning the six stages, each pairing an identity on the git host with one on the tracker — how a run comes to hold the right one, where its credentials come from and where they may not go, and the merge gate that makes a review verdict load-bearing rather than advisory.

## ADDED Requirements

### Requirement: Three roles cover the stages

The pipeline SHALL act under exactly three roles — `design`, `dev`, and `review` — and every stage SHALL belong to exactly one of them:

| Role | Stages |
|---|---|
| `design` | `design-task` |
| `dev` | `implement-task` |
| `review` | `review-task`, `test-task`, `deliver-task` |

Two roles would satisfy the git host's refusal of a review from a pull request's own author. Three SHALL be used, so that attribution on both surfaces names the work actually done rather than the minimum the constraint demanded.

#### Scenario: A stage runs

- **WHEN** a stage does its work
- **THEN** every action it takes on the git host and on the tracker is attributed to its own role

#### Scenario: The later stages share a role

- **WHEN** `review-task`, `test-task`, or `deliver-task` runs
- **THEN** each acts as `review`
- **AND** none of them acts as the role that authored or implemented the change

### Requirement: Each role pairs a git-host identity with a tracker identity

Each role SHALL comprise an application identity on the git host together with an agent identity on the tracker, distinct per role.

A role SHALL NOT be a human user's account, and SHALL NOT be an account that occupies a paid seat on either surface. An application identity is what gives a role its own actor in a pull request's timeline and its own author on a tracker comment, which is what makes attribution real rather than cosmetic.

#### Scenario: A stage moves an issue

- **WHEN** a stage transitions its task's status or comments on it
- **THEN** the tracker records the role's agent as the author
- **AND** not the human who owns the workspace

#### Scenario: A stage acts on the pull request

- **WHEN** a stage pushes, opens, reviews, or merges the task's pull request
- **THEN** the git host records the role's application as the actor

#### Scenario: No seat is consumed

- **WHEN** the three roles are registered
- **THEN** none of them occupies a paid seat on the git host or the tracker

### Requirement: Identities are registered per project, never published centrally

Each role's identities SHALL be registered into the adopting project's own organization on the git host and its own workspace on the tracker.

jen SHALL NOT publish a shared identity, and no credential SHALL be minted by, pass through, or depend on the availability of any service the jen project operates. A pipeline that cannot run without somebody else's endpoint being up is not one an adopter owns.

#### Scenario: A project registers its identities

- **WHEN** an adopter registers the three roles
- **THEN** the identities exist in that project's own organization and workspace
- **AND** they are usable by that project alone

#### Scenario: No central dependency exists

- **WHEN** a stage authenticates as its role
- **THEN** no request is made to any service operated by the jen project

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

Together those two exclude both the pull request's author and whoever pushed to it last. Because `design` opens the pull request and `dev` pushes the implementation, `review` is the only pipeline role that can satisfy the requirement — the guarantee therefore holds by construction rather than by naming a reviewer, which matters because the git host's required-reviewer setting cannot name an application identity at all.

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

- **WHEN** delivery attempts to merge a pull request approved by `review` after the last push
- **THEN** the merge is permitted

#### Scenario: A role attempts to bypass

- **WHEN** any of the three roles attempts to merge without satisfying the requirement
- **THEN** it cannot, because no role holds a bypass

### Requirement: A verdict is submitted under the review role's own credential

A review verdict SHALL be submitted with a credential belonging to the `review` role's application identity.

It SHALL NOT be submitted with the credential a CI platform supplies to a workflow by default. Such a review is recorded and displayed like any other but does not count toward a required approval, which makes it the most dangerous available failure: the pipeline appears to have reviewed the change while the gate remains unsatisfied.

#### Scenario: A verdict is recorded

- **WHEN** `review-task` submits its verdict
- **THEN** it is submitted under the `review` role
- **AND** it counts toward the default branch's approval requirement

#### Scenario: A CI platform's default credential is available

- **WHEN** a stage runs on a CI platform that exposes a default workflow credential
- **THEN** that credential is not what the verdict is submitted with
