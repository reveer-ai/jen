## ADDED Requirements

### Requirement: Binding refreshes what jen derives from the registry

Binding SHALL finish by refreshing the managed files that carry values resolved from the registry, so that a project which has just been bound has a runner configured to poll it.

Binding is what fills the registry in, and the files jen derives from it are written before that happens: an installation writes them with nothing to resolve. Leaving the refresh to whenever the project next updates would leave a bound project whose runner still polls nothing, which is a state that looks finished and is not.

Binding SHALL confirm that the values reached the files that carry them, and SHALL report which ones did rather than reporting only that it refreshed. A refresh that resolved nothing SHALL be reported as such, naming what the registry is missing.

#### Scenario: A project is bound for the first time

- **WHEN** binding records the tracker team and project in the registry
- **THEN** it refreshes the managed files derived from them
- **AND** the scheduled runner's configuration names the project that was just bound

#### Scenario: The binding is re-run

- **WHEN** binding is re-run against a project that is already bound
- **THEN** it refreshes the derived files again
- **AND** reports them as already correct where nothing changed

#### Scenario: The refresh resolves nothing

- **WHEN** the refresh runs and the registry supplies no tracker team or project
- **THEN** binding reports that the derived files resolved nothing
- **AND** names what the registry is missing
