## ADDED Requirements

### Requirement: The documentation states what the environment set on the runner reaches

The adopter's documentation SHALL state that the variables an operator sets on the runner reach the pipeline's sessions. It SHALL be stated beside the permissions guidance, which answers the neighbouring half of the same question: the permissions section says a project's own checks must be granted the commands they run, and this says how those commands are given the configuration they read.

It SHALL be stated unconditionally. The passthrough is available on the runner jen ships, which is the only runner it ships, so the documentation SHALL NOT carry a caveat naming a runner the mechanism is unavailable on.

It SHALL state that jen's own namespace is withheld from sessions, and that the variables carrying the role credentials are within it, so an adopter does not read the passthrough as exposing them.

It SHALL state how to narrow a variable to a single stage, and SHALL state that the declaration holds variable *names* rather than values. Any example SHALL name more than one variable: a declaration holding a single name is indistinguishable at a glance from a variable holding a value, and an example that reads that way teaches an adopter to write their secret into it.

It SHALL state that the narrowing keys on the stage rather than on the role. An adopter who reasons from the roles will expect a variable given to the stage that tests to be withheld from the stage that merges, and it is not the role that arranges this, since both act under the same one.

#### Scenario: An adopter supplies their project's own test configuration

- **WHEN** an adopter reads the documentation to learn how their suite reaches its database
- **THEN** it states that variables set on the runner reach the stages
- **AND** it states which namespace is withheld from them

#### Scenario: An adopter narrows a variable to one stage

- **WHEN** an adopter wants a credential to reach only the stage that tests
- **THEN** the documentation gives the declaration that arranges it
- **AND** states that the declaration names variables rather than carrying their values

#### Scenario: The example does not read as carrying a value

- **WHEN** the documentation's example declaration is read
- **THEN** it names more than one variable

#### Scenario: The passthrough carries no runner caveat

- **WHEN** an adopter reads how to supply their project's configuration
- **THEN** the mechanism is stated without qualifying which runner it is available on

#### Scenario: An adopter expects the role to scope it

- **WHEN** an adopter assumes that restricting a variable to testing keeps it from delivery because of their roles
- **THEN** the documentation states that reviewing, testing, and delivering share one role
- **AND** that the narrowing is by stage

### Requirement: The documentation says how autonomy is turned on, what it does once it is, and what drives it

The adopter's documentation SHALL carry the step from an installed, bound project to one that acts on its own: what the runner requires configured, and how to start it.

It SHALL state plainly that running the pipeline outside the git host does not remove the git host from it — pull requests, review verdicts, and the merge gate are unchanged, and so are the registered identities they depend on.

The documentation SHALL state that a runner jen does not ship is equally valid, and that anything able to invoke the tick on a schedule is one — a timer, a container, or a scheduled job on the git host. It SHALL NOT supply a workflow file, a template, or a worked example for any of them. jen shipped a scheduled git-host workflow and removed it because the job holds a paid runner for the whole life of every session it launches; publishing a ready-made replacement would return an adopter to that cost with jen's apparent endorsement, where an adopter who writes their own has chosen it.

The documentation SHALL state the conditions that come with the runner and are not obvious from starting it: that a session dies with the process that launched it, what the pipeline then reads on that task, and that a session which hangs hangs the loop until an operator stops it.

Where a value the runner needs may be supplied in more than one form, the documentation SHALL name every accepted form and SHALL state what choosing each one costs. Model access is that case: the pipeline runs on an API key or on a subscription token, and the variable names alone answer neither which to use nor what follows from the answer. The documentation SHALL state how the subscription token is obtained, and that the subscription's usage limits are shared with the adopter's own interactive use of the same account — so a polling pipeline can exhaust a window they were about to work in, surfacing as a stage dying mid-run rather than as a bill. It SHALL state that the token is long-lived and bound to the person who minted it and to their subscription, where an API key is issued independently of any one person. It SHALL NOT describe the token as unscoped: it carries inference-only authority by design, which is what a pipeline session needs and less than a login grants, and an adopter told otherwise would weigh the choice against a risk the credential does not carry. It SHALL state that a runner holds exactly one, and that setting both is refused rather than resolved in the adopter's favour by a precedence.

Where minting the token can be refused by policy on a managed installation, the documentation SHALL say so. An adopter who meets that refusal SHALL be able to recognize it as a stated limit on their installation rather than as a malfunction, and SHALL be left with the other form still open to them.

The alternative spellings of one value SHALL NOT be presented as additional values. The documentation states how many values the runner needs, and an adopter who counts a credential twice looks for a secret they were never meant to store and cannot tell a complete configuration from an incomplete one.

The documentation SHALL state what the pipeline will do while nobody is watching: which transition a human still owns, that a stage may park a task where a person is needed, and how much may run at once.

It SHALL state how to stop it. The halt SHALL be documented as the tracker's project status rather than as stopping a runner or editing task statuses, and SHALL be documented as applying to any runner, including one jen does not ship.

Because the status that pauses the pipeline is one the adopter creates, the documentation SHALL name it exactly, SHALL say which category to file it under, and SHALL state that renaming it disables the halt without any other symptom. An adopter who never creates it SHALL be told what they do not have, since a pipeline missing only its halt runs indistinguishably from one that has it.

#### Scenario: An adopter turns the pipeline on

- **WHEN** an adopter follows the documented steps
- **THEN** the values and credentials the runner needs are named
- **AND** the pipeline polls their project

#### Scenario: An adopter expects the runner to remove the git host

- **WHEN** an adopter reads about the runner
- **THEN** the documentation states that the git host identities and the merge gate are still required

#### Scenario: An adopter wants to run the pipeline on their git host's scheduler

