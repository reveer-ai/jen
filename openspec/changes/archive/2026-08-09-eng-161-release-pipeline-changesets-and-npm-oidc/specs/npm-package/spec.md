## MODIFIED Requirements

### Requirement: Package identity

The repository SHALL declare a `package.json` publishable to the npm registry, with:

- `name` set to `@reveer/jen`. If that scope proves unavailable at registration time, the next rung of the ladder `@reveer` → `@reveer-ai` → `@reveerdev` SHALL be taken without further consultation.
- `bin` mapping the command `jen` to the CLI entry point, so the scope appears in the install line and nowhere else.
- `publishConfig.access` set to `public`. Scoped packages default to private, and publishing without this fails with an error that reads like a billing problem rather than a configuration one.
- `engines.node` pinning the minimum Node version the CLI is built and tested against. This is the version an adopter needs to run jen, and it is independent of the version the release pipeline runs to publish it.
- `type` set to `module`.
- `repository` naming the canonical source repository, with `url` in normalized `https://` form ending in `.git` — not the `git+https://` form. This field is load-bearing rather than decorative: credential-free publishing matches the registry's record of the package against the repository that is publishing it, and a denormalized URL is one of the ways that match fails.

#### Scenario: The manifest declares a publishable scoped package

- **WHEN** `package.json` is read
- **THEN** `name` is `@reveer/jen`, `bin.jen` points at the built CLI entry, `publishConfig.access` is `public`, and `engines.node` names a minimum version

#### Scenario: The binary is invocable under its bare name

- **WHEN** the package is installed and `jen` is invoked
- **THEN** the CLI entry point declared in `bin` runs

#### Scenario: The manifest names its source repository

- **WHEN** `package.json` is read
- **THEN** `repository.url` names the canonical repository and begins with `https://` rather than `git+https://`
