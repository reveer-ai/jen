## MODIFIED Requirements

### Requirement: Changes and specs live under a single `openspec/` directory

The repository SHALL hold one `openspec/` directory at its root, containing in-flight changes, archived changes, and the specs they resolve to. A project SHALL NOT carry more than one, whatever else the repository holds and however many things deploy out of it.

The directory sits at the repository root rather than beside the sources it describes, alongside the rest of what the workflow owns, so that a project's specs are one set regardless of how its sources under `src/` are organized.

#### Scenario: A change is created in an adopted project

- **WHEN** a change is created in a project that has adopted the workflow
- **THEN** it is written under the single root `openspec/`
- **AND** no second `openspec/` directory is created for a subtree

#### Scenario: A change is created in a fork

- **WHEN** a change is created in a git fork of an adopted project's repository
- **THEN** it is written under that repository's single root `openspec/`
- **AND** forking the repository neither adds a second `openspec/` nor changes where changes are written

#### Scenario: A change is archived

- **WHEN** a change completes
- **THEN** its delta specs resolve into the specs under `openspec/`
- **AND** the change moves into the archive

#### Scenario: Sources are organized without splitting the specs

- **WHEN** a project's sources under `src/` are divided into several deployable parts
- **THEN** the specs describing them remain in the one root `openspec/`
