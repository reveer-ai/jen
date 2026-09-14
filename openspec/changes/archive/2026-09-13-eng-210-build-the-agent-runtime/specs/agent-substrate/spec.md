## REMOVED Requirements

### Requirement: The substrate adds no dependency and no package manifest

**Reason**: The requirement named the condition of its own supersession — *"If the substrate later requires a dependency the repository does not carry, or is to be published separately, it SHALL gain its own manifest in the change that makes either true"* — and this is that change. The runtime reasons through an OpenAI-compatible client, which is a dependency the repository does not carry and has no reason to: it is excluded from the published package, so a client declared at the root would install for everyone who installs the CLI, to support code the package does not contain.

Removed rather than narrowed because the half that survives cannot be expressed as a modification. A `MODIFIED` requirement replaces its whole block and may not drop a scenario the current spec still has, so narrowing it would leave a scenario still headed *"No new manifest"* asserting that a manifest exists — a heading that contradicts its own body, permanently, to preserve an identity whose stated purpose has been served.

**Migration**: Nothing is lost but the prohibition that has expired. The exclusion that is still true and still load-bearing — that nothing the substrate depends on reaches the repository's manifest — is stated by the requirement that replaces it, which carries the reasoning for it as well: a manifest is warranted by a dependency and by nothing else. Its scenario *A substrate dependency does not reach the repository's manifest* asserts exactly what *No new dependency* asserted, and `manifest.test.ts` covers it.

## ADDED Requirements

### Requirement: The substrate carries its own manifest and declares its own dependencies

The substrate SHALL carry a package manifest of its own, declaring the dependencies its code requires and the entry points it provides. A dependency required by the substrate SHALL be declared there and SHALL NOT be added to the repository's manifest.

This is what keeps the requirement above — that the repository's `package.json` be left unchanged on the substrate's account — satisfiable rather than merely aspirational. The substrate is excluded from the repository's published package, so a dependency of the substrate's declared at the root would be installed by everyone who installs the CLI, to support code the package does not contain. The exclusion is only real if it extends to what the substrate depends on.

It also completes the pattern the substrate already follows with its own TypeScript and test configuration, and it is the shape the substrate needs independently: its runtime is installed into an agent's sandbox image rather than delivered through the CLI's published package, and an image installs a package that declares what it needs.

A manifest is warranted by a dependency and by nothing else, which is why the substrate carried none until now — its sandbox driver reaches the container runtime by running that runtime's command-line client as a subprocess rather than through a client library, and nothing else it did needed anything the repository was not already carrying. The runtime's model client is the first thing that does. The rule the substrate is held to has not changed, only which side of it the substrate falls on: a dependency it does not have is one it does not declare anywhere.

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