- **WHEN** an adopter reads whether they can drive the pipeline from a scheduled git-host job
- **THEN** the documentation states that anything able to invoke the tick on a schedule is a runner
- **AND** states why jen no longer ships one for the git host
- **AND** supplies no workflow file or template for it

#### Scenario: An adopter reads what the runner does not protect them from

- **WHEN** an adopter reads the conditions that come with the runner
- **THEN** it states that a session dies with the process that launched it, and what the task then reads as
- **AND** states that a hung session hangs the loop until it is stopped

#### Scenario: An adopter already pays for a subscription

- **WHEN** an adopter who does not want to fund an API key reads what model access requires
- **THEN** the documentation names the subscription token as an accepted form
- **AND** says how it is obtained

#### Scenario: An adopter weighs the subscription against a key

- **WHEN** an adopter reads what choosing the subscription costs
- **THEN** the documentation states that its usage limits are shared with their own interactive work
- **AND** states that it is bound to the person who minted it and to their subscription
- **AND** does not describe it as carrying authority beyond inference

#### Scenario: An adopter's installation forbids minting a token

- **WHEN** an adopter on a managed installation is refused the subscription token
- **THEN** the documentation has already named that a policy can refuse it
- **AND** states that the API key remains open to them

#### Scenario: An adopter holds both forms

- **WHEN** an adopter reads what happens if both model credentials are set
- **THEN** the documentation states that the run refuses rather than choosing one

#### Scenario: An adopter counts what they must store

- **WHEN** an adopter reads how many values the runner needs
- **THEN** the two spellings of model access are counted as one value

#### Scenario: An adopter wants it stopped

- **WHEN** an adopter looks for how to halt the pipeline
- **THEN** the documentation names the project status that halts dispatch
- **AND** says where to create it and which category it belongs under
- **AND** states that it applies to any runner, including one jen does not ship

#### Scenario: An adopter reads what the halt costs

- **WHEN** an adopter reads how the pause status is matched
- **THEN** the documentation states that renaming it turns the halt off silently
## MODIFIED Requirements

### Requirement: The ownership boundary is stated before the instructions

The adopter's documentation SHALL state which files jen owns and overwrites and which the project owns, and SHALL state it ahead of the installation steps.

An adopter who hand-edits a managed file loses that edit on the next update. Discovering the boundary after the loss is the failure this ordering exists to prevent, so the boundary SHALL NOT be relegated to a later section, a footnote, or a reference to the specifications.

The statement SHALL cover, at minimum: that root `AGENTS.md` and the shipped skills are jen's and are replaced wholesale; that `registry.yaml` and the assistant settings are written once and never touched again; that everything else — the project's sources, its specs, and any skill it authors — is the project's; and what the ownership stamp does, which is to mark a file as jen's to *remove* rather than to decide whether it is overwritten.

The documentation SHALL NOT present removing the stamp as a way to keep an edit to a skill jen currently ships. It does not: the payload is written to its declared paths unconditionally, and the next update restores both the file and its stamp. Stating otherwise would tell an adopter their edit is safe in exactly the case where it is lost.

#### Scenario: The boundary precedes the install instructions

- **WHEN** the adopter's documentation is read from the top
- **THEN** the ownership boundary appears before the installation command

#### Scenario: An adopter checks whether an edit will survive

- **WHEN** an adopter wants to know whether editing a shipped skill is safe
- **THEN** the documentation states that the file is jen's and that an update replaces it
- **AND** it states that removing the stamp does not prevent that
- **AND** it names authoring a separate skill as the way to hold code the update will not touch

#### Scenario: An adopter learns what the stamp actually governs

- **WHEN** the documentation describes the ownership stamp
- **THEN** it states that a stamped file jen no longer ships is deleted on update
- **AND** that removing the stamp from such a file keeps it
- **AND** that a file jen never shipped is left alone whether or not it is stamped

#### Scenario: An adopter wants to change which project the pipeline polls

- **WHEN** an adopter looks for where the pipeline's tracker project is set
- **THEN** the documentation names the registry as the place to change it
- **AND** states that the runner reads it from the checkout when it starts

## REMOVED Requirements

### Requirement: The documentation states what the environment set on a runner reaches

**Reason**: Renamed to *The documentation states what the environment set on the runner reaches*, and the caveat it was built around is gone. The requirement obliged the documentation to name which of jen's two runners the passthrough was available on, because the scheduled one carried a closed set of variable names from a managed file and could not be given another. With that runner deleted, the passthrough is available on every runner jen ships, and a caveat naming an unavailable one would describe nothing.

**Migration**: The replacement carries every other obligation unchanged — the namespace withheld from sessions, narrowing a variable to one stage, the declaration holding names rather than values, the multi-variable example, and narrowing keying on the stage rather than the role. What changed is that the mechanism is now stated unconditionally, which is a capability gained rather than a rule dropped.

### Requirement: The documentation says how autonomy is turned on, and what it does once it is

**Reason**: Renamed to *The documentation says how autonomy is turned on, what it does once it is, and what drives it*, because three of its obligations were about a choice an adopter no longer has: presenting the runners as peers, giving the grounds for choosing between them, and documenting each one's conditions — including a git host disabling a schedule on an inactive repository, which no longer has a schedule to disable.

**Migration**: The replacement keeps every obligation that was not about the pair: model access in both its forms and what each costs, the policy refusal, counting one credential once, what the pipeline does unwatched, and the halt. Three things change. Choosing a runner becomes starting the one runner. The runner's own conditions — a session dying with its process, and a hung session hanging the loop — are stated where the pair's conditions were. And a new obligation replaces the peer framing: that a runner jen does not ship is equally valid, that a scheduled git-host job is one, why jen stopped shipping that one, and that jen supplies no file for it.
