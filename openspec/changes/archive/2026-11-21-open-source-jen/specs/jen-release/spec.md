## MODIFIED Requirements

### Requirement: A merge that changes what ships releases jen
Every push to `main` SHALL release jen when a commit since the last release changes what ships: `src/` other than `*.test.ts`, `package.json`, `package-lock.json`, `Dockerfile`, `README.md`, `LICENSE` or `NOTICE`. When none does, it SHALL release nothing and say so. A release SHALL run only after the project's checks pass on that commit.

#### Scenario: A change to the command
- **WHEN** a pull request that changes `src/cli/` is merged to `main`
- **THEN** a new version of jen is released

#### Scenario: A change to the record only
- **WHEN** a pull request that changes only `record/` and `openspec/` is merged to `main`
- **THEN** no version is released, and the run says nothing ships

#### Scenario: A failing check
- **WHEN** a merge to `main` fails its checks
- **THEN** nothing is released

### Requirement: A release publishes its images for both architectures
A release SHALL publish the agent, runtime and workspace images to `ghcr.io/reveer-ai/jen-agent`, `jen-runtime` and `jen-workspace`, tagged with its version, each for `linux/amd64` and `linux/arm64`, before it publishes the package. Each image SHALL be labelled with its license, `Apache-2.0`, and the agent and runtime images, which hold jen's code, SHALL carry `LICENSE` and `NOTICE` beside it.

#### Scenario: Images of a release
- **WHEN** `0.1.0` is released
- **THEN** `ghcr.io/reveer-ai/jen-workspace:0.1.0` can be pulled on an amd64 and on an arm64 machine

#### Scenario: The license in an image
- **WHEN** a user pulls a release's `jen-agent` or `jen-runtime` image
- **THEN** `/app/LICENSE` is the Apache License 2.0, `/app/NOTICE` is jen's notice, and the image's `org.opencontainers.image.licenses` label is `Apache-2.0`

### Requirement: The package holds only the command
The package SHALL be published to npm as `jen-ai` at the release's version, with the `jen` command compiled to JavaScript, `README.md`, `LICENSE` and `NOTICE`, and no dependencies, tests or TypeScript sources. Its license SHALL be `Apache-2.0`. The repo's own `package.json` SHALL stay private, so `npm publish` from a checkout fails.

#### Scenario: Installing the package
- **WHEN** a user runs `npm install -g jen-ai` with Node 26
- **THEN** `jen` is on their path and `jen help` prints the usage, with no other package installed

#### Scenario: Publishing from a checkout
- **WHEN** someone runs `npm publish` in a checkout
- **THEN** npm refuses, since the package is private

#### Scenario: The package's license
- **WHEN** a user runs `npm view jen-ai license`
- **THEN** it prints `Apache-2.0`, and the installed package holds `LICENSE` and `NOTICE`
