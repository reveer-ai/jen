## Purpose

Defines how a merged change becomes a version an adopter can install: what declares that a release is due, what gates a publish, how the publish authenticates without any stored credential, and the one-time setup the pipeline cannot perform for itself.

## ADDED Requirements

### Requirement: A changeset declares the release

A release SHALL be declared by a changeset landing on the default branch, never by a maintainer editing the version by hand. A changeset SHALL record the version impact and a human-readable description of the change.

When one or more unreleased changesets are present on the default branch, the pipeline SHALL open or update a single **Version Packages** pull request that applies them: bumping the version in `package.json` and writing the accumulated descriptions into `CHANGELOG.md`. That pull request SHALL be the only place the version and the changelog are written.

A change merged without a changeset SHALL NOT be a failure. It SHALL simply not trigger a release, and a changeset added in a later change SHALL still carry it to the registry.

#### Scenario: A changeset opens the Version PR

- **WHEN** a change carrying a changeset is merged to the default branch
- **THEN** a Version Packages pull request exists proposing a version bump and a changelog entry describing that change

#### Scenario: Further changesets accumulate into the same PR

- **WHEN** a second change carrying a changeset is merged while a Version Packages pull request is open
- **THEN** that same pull request is updated to include both changes, and no second version pull request is opened

#### Scenario: A change without a changeset releases nothing

- **WHEN** a change carrying no changeset is merged to the default branch
- **THEN** the version in `package.json` is unchanged and nothing is published

### Requirement: Merging the Version PR publishes

Merging the Version Packages pull request SHALL publish the bumped version to the npm registry, and SHALL be the only path by which the pipeline publishes. The published version SHALL be the version the merged pull request wrote, with no further computation.

The pipeline SHALL also record the release in the repository: a git tag at the released commit and a GitHub Release carrying the changelog entry for that version.

Publishing SHALL be idempotent with respect to the registry. If the version already exists on the registry, the pipeline SHALL leave it untouched and SHALL NOT fail the run.

#### Scenario: The merge publishes the version

- **WHEN** the Version Packages pull request is merged
- **THEN** the version named in `package.json` at that commit is present on the npm registry

#### Scenario: The release is recorded in the repository

- **WHEN** a version is published
- **THEN** a tag for that version exists at the released commit and a GitHub Release for it carries that version's changelog entry

#### Scenario: A re-run does not republish

- **WHEN** the release runs against a commit whose version is already on the registry
- **THEN** no publish is attempted and the run succeeds

### Requirement: Publishing authenticates without a stored credential

The pipeline SHALL authenticate to the npm registry by exchanging a workflow OIDC token for a short-lived publish grant. No long-lived npm credential SHALL exist as a repository or organization secret, and the pipeline SHALL NOT read one.

The publishing environment SHALL NOT be configured with a registry authentication file, even an empty or placeholder one: a placeholder token is preferred over an OIDC exchange and fails as though the package did not exist.

The grant SHALL be constrained by more than the identity of the workflow file. The publishing job SHALL run in a named deployment environment restricted to the default branch, and that environment SHALL be among the claims the registry requires — so that authority to publish depends on the branch as well as the file.

Published versions SHALL carry provenance, and provenance SHALL be requested explicitly rather than relied upon as a default, so that a condition ceasing to hold fails the release instead of silently publishing without it.

#### Scenario: No npm credential is stored

- **WHEN** the repository's secrets and variables are listed
- **THEN** no npm authentication token is among them

#### Scenario: The publish is attributed to the workflow

- **WHEN** a version is published
- **THEN** the registry records provenance naming this repository and the workflow that published it

#### Scenario: Provenance that cannot be generated fails the release

- **WHEN** the conditions for generating provenance are not met at publish time
- **THEN** the run fails and nothing is published, rather than publishing without provenance

#### Scenario: A branch outside the environment cannot obtain a grant

- **WHEN** the release workflow is run from a branch the publishing environment does not permit
- **THEN** no publish grant is issued, even though the workflow file is the one the registry authorizes

### Requirement: A publish is gated on the package passing its checks

The release SHALL build, typecheck, and test the package before publishing, and SHALL abort without publishing if any of them fails.

