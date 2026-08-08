## ADDED Requirements

### Requirement: Package identity

The repository SHALL declare a `package.json` publishable to the npm registry, with:

- `name` set to `@reveer/jen`. If that scope proves unavailable at registration time, the next rung of the ladder `@reveer` → `@reveer-ai` → `@reveerdev` SHALL be taken without further consultation.
- `bin` mapping the command `jen` to the CLI entry point, so the scope appears in the install line and nowhere else.
- `publishConfig.access` set to `public`. Scoped packages default to private, and publishing without this fails with an error that reads like a billing problem rather than a configuration one.
- `engines.node` pinning the minimum Node version the CLI is built and tested against.
- `type` set to `module`.

#### Scenario: The manifest declares a publishable scoped package

- **WHEN** `package.json` is read
- **THEN** `name` is `@reveer/jen`, `bin.jen` points at the built CLI entry, `publishConfig.access` is `public`, and `engines.node` names a minimum version

#### Scenario: The binary is invocable under its bare name

- **WHEN** the package is installed and `jen` is invoked
- **THEN** the CLI entry point declared in `bin` runs

### Requirement: OpenSpec is depended on, never vendored

The package SHALL declare OpenSpec as a dependency and SHALL NOT contain a copy of any file OpenSpec generates. jen SHALL delegate to `openspec init` rather than reproducing OpenSpec's file list, so that OpenSpec's version can move without any change to jen's payload.

#### Scenario: OpenSpec is a declared dependency

- **WHEN** `package.json` is read
- **THEN** OpenSpec appears among the dependencies

#### Scenario: No OpenSpec-generated file is shipped

- **WHEN** the published tarball is inspected
- **THEN** it contains no `openspec-*` skill and no `opsx` command file

### Requirement: `prepack` stages the payload

A `prepack` script SHALL compile the CLI to `dist/` and stage the payload into `dist/templates/`, placing the six stage skills at `dist/templates/skills/<name>/SKILL.md` and the workflow document at `dist/templates/AGENTS.md`. Staging SHALL apply the ownership stamp defined by the `managed-payload` capability.

The staged tree SHALL be generated, never committed, and SHALL NOT be hand-edited. Its layout SHALL be tool-neutral: no path within it SHALL be named for a particular assistant.

Staging SHALL be deterministic — the same repository state produces byte-identical staged output.

#### Scenario: Staging produces the payload

- **WHEN** `prepack` runs
- **THEN** `dist/templates/skills/` contains exactly six skill directories, each holding a stamped `SKILL.md`
- **AND** `dist/templates/AGENTS.md` matches the repository's root `AGENTS.md` in content

#### Scenario: The staged layout names no assistant

- **WHEN** the paths under `dist/templates/` are listed
- **THEN** no path segment is `.claude`, `.github`, `.codex`, or any other assistant directory

#### Scenario: Staging is repeatable

- **WHEN** `prepack` runs twice against the same repository state
- **THEN** the staged files are byte-identical between runs

#### Scenario: The staged tree is not tracked

- **WHEN** the repository's tracked files are listed
- **THEN** no path under `dist/` appears

### Requirement: The tarball contains exactly the payload

`files` SHALL be set so that the published tarball contains `dist/` and nothing else. The tarball SHALL contain the compiled CLI and the staged payload, and SHALL NOT contain TypeScript sources, tests, the repository's `.claude/` directory, `openspec/`, or `src/`.

#### Scenario: The tarball carries the intended contents

- **WHEN** `npm pack` is run and the resulting tarball is listed
- **THEN** it contains the compiled CLI entry point and all of `dist/templates/`

#### Scenario: The tarball excludes everything else

- **WHEN** the resulting tarball is listed
- **THEN** it contains no `.ts` source file, no test file, and no path under `.claude/`, `openspec/`, or `src/`

### Requirement: Build and typecheck are enforced in CI

The repository SHALL provide a build and a typecheck command, and CI SHALL run both on every pull request. A failure in either SHALL fail the check.

#### Scenario: CI rejects a type error

- **WHEN** a pull request introduces a type error in the CLI source
- **THEN** the CI check fails

#### Scenario: CI rejects a broken build

- **WHEN** a pull request leaves the package unable to compile to `dist/`
- **THEN** the CI check fails
