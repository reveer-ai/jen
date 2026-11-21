## Purpose

How jen is versioned and released: what starts a release, how its version and notes are chosen, and what it publishes where, so that users installing `jen-ai` always get a consistent package and images.

## ADDED Requirements

### Requirement: A merge that changes what ships releases jen
Every push to `main` SHALL release jen when a commit since the last release changes what ships: `src/` other than `*.test.ts`, `package.json`, `package-lock.json`, `Dockerfile`, `README.md` or `LICENSE`. When none does, it SHALL release nothing and say so. A release SHALL run only after the project's checks pass on that commit.

#### Scenario: A change to the command
- **WHEN** a pull request that changes `src/cli/` is merged to `main`
- **THEN** a new version of jen is released

#### Scenario: A change to the record only
- **WHEN** a pull request that changes only `record/` and `openspec/` is merged to `main`
- **THEN** no version is released, and the run says nothing ships

#### Scenario: A failing check
- **WHEN** a merge to `main` fails its checks
- **THEN** nothing is released

### Requirement: The version follows the last release and the pull requests' labels
A release's version SHALL be the last release's, from its `v<x.y.z>` tag, with its patch number raised, or its minor or major number when a pull request it releases is labelled `minor` or `major`, taking the largest. With no earlier release, the version SHALL be `0.1.0`.

#### Scenario: No label
- **WHEN** the last release is `0.1.0` and the merged pull request has no label
- **THEN** the release is `0.1.1`

#### Scenario: A minor label
- **WHEN** the last release is `0.1.1` and the merged pull request is labelled `minor`
- **THEN** the release is `0.2.0`

#### Scenario: Several merges in one release
- **WHEN** one release takes two merges, one labelled `minor` and one with no label, after `0.2.0`
- **THEN** the release is `0.3.0`

#### Scenario: The first release
- **WHEN** no `v<x.y.z>` tag exists
- **THEN** the release is `0.1.0`

### Requirement: The release notes are the shipped merges' titles
A release's notes SHALL list, one line each, the subject of every commit since the last release that changes what ships, each linked to its pull request. Commits that change nothing that ships SHALL NOT be listed.

#### Scenario: Notes
- **WHEN** a release takes a merge titled `JEN-30: Show sub-agents in jen list (#40)` and a record-only merge
- **THEN** its notes have one line, for `JEN-30`, linking pull request 40

### Requirement: A release publishes its images for both architectures
A release SHALL publish the agent, runtime and workspace images to `ghcr.io/reveer-ai/jen-agent`, `jen-runtime` and `jen-workspace`, tagged with its version, each for `linux/amd64` and `linux/arm64`, before it publishes the package.

#### Scenario: Images of a release
- **WHEN** `0.1.0` is released
- **THEN** `ghcr.io/reveer-ai/jen-workspace:0.1.0` can be pulled on an amd64 and on an arm64 machine

### Requirement: The package holds only the command
The package SHALL be published to npm as `jen-ai` at the release's version, with the `jen` command compiled to JavaScript, `README.md` and `LICENSE`, and no dependencies, tests or TypeScript sources. Its license SHALL be `SEE LICENSE IN LICENSE`. The repo's own `package.json` SHALL stay private, so `npm publish` from a checkout fails.

#### Scenario: Installing the package
- **WHEN** a user runs `npm install -g jen-ai` with Node 26
- **THEN** `jen` is on their path and `jen help` prints the usage, with no other package installed

#### Scenario: Publishing from a checkout
- **WHEN** someone runs `npm publish` in a checkout
- **THEN** npm refuses, since the package is private

### Requirement: The packed package runs before it's published
Before publishing, a release SHALL install the package it is about to publish globally into a temporary npm prefix and run `jen help` from it, and SHALL publish nothing to npm, tag nothing and create no GitHub release when that fails.

#### Scenario: A package that doesn't run
- **WHEN** the packed command fails to start from `node_modules`
- **THEN** the release stops before npm, and no tag or GitHub release is made

### Requirement: A tag means a complete release
A release SHALL publish its images, then the package, and only then tag its commit `v<version>` and create a GitHub release with its notes. Running a failed release again SHALL finish it: what's already published from the same commit SHALL be kept, not published again. A version npm already has from a different commit SHALL fail the release.

#### Scenario: npm publishing fails
- **WHEN** a release pushes its images and npm refuses the package
- **THEN** no tag or GitHub release exists for that version, and the next release starts from the last tag

#### Scenario: Running a failed release again
- **WHEN** a release that published to npm but failed to tag is run again
- **THEN** it tags the commit and creates the GitHub release without publishing to npm again

### Requirement: Releases run one at a time
Releases SHALL run one at a time, never cancelling one in progress. When a release is waiting and a newer push arrives, the newer push's release SHALL take the waiting one's place and its merges.

#### Scenario: Two merges during a release
- **WHEN** two pull requests are merged while a release runs
- **THEN** after it, one release takes both merges' changes, or two releases run in turn

### Requirement: A release commits nothing
A release SHALL NOT commit to any branch. The version SHALL exist only in the tag, the published package and the images.

#### Scenario: After a release
- **WHEN** `0.1.1` is released
- **THEN** `main`'s head is still the merge, and the repo's `package.json` is unchanged

### Requirement: npm publishing holds no token
A release SHALL publish to npm through npm's trusted publishing from the repo's release workflow, and the repo SHALL keep no npm token in its secrets.

#### Scenario: The repo's secrets
- **WHEN** someone lists the repo's Actions secrets
- **THEN** none of them is an npm token
