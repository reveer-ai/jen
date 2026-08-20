## MODIFIED Requirements

### Requirement: The pipeline's statuses are verified, never created or mapped

Binding SHALL verify that the tracker's team carries every status the `task-pipeline` capability names — the status that triggers each stage, together with `Backlog`, `Todo`, and `Pending`. Comparison SHALL be case-insensitive, so a team whose statuses differ from the workflow document only in capitalization is already correct.

Binding SHALL NOT create a status, rename one, delete one, or record any mapping from a status the workflow names onto a differently-named status the team already has. A bound project's tracker carries the statuses the workflow names; the workflow does not adapt to the tracker's.

When a status is absent, binding SHALL report exactly which ones are missing and SHALL NOT report the project as ready for the pipeline. Reporting a missing status SHALL NOT prevent the rest of the binding from completing, so that a re-run resumes rather than restarts.

A project already bound before `Pending` joined the pipeline SHALL report it as missing on the next binding run, in the same way as any other absent status, rather than being reported as ready.

#### Scenario: Every status is present

- **WHEN** the team carries all of the statuses the pipeline names
- **THEN** binding reports the statuses as satisfied
- **AND** creates, renames, and deletes nothing on the team

#### Scenario: Statuses differ only in capitalization

- **WHEN** the team's statuses are named `in design` and `todo` while the workflow document writes `In Design` and `Todo`
- **THEN** they are treated as present
- **AND** the user is not asked to rename anything

#### Scenario: A status is missing

- **WHEN** the team carries no status corresponding to `In Testing`
- **THEN** binding names `In Testing` as missing
- **AND** does not report the project as ready for the pipeline
- **AND** creates no status

#### Scenario: A previously bound project lacks `Pending`

- **WHEN** binding runs against a project bound before `Pending` was part of the pipeline
- **THEN** it names `Pending` as missing
- **AND** does not report the project as ready for the pipeline
- **AND** creates no status

#### Scenario: A differently-named equivalent is not adopted

- **WHEN** the team carries a status named `Code Review` and none corresponding to `In Review`
- **THEN** binding reports `In Review` as missing
- **AND** records no mapping between the two
- **AND** leaves `Code Review` untouched

#### Scenario: No mapping is recorded anywhere

- **WHEN** binding has completed against any team
- **THEN** neither `registry.yaml` nor any other file records a translation from the workflow's status names to the tracker's