The gate SHALL sit in the release run's own dependency chain. A check that merely runs on the same event is not a gate — it executes concurrently with the release and cannot prevent it — and SHALL NOT be relied on as one.

The set of checks SHALL have exactly one definition, shared with the checks that run on a pull request, so that a check added in one place cannot be absent from the other.

#### Scenario: A failing check prevents the publish

- **WHEN** the release runs against a commit whose tests fail
- **THEN** nothing is published and the run fails

#### Scenario: A newly added check applies to releases without being restated

- **WHEN** a check is added to the set that runs on pull requests
- **THEN** the release gate runs it too, with no separate edit to the release configuration

### Requirement: The published artifact is the verified artifact

The package SHALL be built and packed once, under the Node version the package declares as its minimum, and that same artifact SHALL be what is published. The publish SHALL NOT rebuild the package.

#### Scenario: The tested artifact is the one released

- **WHEN** a version is published
- **THEN** the uploaded artifact is byte-identical to the one produced and checked by the release run's gate

### Requirement: The release runs only from the default branch of this repository

The release SHALL run only on a push to the default branch of the canonical repository. It SHALL NOT run on a pull request, and SHALL NOT publish from a fork.

Concurrent release runs SHALL be prevented, and SHALL queue rather than cancel one another, so that a run already publishing is never interrupted.

#### Scenario: A pull request triggers no release

- **WHEN** a pull request is opened or updated
- **THEN** no release run is started

#### Scenario: Overlapping pushes do not publish concurrently

- **WHEN** a push to the default branch arrives while a release run is in progress
- **THEN** the new run waits for the in-progress one rather than running beside it or cancelling it

### Requirement: The stable channel is the only channel, and any future channel shares its workflow file

The pipeline SHALL publish to the default dist-tag only. No prerelease channel is defined; the `0.x` version line serves that purpose while the package is pre-1.0.

Trusted publishing authorizes exactly one workflow file per package. Any channel added later SHALL therefore be an additional job within the existing release workflow file, and SHALL NOT be a new workflow file beside it.

#### Scenario: Releases go to the default dist-tag

- **WHEN** a version is published
- **THEN** it is published under the registry's default dist-tag and no other tag is set

### Requirement: The one-time setup the pipeline cannot perform is recorded

The pipeline depends on account-level configuration it has no ability to create: the package existing on the registry, a trusted publisher entry naming this repository, the release workflow file and the publishing environment, that environment and its branch restriction, and a release identity able to open pull requests whose pushes trigger workflow runs. A trusted publisher cannot be configured for a package that does not exist, so the pipeline SHALL NOT be expected to publish the package's first version.

These preconditions SHALL be recorded in a project note beside the release configuration, stating for each what must be done, by whom, and what its absence looks like when the pipeline runs without it. The note SHALL NOT live in the root workflow document, which is shipped to every adopting project and describes none of this.

#### Scenario: The preconditions are discoverable from the workflow

- **WHEN** a contributor reads the project note nearest the release workflow
- **THEN** it names the bootstrap publish, the trusted publisher entry, the publishing environment, and the release identity, and describes the failure each one produces when missing

### Requirement: The identity that opens the Version PR permits the branch to be gated

The default branch SHALL require its checks to pass before a pull request merges, and that requirement SHALL hold for the Version pull request as it does for any other.

The Version pull request SHALL therefore be opened by an identity whose pushes trigger workflow runs. An identity that cannot trigger them produces a pull request on which the required check never reports, which cannot merge and cannot be released.

That identity SHALL hold only the permissions it needs to open and update the pull request, and SHALL NOT be able to publish.

#### Scenario: The Version PR is checked like any other change

- **WHEN** the Version pull request is opened
- **THEN** the required checks run on it, and it cannot merge until they pass

#### Scenario: The release identity cannot publish

- **WHEN** the permissions of the identity that opens the Version pull request are inspected
- **THEN** they permit repository contents and pull requests only, and confer no ability to publish to the registry

#### Scenario: The first version is not the pipeline's to publish

- **WHEN** the package does not yet exist on the registry
- **THEN** the pipeline is not expected to create it, and the bootstrap is performed by a maintainer
