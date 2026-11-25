## ADDED Requirements

### Requirement: A release publishes the machine for Apple silicon
A release SHALL build jen's machine and its launcher and publish them, with the pinned `docker` command for macOS, as a platform package at its version, which npm installs only on macOS on arm64. The launcher SHALL be signed with the virtualization entitlement. The machine's third-party binaries SHALL be checked against their pinned checksums, and a mismatch SHALL fail the release before anything is published.

#### Scenario: The platform package of a release
- **WHEN** `0.2.0` is released
- **THEN** the platform package is on npm at `0.2.0`, holding the machine, the launcher and the `docker` command

#### Scenario: A changed download
- **WHEN** the `docker` command's download doesn't match its pinned checksum
- **THEN** the release fails, and nothing is published

## MODIFIED Requirements

### Requirement: The package holds only the command
The package SHALL be published to npm as `jen-ai` at the release's version, with the `jen` command compiled to JavaScript, `README.md`, `LICENSE` and `NOTICE`, and no tests or TypeScript sources. Its only dependency SHALL be the platform package at the same version, as an optional dependency. Its license SHALL be `Apache-2.0`. The repo's own `package.json` SHALL stay private, so `npm publish` from a checkout fails.

#### Scenario: Installing the package
- **WHEN** a user runs `npm install -g jen-ai` with Node 26 on Linux
- **THEN** `jen` is on their path and `jen help` prints the usage, with no other package installed

#### Scenario: Installing on an Apple silicon Mac
- **WHEN** a user runs `npm install -g jen-ai` on an Apple silicon Mac
- **THEN** the platform package is installed with it, at the same version

#### Scenario: Publishing from a checkout
- **WHEN** someone runs `npm publish` in a checkout
- **THEN** npm refuses, since the package is private

#### Scenario: The package's license
- **WHEN** a user runs `npm view jen-ai license`
- **THEN** it prints `Apache-2.0`, and the installed package holds `LICENSE` and `NOTICE`

### Requirement: The packed package runs before it's published
Before publishing, a release SHALL install the packages it is about to publish globally into a temporary npm prefix and run `jen help` from it, and SHALL publish nothing to npm, tag nothing and create no GitHub release when that fails.

#### Scenario: A package that doesn't run
- **WHEN** the packed command fails to start from `node_modules`
- **THEN** the release stops before npm, and no tag or GitHub release is made

### Requirement: A tag means a complete release
A release SHALL publish its images, then the platform package, then `jen-ai`, and only then tag its commit `v<version>` and create a GitHub release with its notes. Running a failed release again SHALL finish it: what's already published from the same commit SHALL be kept, not published again. A version npm already has from a different commit SHALL fail the release.

#### Scenario: npm publishing fails
- **WHEN** a release pushes its images and npm refuses the package
- **THEN** no tag or GitHub release exists for that version, and the next release starts from the last tag

#### Scenario: The platform package fails
- **WHEN** npm refuses the platform package
- **THEN** `jen-ai` isn't published at that version, and no tag or GitHub release is made

#### Scenario: Running a failed release again
- **WHEN** a release that published to npm but failed to tag is run again
- **THEN** it tags the commit and creates the GitHub release without publishing to npm again
