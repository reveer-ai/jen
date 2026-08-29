## ADDED Requirements

### Requirement: The documentation states what the environment set on a runner reaches

The adopter's documentation SHALL state that the variables an operator sets on the runner reach the pipeline's sessions. It SHALL be stated beside the permissions guidance, which answers the neighbouring half of the same question: the permissions section says a project's own checks must be granted the commands they run, and this says how those commands are given the configuration they read.

It SHALL state which of jen's runners the passthrough is available on. jen ships two, and the scheduled one carries a closed set of names it is given by a managed file, so an operator running there cannot supply a variable at all. Documentation that states the mechanism unconditionally describes to half its readers something their runner does not provide, and they discover it the way this design exists to prevent: a stage failing at the first command that needed the name, mid-run, with nobody watching.

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

#### Scenario: An adopter on the scheduled runner reads the passthrough

- **WHEN** an adopter whose pipeline runs on the scheduled runner reads how to supply their project's configuration
- **THEN** the documentation states which runner the passthrough is available on
- **AND** states that supplying it on the scheduled runner is not available yet

#### Scenario: An adopter expects the role to scope it

- **WHEN** an adopter assumes that restricting a variable to testing keeps it from delivery because of their roles
- **THEN** the documentation states that reviewing, testing, and delivering share one role
- **AND** that the narrowing is by stage
