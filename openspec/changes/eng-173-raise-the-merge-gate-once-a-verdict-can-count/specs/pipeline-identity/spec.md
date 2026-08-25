## MODIFIED Requirements

### Requirement: The default branch admits only an approved change

The default branch SHALL require at least one approving review before a pull request may merge.

No branch configuration SHALL raise the **effective** approving-review requirement above one approval from an identity other than the pull request's author. One approval from `deliver` is the most the pipeline can produce, so a branch demanding more is unsatisfiable by any pipeline role rather than merely strict: every task parks in delivery waiting on an approval nothing can give, and the pipeline reads as stalled rather than as misconfigured.

This is stated as a bound on the effective requirement rather than as a list of the settings that breach it. The settings belong to the git host and the host adds to them, so a list is correct when written and silently incomplete afterward — which is how a gate comes to read as satisfied while the capability it stands for is absent. Any configuration that raises the effective count breaches this requirement whether or not it is named below.

Four are known to breach it:

- **Requiring the approval to postdate the most recent reviewable push.** `deliver-task` pushes the spec sync and the archive before merging, so `deliver` is the last pusher on every pull request the pipeline completes and cannot approve its own push. `design` authored the pull request and the host refuses its review outright, and `dev` is no longer running. Nothing is left that can approve.
- **Dismissing existing approvals on push.** The same dead end by another route: delivery's archive push dismisses the approval it is about to merge on.
- **Requiring an extra approval for a pull request the host treats as unattributed.** It raises the effective count to one more than configured wherever it applies, and the pipeline's pull requests are opened by an application acting as itself rather than on behalf of a person. It SHALL be off wherever it applies to the pipeline's own pull requests.
- **Naming required reviewers by team.** An application cannot join a team, so every pipeline role sits outside a team-scoped requirement.

Whether a given setting applies to the pipeline's own pull requests SHALL be established by observing a pull request the pipeline opened, not by reading the host's documentation for it. A setting documented for the host's own assistant may be implemented against any application acting as itself, and a setting that has no effect at an approving-review count of zero leaves no evidence on a repository that has never raised the count — so the reading and the behaviour can differ with nothing on the repository to show it.

The requirement excludes the pull request's author, which the git host enforces on its own. It does not exclude any other role, and the host offers no setting that would: its exclusions are subtractive and cannot name an approver. Which role approves is therefore governed by the requirement below rather than by the branch.

No role SHALL be permitted to bypass the requirement. A human MAY retain a bypass, since somebody has to be able to break the glass.

#### Scenario: The authoring role attempts to approve

- **WHEN** an approval is submitted under the role that opened the pull request
- **THEN** the git host refuses it

#### Scenario: A change reaches delivery unreviewed

- **WHEN** delivery attempts to merge a pull request carrying no approving review
- **THEN** the merge is refused

#### Scenario: A change reaches delivery reviewed

- **WHEN** delivery has pushed the spec sync and archive to a pull request already approved by `deliver`
- **THEN** the approval still stands and the merge is permitted

#### Scenario: A role attempts to bypass

- **WHEN** any of the three roles attempts to merge without satisfying the requirement
- **THEN** it cannot, because no role holds a bypass

#### Scenario: A setting raises the effective requirement above the bound

- **WHEN** the branch carries a configuration under which a pull request the pipeline opened needs more than one approval from a non-author
- **THEN** the branch does not satisfy this requirement
- **AND** a configured approving-review count of one does not make it satisfied

#### Scenario: The host introduces a setting this requirement does not name

- **WHEN** a branch setting not named here raises the effective requirement above one approval from a non-author
- **THEN** it breaches this requirement on the same terms as the settings that are named

#### Scenario: A setting's reach is read rather than observed

- **WHEN** a setting's documentation scopes it to the host's own assistant and the setting is live on the branch
- **THEN** that documentation alone does not establish that it leaves the pipeline's pull requests alone
- **AND** what establishes it is a pull request the pipeline opened passing the gate on one approval
