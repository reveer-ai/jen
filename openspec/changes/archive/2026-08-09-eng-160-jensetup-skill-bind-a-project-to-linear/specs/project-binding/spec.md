## Purpose

Defines what it means for an installed project to be bound to the tracker its stages drive — what must be true before the pipeline can run, what the binding step may change and what it may only report, what it records in the registry, and why running it again is always safe.

## ADDED Requirements

### Requirement: Binding a project to its tracker is a skill, not a command

The step that binds an installed project to its tracker SHALL be a skill jen ships into the project, invoked by the user after installation. It SHALL NOT be a subcommand of the CLI.

The CLI SHALL remain free of any tracker client, stored credential, or prompt: binding needs a conversation, judgment about which team and project the work belongs to, and credentialed access to a third-party service, and none of those may enter a command that must stay deterministic and safe to run unattended in CI.

#### Scenario: The CLI does not reach the tracker

- **WHEN** `jen init` or `jen update` runs
- **THEN** no request is made to any tracker
- **AND** no tracker credential is read or required

#### Scenario: Binding is available in an installed project

- **WHEN** `jen init` has installed the payload into a project
- **THEN** the binding skill is present among the installed skills
- **AND** invoking it is the user's step, not something installation performed

### Requirement: An unreachable tracker stops the binding before anything changes

Binding SHALL confirm it can reach the tracker before it changes anything. When the tracker cannot be reached — no integration is configured, or access is refused — it SHALL report that plainly, name what is missing, and make no change to the tracker or to the project.

#### Scenario: No tracker integration is configured

- **WHEN** binding runs in a project whose assistant has no Linear integration available
- **THEN** it reports that the tracker cannot be reached and what would make it reachable
- **AND** no label is created
- **AND** `registry.yaml` is unchanged

### Requirement: Binding confirms the tracker's identity rather than inferring it

Binding SHALL establish which team and which project the repository's work is tracked in, and SHALL confirm that with the user before recording it. It SHALL NOT guess an identifier, and SHALL NOT create a team or a project.

#### Scenario: The team and project are confirmed

- **WHEN** binding has a candidate team and project
- **THEN** it presents them to the user for confirmation before recording them

#### Scenario: No candidate can be established

- **WHEN** binding cannot determine which team or project the repository belongs to
- **THEN** it asks the user rather than selecting one
- **AND** records nothing until the user has answered

### Requirement: The pipeline's statuses are verified, never created or mapped

Binding SHALL verify that the tracker's team carries every status the `task-pipeline` capability names — the status that triggers each stage, together with `Backlog` and `Todo`. Comparison SHALL be case-insensitive, so a team whose statuses differ from the workflow document only in capitalization is already correct.

Binding SHALL NOT create a status, rename one, delete one, or record any mapping from a status the workflow names onto a differently-named status the team already has. A bound project's tracker carries the statuses the workflow names; the workflow does not adapt to the tracker's.

When a status is absent, binding SHALL report exactly which ones are missing and SHALL NOT report the project as ready for the pipeline. Reporting a missing status SHALL NOT prevent the rest of the binding from completing, so that a re-run resumes rather than restarts.

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

#### Scenario: A differently-named equivalent is not adopted

- **WHEN** the team carries a status named `Code Review` and none corresponding to `In Review`
- **THEN** binding reports `In Review` as missing
- **AND** records no mapping between the two
- **AND** leaves `Code Review` untouched

#### Scenario: No mapping is recorded anywhere

- **WHEN** binding has completed against any team
- **THEN** neither `registry.yaml` nor any other file records a translation from the workflow's status names to the tracker's

### Requirement: The labels the workflow applies are created when absent

Binding SHALL ensure the tracker carries the labels the workflow applies to the issues it creates — `epic` for an epic and `task` for a task — creating any that are absent.

An existing label of that name SHALL be left exactly as it is. Binding SHALL NOT create a second label of a name that already exists, and SHALL NOT alter an existing label's colour, description, or grouping.

#### Scenario: A missing label is created

- **WHEN** the team carries no `task` label
- **THEN** binding creates it

#### Scenario: An existing label is left alone

- **WHEN** the team already carries an `epic` label with its own colour and description
- **THEN** binding neither duplicates it nor changes it

### Requirement: Binding records the tracker in the registry

Binding SHALL record the confirmed tracker in `registry.yaml` as a resource that declares, at minimum, that it is a project-management resource, which provider it belongs to, and the team and project it names — the shape the stages read when they need to know what they are acting on.

Binding SHALL NOT overwrite a registry entry that already records a different tracker without the user's confirmation.

#### Scenario: The stub is filled in

- **WHEN** binding completes against a project whose `registry.yaml` is the unfilled stub `jen init` wrote
- **THEN** `registry.yaml` declares a project-management resource naming the provider, the team, and the project

#### Scenario: A conflicting entry is not silently replaced

- **WHEN** `registry.yaml` already records a tracker naming a different team, and binding is run against another
- **THEN** the user is asked before the existing entry is changed

#### Scenario: Unrelated registry content survives

- **WHEN** `registry.yaml` declares resources other than the tracker
- **THEN** binding leaves them unchanged

### Requirement: Binding is re-runnable and reports what is already correct

Running binding again against an already-bound project SHALL make no change and SHALL report each check as already satisfied rather than performing it a second time.

A run that ended with something outstanding SHALL be resumable by running it again: the parts already done SHALL be recognised as done, and only what remains SHALL be acted on.

#### Scenario: A second run changes nothing

- **WHEN** binding runs twice in succession against a project whose tracker and registry are unchanged
- **THEN** the second run creates no label, writes no change to `registry.yaml`, and reports each check as already satisfied

#### Scenario: A partially bound project resumes

- **WHEN** an earlier run recorded the tracker and created the labels but reported a missing status, and that status has since been added
- **THEN** the next run recognises the registry entry and the labels as already correct
- **AND** reports the statuses as now satisfied
