## MODIFIED Requirements

### Requirement: Binding verifies the merge gate and changes it only on explicit confirmation

Binding SHALL verify that the repository's default branch carries the protection the `pipeline-identity` capability requires — at least one approving review, with nothing raising the effective requirement above one approval from a non-author — and SHALL report what it finds.

A branch may be governed by a ruleset, by classic branch protection, by both, or by neither, and these are independent mechanisms. Binding SHALL read both before reporting, because the classic endpoint answers `404 Branch not protected` for a branch governed only by a ruleset: a successful read whose answer is *no gate* on a branch that is actively gated. Either mechanism carrying the requirement satisfies it.

Binding SHALL read the configuration that raises the effective approving-review requirement and not only the configured count, and SHALL report a branch that raises it above one approval from a non-author as not satisfying the gate. It SHALL read that configuration as a class rather than as a fixed list of setting names: a setting the host has added since binding was written raises the effective requirement exactly as a named one does, and an enumeration reports a gate satisfied on a branch where delivery cannot merge. Where binding cannot determine a setting's effect on the pipeline's own pull requests, it SHALL report that setting as undetermined and SHALL NOT report the gate as satisfied on the strength of the configured count alone. Where a recorded observation binding carries establishes a setting's reach, binding SHALL report that setting as settled by the observation and SHALL cite it with the host, date, and vehicle it was made against, rather than reporting it as undetermined or restating it as a conclusion about the setting. Undetermined remains the report for a setting no observation covers. Without this, the report has no exit at binding time for a setting that is on by default and settled only by observing a pull request the pipeline opened: a project being bound has never opened one, so every first run would report the gate unsatisfied with no move available that changes it.

When the protection is absent or insufficient, binding SHALL present the exact change it would make and SHALL apply it only after the user explicitly agrees. When the user declines, binding SHALL report the gate as outstanding, SHALL state what would satisfy it, and SHALL NOT report the project as ready for the pipeline.

Binding SHALL read which actors may bypass the requirement, and SHALL report the gate as insufficient when any of the pipeline's roles holds a bypass, however the approving-review count is set. A role that can bypass the gate is a role the gate does not constrain. This is a distinct failure from an absent or weak requirement: every other reading is correct and the requirement is inert, so a check that stops at the count answers the wrong question. Bypass actors are carried by both mechanisms — a ruleset's bypass list and classic protection's pull-request bypass allowances — and SHALL be read on whichever is in force.

Binding SHALL attribute a bypass actor to the application it names before judging whether it is one of the pipeline's roles, and SHALL NOT decide that question from the actor's type. An actor recorded only as an application, carrying an identifier and no name, is indistinguishable from a role by its type alone: reading such an actor as a role reports a branch that is correctly configured as insufficient and proposes removing an actor that was never a hazard, and reading it as not a role reports the gate satisfied on a branch where a role holds a bypass. The second is the graver failure, because every other reading remains correct while the requirement is inert.

Binding SHALL attribute such an actor by resolving its identifier against the applications installed on the repository's organization, and SHALL compare what that resolves to against the applications `registry.yaml` records for the three roles. Resolving before comparing SHALL yield the application's name, so that binding reports which application holds a bypass rather than only whether one does — a bypass held by an application that is not a pipeline role is a fact the user needs stated, not suppressed. Resolution SHALL match an identifier against every identifier the organization's listing carries for an installation, so that attribution does not depend on which of the host's identifier spaces a bypass list reports in.

Binding SHALL report an actor it cannot attribute as unattributed, SHALL name it, and SHALL NOT report the gate as satisfied while one stands. An application absent from the organization's listing, or a listing binding could not read, leaves the question unanswered rather than answered in the safe direction, and reporting an unattributed actor as not a role is the reading that produces green checks over an inert requirement. This obligation SHALL arise only where the bypass list carries an application at all: a list carrying no application has nothing to attribute, and binding SHALL NOT withhold the gate on the strength of a resolution it never needed to make.

Where a mechanism reports its bypass actors already named, binding SHALL take that name and SHALL NOT resolve it a second time. The attribution step answers a question only an unnamed actor poses.

An actor recorded as a human SHALL NOT require attribution, since the rule turns on the actor being a human rather than on which human.

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

#### Scenario: An unnamed application on the bypass list is attributed before it is judged

- **WHEN** the bypass list carries an application recorded as an identifier with no name
- **THEN** binding resolves that identifier against the applications installed on the organization
- **AND** does not decide whether it is a pipeline role from the actor's type

#### Scenario: The attributed application is a pipeline role

- **WHEN** an actor resolves to an application that `registry.yaml` records for one of the three roles
- **THEN** binding reports the gate as insufficient
- **AND** names which role holds the bypass

#### Scenario: The attributed application is not a pipeline role

- **WHEN** an actor resolves to an application the registry records for no role
- **THEN** binding does not report the gate as insufficient on that account
- **AND** names the application it found holding a bypass

#### Scenario: An application on the bypass list cannot be attributed

- **WHEN** an actor's identifier resolves to no installation on the organization
- **THEN** binding reports that actor as unattributed and names it
- **AND** does not report the gate as satisfied
- **AND** does not report the actor as not a pipeline role

#### Scenario: The organization's installations cannot be read

- **WHEN** the bypass list carries an application and binding cannot read the organization's installations
- **THEN** binding reports that actor as unattributed
- **AND** does not report the gate as satisfied

#### Scenario: Nothing on the bypass list needs attributing

- **WHEN** the bypass list carries no application
- **THEN** binding does not withhold the gate for want of an attribution
- **AND** a listing it could not read does not affect the report

#### Scenario: The identifier space of the bypass list is not assumed

- **WHEN** binding resolves an actor's identifier
- **THEN** it matches against every identifier the organization's listing carries for an installation
- **AND** attribution does not depend on which identifier the bypass list reported

#### Scenario: A mechanism reports its bypass actors already named

- **WHEN** the mechanism in force carries the application's name alongside its identifier
- **THEN** binding judges it on that name
- **AND** performs no second resolution

#### Scenario: Unrelated protection is preserved

- **WHEN** binding applies the gate to a branch already carrying other protections
- **THEN** those protections remain
- **AND** an existing human bypass is left in place
