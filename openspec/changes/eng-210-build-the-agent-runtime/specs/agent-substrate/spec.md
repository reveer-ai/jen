## ADDED Requirements

### Requirement: The substrate carries its own manifest and declares its own dependencies

The substrate SHALL carry a package manifest of its own, declaring the dependencies its code requires and the entry points it provides. A dependency required by the substrate SHALL be declared there and SHALL NOT be added to the repository's manifest.

This is what keeps the requirement above — that the repository's `package.json` be left unchanged on the substrate's account — satisfiable rather than merely aspirational. The substrate is excluded from the repository's published package, so a dependency of the substrate's declared at the root would be installed by everyone who installs the CLI, to support code the package does not contain. The exclusion is only real if it extends to what the substrate depends on.

It also completes the pattern the substrate already follows with its own TypeScript and test configuration, and it is the shape the substrate needs independently: its runtime is installed into an agent's sandbox image rather than delivered through the CLI's published package, and an image installs a package that declares what it needs.

A dependency the substrate declares SHALL be pinned to an exact version. Nothing automated runs the substrate's tests, so a transitively-updated dependency would not be caught by any check before it was noticed by hand.

#### Scenario: A substrate dependency does not reach the repository's manifest

- **WHEN** the substrate takes on a dependency
- **THEN** it is declared in the substrate's own manifest
- **AND** the repository's manifest is unchanged

#### Scenario: The published package is unaffected by what the substrate needs

- **WHEN** the package is packed and its dependencies are resolved
- **THEN** nothing the substrate depends on is among them
- **AND** no path under the substrate's root appears in the tarball

#### Scenario: The substrate's entry points are its own

- **WHEN** the substrate provides an executable entry point
- **THEN** it is declared by the substrate's manifest
- **AND** it is not declared as a subcommand of the repository's CLI

#### Scenario: Substrate dependencies are pinned

- **WHEN** the substrate's manifest is read
- **THEN** each dependency it declares names an exact version
