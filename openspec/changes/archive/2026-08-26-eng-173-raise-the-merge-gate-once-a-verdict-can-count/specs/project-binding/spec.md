## MODIFIED Requirements

### Requirement: Binding verifies the merge gate and changes it only on explicit confirmation

Binding SHALL verify that the repository's default branch carries the protection the `pipeline-identity` capability requires — at least one approving review, with nothing raising the effective requirement above one approval from a non-author — and SHALL report what it finds.

A branch may be governed by a ruleset, by classic branch protection, by both, or by neither, and these are independent mechanisms. Binding SHALL read both before reporting, because the classic endpoint answers `404 Branch not protected` for a branch governed only by a ruleset: a successful read whose answer is *no gate* on a branch that is actively gated. Either mechanism carrying the requirement satisfies it.

Binding SHALL read the configuration that raises the effective approving-review requirement and not only the configured count, and SHALL report a branch that raises it above one approval from a non-author as not satisfying the gate. It SHALL read that configuration as a class rather than as a fixed list of setting names: a setting the host has added since binding was written raises the effective requirement exactly as a named one does, and an enumeration reports a gate satisfied on a branch where delivery cannot merge. Where binding cannot determine a setting's effect on the pipeline's own pull requests, it SHALL report that setting as undetermined and SHALL NOT report the gate as satisfied on the strength of the configured count alone. Where a recorded observation binding carries establishes a setting's reach, binding SHALL report that setting as settled by the observation and SHALL cite it with the host, date, and vehicle it was made against, rather than reporting it as undetermined or restating it as a conclusion about the setting. Undetermined remains the report for a setting no observation covers. Without this, the report has no exit at binding time for a setting that is on by default and settled only by observing a pull request the pipeline opened: a project being bound has never opened one, so every first run would report the gate unsatisfied with no move available that changes it.

When the protection is absent or insufficient, binding SHALL present the exact change it would make and SHALL apply it only after the user explicitly agrees. When the user declines, binding SHALL report the gate as outstanding, SHALL state what would satisfy it, and SHALL NOT report the project as ready for the pipeline.

Binding SHALL read which actors may bypass the requirement, and SHALL report the gate as insufficient when any of the pipeline's roles holds a bypass, however the approving-review count is set. A role that can bypass the gate is a role the gate does not constrain. This is a distinct failure from an absent or weak requirement: every other reading is correct and the requirement is inert, so a check that stops at the count answers the wrong question. Bypass actors are carried by both mechanisms — a ruleset's bypass list and classic protection's pull-request bypass allowances — and SHALL be read on whichever is in force.

Binding SHALL NOT alter protection the repository already carries beyond what the gate requires, and SHALL NOT remove an existing human bypass. A merge policy governs a repository jen does not own: tightening it silently is an intrusion, and leaving it unmentioned makes the review stage decorative.

#### Scenario: The gate is already satisfied

- **WHEN** the default branch already requires at least one approving review, nothing raises the effective requirement above one approval from a non-author, and no pipeline role holds a bypass
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

#### Scenario: A setting raises the requirement beyond what a role can satisfy

- **WHEN** the default branch requires one approving review and carries a setting that raises the effective requirement above one approval from a non-author
- **THEN** binding reports the gate as insufficient
- **AND** does not report it as satisfied on the strength of the configured count

#### Scenario: A setting binding does not recognise governs the branch

- **WHEN** the branch carries a setting affecting the approving-review requirement whose effect on the pipeline's pull requests binding cannot determine
- **THEN** binding reports that setting as undetermined
- **AND** does not report the gate as satisfied

#### Scenario: A recorded observation covers the setting

- **WHEN** the branch carries a setting bearing on the approving-review requirement whose reach a recorded observation establishes on the same host
- **THEN** binding reports it as settled by that observation, cited with when and against what it was made
- **AND** does not report that setting as undetermined
- **AND** does not restate the observation as a conclusion about the setting

#### Scenario: A project being bound has no pull request of its own to observe

- **WHEN** binding meets such a setting on a project that has never opened a pipeline pull request
- **THEN** binding does not require an observation the project cannot yet make in order to report the gate

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
