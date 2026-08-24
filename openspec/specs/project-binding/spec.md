# project-binding Specification

## Purpose

Defines what it means for an installed project to be bound to the tracker its stages drive — what must be true before the pipeline can run, what the binding step may change and what it may only report, what it records in the registry, and why running it again is always safe.

## Requirements

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

### Requirement: Binding establishes the pipeline's three identities

Binding SHALL establish that the project carries the identities the `pipeline-identity` capability names — an application in the project's own organization on the git host for each of `design`, `dev`, and `deliver`, and one shared agent in its own workspace on the tracker — guiding the user through registering any that are absent.

Binding SHALL confirm with the user before registering anything, and SHALL NOT register an identity into an organization or workspace the user has not named.

Because the two surfaces expose different registration mechanics, binding SHALL NOT assume any identity can be completed in a single confirmation. Where a surface can only pre-populate a form the user must submit, binding SHALL hand the user that form and then verify the result, rather than reporting success it did not observe.

While any identity is missing, binding SHALL name which ones, and SHALL NOT report the project as ready for the pipeline. This SHALL NOT prevent the rest of the binding from completing.

#### Scenario: No identities exist yet

- **WHEN** binding runs against a project carrying none of them
- **THEN** it names the three applications and the agent as missing
- **AND** guides the user through registering each
- **AND** does not report the project as ready for the pipeline until they are complete

#### Scenario: A surface cannot complete registration unattended

- **WHEN** a surface's registration ends in a form only the user can submit
- **THEN** binding hands the user that form
- **AND** verifies the identity exists before recording it as registered

#### Scenario: The applications exist but the agent does not

- **WHEN** the project carries all three git-host applications and no tracker agent
- **THEN** binding names the tracker agent as missing
- **AND** leaves the applications untouched

#### Scenario: One role's application is missing

- **WHEN** two of the three applications are registered and the third is not
- **THEN** binding names that role's application as missing
- **AND** does not re-register the two that exist

#### Scenario: A second run finds the identities present

- **WHEN** binding runs again against a project whose identities are fully registered
- **THEN** it reports them as already satisfied
- **AND** registers nothing a second time

### Requirement: Binding records the identities without recording their secrets

Binding SHALL record each registered identity in `registry.yaml` with enough to identify which application each role corresponds to and which agent the project uses on the tracker, and with nothing more.

Binding SHALL NOT write a private key, a client secret, a token, or any other credential to `registry.yaml` or to any other file. The registry names identities; the environment supplies their credentials, and the two SHALL NOT meet on disk.

#### Scenario: An identity is registered

- **WHEN** binding completes registration of a role's application
- **THEN** `registry.yaml` names that role and identifies its application
- **AND** the credential that authenticates it appears nowhere in the repository

#### Scenario: The tracker agent is recorded once

- **WHEN** binding records the tracker agent
- **THEN** it appears once, belonging to the project rather than to any one role

#### Scenario: The registry is inspected after binding

- **WHEN** `registry.yaml` is read after a completed binding
- **THEN** it holds no secret

#### Scenario: Unrelated registry content survives identity recording

- **WHEN** binding records the identities into a registry already declaring a tracker and a repository
- **THEN** those entries are unchanged

### Requirement: Binding verifies the merge gate and changes it only on explicit confirmation

Binding SHALL verify that the repository's default branch carries the protection the `pipeline-identity` capability requires — at least one approving review — and SHALL report what it finds.

A branch may be governed by a ruleset, by classic branch protection, by both, or by neither, and these are independent mechanisms. Binding SHALL read both before reporting, because the classic endpoint answers `404 Branch not protected` for a branch governed only by a ruleset: a successful read whose answer is *no gate* on a branch that is actively gated. Either mechanism carrying the requirement satisfies it.

When the protection is absent or insufficient, binding SHALL present the exact change it would make and SHALL apply it only after the user explicitly agrees. When the user declines, binding SHALL report the gate as outstanding, SHALL state what would satisfy it, and SHALL NOT report the project as ready for the pipeline.

Binding SHALL read which actors may bypass the requirement, and SHALL report the gate as insufficient when any of the pipeline's roles holds a bypass, however the approving-review count is set. A role that can bypass the gate is a role the gate does not constrain. This is a distinct failure from an absent or weak requirement: every other reading is correct and the requirement is inert, so a check that stops at the count answers the wrong question. Bypass actors are carried by both mechanisms — a ruleset's bypass list and classic protection's pull-request bypass allowances — and SHALL be read on whichever is in force.

Binding SHALL NOT alter protection the repository already carries beyond what the gate requires, and SHALL NOT remove an existing human bypass. A merge policy governs a repository jen does not own: tightening it silently is an intrusion, and leaving it unmentioned makes the review stage decorative.

#### Scenario: The gate is already satisfied

- **WHEN** the default branch already requires at least one approving review, and no pipeline role holds a bypass
- **THEN** binding reports the gate as satisfied
- **AND** changes nothing

#### Scenario: Only one of the two protection mechanisms is read

- **WHEN** the default branch is governed by a ruleset and carries no classic branch protection
- **THEN** binding does not report the gate as absent on the strength of the classic endpoint's `404`

#### Scenario: The gate is absent and the user agrees

- **WHEN** the default branch requires no approving review, and the user agrees to the change binding presents
- **THEN** binding applies it
- **AND** reports what it changed

#### Scenario: The gate is absent and the user declines

- **WHEN** the user declines the change
- **THEN** binding applies nothing
- **AND** reports the gate as outstanding with what would satisfy it
- **AND** does not report the project as ready for the pipeline

#### Scenario: A pull request requirement exists but admits unreviewed changes

- **WHEN** the default branch requires a pull request but zero approving reviews
- **THEN** binding reports the gate as insufficient rather than present

#### Scenario: A pipeline role can bypass the requirement

- **WHEN** the default branch requires an approving review and one of the pipeline's roles holds a bypass
- **THEN** binding reports the gate as insufficient
- **AND** does not report the project as ready for the pipeline

#### Scenario: A human bypass is not a role bypass

- **WHEN** the bypass list carries a human and no pipeline role
- **THEN** binding does not report the gate as insufficient on that account

#### Scenario: Unrelated protection is preserved

- **WHEN** binding applies the gate to a branch already carrying other protections
- **THEN** those protections remain
- **AND** an existing human bypass is left in place

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

### Requirement: Binding reports the project status the halt depends on

Binding SHALL tell the user to create the project status that halts dispatch, naming it exactly and naming the category it belongs under, and SHALL state that the halt matches the name so that renaming the status disables it.

Binding SHALL NOT create that status, in keeping with the rule that binding verifies the tracker's shape and never alters it. Neither SHALL binding report it as verified: the tracker tools binding holds expose no way to read a workspace's project statuses and no way to create one, so binding SHALL report plainly that it could not check rather than implying either answer.

An absent pause status SHALL NOT prevent binding from reporting the project as ready, since the pipeline runs correctly without it. It SHALL appear in what the run leaves outstanding, because a pipeline missing only its halt is indistinguishable from one that has it until the halt is reached for.

#### Scenario: Binding reaches the project's status

- **WHEN** binding runs against a project
- **THEN** it names the pause status and the category to file it under
- **AND** states that renaming it disables the halt
- **AND** creates nothing

#### Scenario: Binding cannot verify the status

- **WHEN** binding reports on the pause status
- **THEN** it says that it could not check whether the status exists
- **AND** does not report it as present or as absent
