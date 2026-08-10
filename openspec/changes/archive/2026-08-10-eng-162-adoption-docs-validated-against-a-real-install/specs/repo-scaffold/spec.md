## MODIFIED Requirements

### Requirement: Resources are declared in a registry

All work SHALL happen in the context of resources declared in `registry.yaml`, which records each resource with its access and setup information.

The stub `jen init` writes SHALL describe the arrangement an adopted project actually has: the project's own sources tracked under `src/` in the same repository as the workflow's files. Its illustrative content SHALL NOT depict the project's sources as a separate repository cloned into `src/`, which is jen's own arrangement rather than an adopter's and contradicts the repository model the workflow document states.

Nothing in jen's repository reads the scaffold. Its content is inert text here and becomes instructions only in an installed project, so an error in it is invisible to every check jen runs on itself and SHALL be verified against an installed project rather than assumed correct.

#### Scenario: An agent starts a task

- **WHEN** an agent needs to know what it is acting on
- **THEN** it consults `registry.yaml` for the resources relevant to the task

#### Scenario: The stub describes the adopted project's own layout

- **WHEN** an adopter reads the `registry.yaml` that `jen init` wrote
- **THEN** its illustrative content shows the project's sources under `src/` in this same repository
- **AND** no example depicts them as a separately cloned repository

#### Scenario: The scaffold is checked where it takes effect

- **WHEN** the scaffold's content is validated
- **THEN** it is read as installed in a project rather than only as it sits in jen's repository

## REMOVED Requirements

### Requirement: The project's own sources live untracked under `src/`

**Reason**: The requirement asserted that `src/` is never tracked, which held only for jen's own repository. In a project that has adopted the workflow, `src/` holds that project's own sources and is precisely what the repository tracks — so as written the requirement forbade the normal case. It also duplicated `repo-layout`'s statement of what `src/` means, leaving two capabilities to disagree about it, which is how the contradiction went unnoticed.

**Migration**: `repo-layout`'s requirement *jen's own source lives at `cli/`* now states `src/`'s meaning in both repositories, including that tracked-ness is the repository's property rather than the workflow's, and that jen imposes neither arrangement because it never writes an ignore file. No behavior is lost: jen's own `src/` remains untracked, asserted there by its own scenario.
