## ADDED Requirements

### Requirement: A session inherits the runner's environment, and a variable can be withheld from every stage but one

A session SHALL be given the environment the runner holds, less what jen reserves to itself. A project's own checks read configuration jen cannot enumerate — the database a suite connects to, the endpoint an integration test reaches for — and the same reasoning that requires a project's own permission grants to be in force requires the variables those commands read to arrive with them. This SHALL be understood as an intended mechanism rather than as a consequence of how a session happens to be started.

Variables in jen's own namespace SHALL NOT reach a session. That namespace is jen's to define, which is what makes withholding it by prefix exhaustive rather than a guess at what a name might mean: the set is closed and has no unnamed member to miss. The credentials of every role are within it, so the requirement that a run hold exactly one role's credentials and that a session be unable to obtain another's continues to be met by this, and is neither relaxed nor restated by it.

The inherited set SHALL NOT be inverted into an allow list of the variables jen can name. No such list is ever complete for an arbitrary project's toolchain, and every name omitted from one would surface as a stage failing at the first command that needed it — mid-run, with nobody present, presenting as a broken stage rather than as a list jen got wrong. That is the late failure this capability already warns about for permissions, and the default SHALL NOT be arranged so as to manufacture it.

An operator SHALL be able to declare that a named variable reaches one stage and no other. The declaration SHALL name variables rather than carry their values, so that a project's variables reach its commands under the project's own names and a secret is written down in one place rather than two. A variable no declaration names SHALL reach every stage, and an operator who declares nothing SHALL observe the environment their sessions receive today.

The restriction SHALL key on the stage rather than on the role. Reviewing, testing, and delivering all act under one role, so a role-keyed restriction would hand a variable meant for the stage that tests to the stage that merges — which is the arrangement this requirement exists to make expressible.

A declaration that withholds nothing SHALL be reported and SHALL NOT fail the run. A declaration naming a stage that does not exist, and a declaration naming a variable that is not set, both leave every stage holding exactly what it would have held anyway; the variables such a declaration named SHALL be inherited as though it had not been written, and the run SHALL say what it found so that the operator learns their declaration had no effect. Stopping a pipeline over a declaration that changed nothing SHALL NOT be done.

#### Scenario: A stage runs a command that needs the project's own configuration

- **WHEN** an operator has set a variable on the runner and a session runs a command that reads it
- **THEN** the variable is present in the session's environment under its own name

#### Scenario: jen's own namespace does not reach a session

- **WHEN** a session's environment is examined
- **THEN** no variable in jen's own namespace is present
- **AND** this holds for every variable in it, not only those carrying a role's credentials

#### Scenario: A variable is restricted to one stage

- **WHEN** an operator declares a variable restricted to a single stage
- **THEN** that stage's session receives it
- **AND** no other stage's session receives it

#### Scenario: The restricted stage shares its role with another

- **WHEN** the stage a variable is restricted to acts under the same role as another stage
- **THEN** the other stage still does not receive it
- **AND** sharing the role does not qualify a stage for it

#### Scenario: Nothing is declared

- **WHEN** an operator has declared no restriction
- **THEN** every variable the runner holds, less jen's own namespace, reaches every stage

#### Scenario: A declaration names a stage that does not exist

- **WHEN** a declaration names something that is not one of the pipeline's stages
- **THEN** the run reports it, naming what was written and what would have been valid
- **AND** the variables it named are inherited as though it had not been written
- **AND** the run is not failed by it

#### Scenario: A declaration names a variable that is not set

- **WHEN** a declaration restricts a variable the runner does not hold
- **THEN** the run reports it
- **AND** the run is not failed by it
