## ADDED Requirements

### Requirement: The package declares and ships a license

`package.json` SHALL declare the license the package is published under as an SPDX identifier, and the repository SHALL carry the corresponding `LICENSE` file at its root. The declaration and the file SHALL name the same license.

The declaration SHALL NOT be `UNLICENSED`. That value states that no rights are granted, and jen is published publicly and installable without authentication; declaring it of a package anyone may download is a contradiction rather than a conservative default.

The `LICENSE` file SHALL be present in the published tarball. The registry includes it irrespective of the manifest's `files` field, so no packaging change achieves this — but its presence SHALL be verified against a packed tarball rather than assumed from that behavior.

#### Scenario: The manifest declares a real license

- **WHEN** `package.json` is read
- **THEN** `license` holds an SPDX identifier
- **AND** it is not `UNLICENSED`

#### Scenario: The license file matches the declaration

- **WHEN** the repository root is listed
- **THEN** a `LICENSE` file is present
- **AND** the license it states is the one `package.json` declares

#### Scenario: The license reaches the adopter

- **WHEN** the published tarball is inspected
- **THEN** `LICENSE` is among its entries

## MODIFIED Requirements

### Requirement: Package identity

The repository SHALL declare a `package.json` publishable to the npm registry, with:

- `name` set to `@reveer/jen`. The scope was registered at that name, so no fallback applies.
- `bin` mapping the command `jen` to the CLI entry point, so the scope appears in the install line and nowhere else.
- `publishConfig.access` set to `public`. Scoped packages default to private, and publishing without this fails with an error that reads like a billing problem rather than a configuration one.
- `engines.node` pinning the minimum Node version the CLI is built and tested against. This is the version an adopter needs to run jen, and it is independent of the version the release pipeline runs to publish it.
- `type` set to `module`.
- `repository` naming the canonical source repository, with `url` in normalized `https://` form ending in `.git` — not the `git+https://` form. This field is load-bearing rather than decorative: credential-free publishing matches the registry's record of the package against the repository that is publishing it, and a denormalized URL is one of the ways that match fails.
- `keywords` naming the terms someone looking for this kind of tool would search. A package with none is reachable only by its exact name.

#### Scenario: The manifest declares a publishable scoped package

- **WHEN** `package.json` is read
- **THEN** `name` is `@reveer/jen`, `bin.jen` points at the built CLI entry, `publishConfig.access` is `public`, and `engines.node` names a minimum version

#### Scenario: The binary is invocable under its bare name

- **WHEN** the package is installed and `jen` is invoked
- **THEN** the CLI entry point declared in `bin` runs

#### Scenario: The manifest names its source repository

- **WHEN** `package.json` is read
- **THEN** `repository.url` names the canonical repository and begins with `https://` rather than `git+https://`

#### Scenario: The package is discoverable by search

- **WHEN** `package.json` is read
- **THEN** `keywords` is present and non-empty

### Requirement: The tarball contains exactly the payload

`files` SHALL select `dist/` and nothing else, so that the only paths the manifest contributes to the tarball are the compiled CLI and the staged payload. The tarball SHALL NOT contain TypeScript sources, tests, the repository's `.claude/` directory, `openspec/`, or `src/`.

Beyond what `files` selects, the registry always includes `package.json`, the `README.md` it publishes as the package's front page, and the `LICENSE` file. Their presence is not a defect and SHALL NOT be treated as one; `files` cannot exclude them, and both the documentation and the license are required to reach the adopter.

#### Scenario: The tarball carries the intended contents

- **WHEN** `npm pack` is run and the resulting tarball is listed
- **THEN** it contains the compiled CLI entry point and all of `dist/templates/`

#### Scenario: The tarball excludes everything else

- **WHEN** the resulting tarball is listed
- **THEN** it contains no `.ts` source file, no test file, and no path under `.claude/`, `openspec/`, or `src/`

#### Scenario: The always-included files are present

- **WHEN** the resulting tarball is listed
- **THEN** `README.md` and `LICENSE` are among its entries, though `files` names neither
