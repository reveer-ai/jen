## ADDED Requirements

### Requirement: Binding establishes the pipeline's three identities

Binding SHALL establish that the project carries the three roles the `pipeline-identity` capability names, guiding the user through registering any that are absent — an application identity in the project's own organization on the git host, and an agent identity in its own workspace on the tracker, for each of `design`, `dev`, and `review`.

Binding SHALL confirm with the user before registering anything, and SHALL NOT register an identity into an organization or workspace the user has not named.

Because the two surfaces expose different registration mechanics, binding SHALL NOT assume either half can be completed in a single confirmation. Where a surface can only pre-populate a form the user must submit, binding SHALL hand the user that form and then verify the result, rather than reporting success it did not observe.

While any role is incompletely registered, binding SHALL name which roles and which halves are missing, and SHALL NOT report the project as ready for the pipeline. This SHALL NOT prevent the rest of the binding from completing.

#### Scenario: No identities exist yet

- **WHEN** binding runs against a project carrying none of the three roles
- **THEN** it names all three as missing
- **AND** guides the user through registering each half of each
- **AND** does not report the project as ready for the pipeline until they are complete

#### Scenario: A surface cannot complete registration unattended

- **WHEN** a surface's registration ends in a form only the user can submit
- **THEN** binding hands the user that form
- **AND** verifies the identity exists before recording it as registered

#### Scenario: One half of a role is missing

- **WHEN** a role carries its git-host application but no tracker agent
- **THEN** binding names that role's tracker half as missing
- **AND** leaves the half that exists untouched

#### Scenario: A second run finds the identities present

- **WHEN** binding runs again against a project whose three roles are fully registered
- **THEN** it reports them as already satisfied
- **AND** registers nothing a second time

### Requirement: Binding records the identities without recording their secrets

Binding SHALL record each registered role in `registry.yaml` with enough to identify which application and which agent the role corresponds to, and with nothing more.

Binding SHALL NOT write a private key, a client secret, a token, or any other credential to `registry.yaml` or to any other file. The registry names identities; the environment supplies their credentials, and the two SHALL NOT meet on disk.

#### Scenario: A role is registered

- **WHEN** binding completes registration of a role
- **THEN** `registry.yaml` names that role and identifies its application and agent
- **AND** the credentials that authenticate them appear nowhere in the repository

#### Scenario: The registry is inspected after binding

- **WHEN** `registry.yaml` is read after a completed binding
- **THEN** it holds no secret

#### Scenario: Unrelated registry content survives identity recording

- **WHEN** binding records the identities into a registry already declaring a tracker and a repository
- **THEN** those entries are unchanged

### Requirement: Binding verifies the merge gate and changes it only on explicit confirmation

Binding SHALL verify that the repository's default branch carries the protection the `pipeline-identity` capability requires — an approving review, and that approval postdating the most recent reviewable push — and SHALL report what it finds.

When the protection is absent or insufficient, binding SHALL present the exact change it would make and SHALL apply it only after the user explicitly agrees. When the user declines, binding SHALL report the gate as outstanding, SHALL state what would satisfy it, and SHALL NOT report the project as ready for the pipeline.

Binding SHALL NOT alter protection the repository already carries beyond what the gate requires, and SHALL NOT remove an existing human bypass. A merge policy governs a repository jen does not own: tightening it silently is an intrusion, and leaving it unmentioned makes the review stage decorative.

#### Scenario: The gate is already satisfied

- **WHEN** the default branch already requires an approving review postdating the last push
- **THEN** binding reports the gate as satisfied
- **AND** changes nothing

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

#### Scenario: Unrelated protection is preserved

- **WHEN** binding applies the gate to a branch already carrying other protections
- **THEN** those protections remain
- **AND** an existing human bypass is left in place
