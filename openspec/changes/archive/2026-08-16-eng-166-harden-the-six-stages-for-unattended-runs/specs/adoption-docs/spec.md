## MODIFIED Requirements

### Requirement: The documentation states the permissions the pipeline needs granted

The adopter's documentation SHALL state which permissions the pipeline's stages require and which of them the adopter has to grant.

It SHALL state that jen writes the permissions common to every project, and that it may also write a starting shape for a single ecosystem's conventional command names. It SHALL state that jen cannot know the project's own typecheck, lint, build, and test commands, so an adopter outside that ecosystem holds entries that do not apply to their project and lacks the ones that do. Without the applicable ones, the stages that run those checks cannot complete an unattended run.

Any example configuration the documentation shows SHALL be presented as the entries an adopter adds, and SHALL NOT be presented as a complete file. A complete-file example is lossy when copied: it silently drops whatever entries it does not happen to list, which is the failure the section exists to prevent, and it surfaces as denials during a run rather than as an error.

Because the assistant configuration is written once at installation and owned by the project from then on, jen SHALL NOT be presented as able to add these later. The documentation is what reaches an install that already exists.

#### Scenario: An adopter prepares a project for unattended runs

- **WHEN** the adopter's documentation is read
- **THEN** it names the project's own check commands as permissions the adopter must add
- **AND** it says what fails if they are not granted

#### Scenario: An adopter's stack is not the one jen assumes

- **WHEN** an adopter whose project is outside the ecosystem jen writes a starting shape for reads the documentation
- **THEN** it states that the shape does not apply to their project
- **AND** it does not claim that jen writes no check commands at all

#### Scenario: An adopter copies the example

- **WHEN** the documentation's example configuration is copied into a project
- **THEN** the permissions jen writes are not lost by the copying
- **AND** the example is shown as entries to add rather than as the whole file

#### Scenario: An existing install predates the guidance

- **WHEN** a project was installed before this guidance existed
- **THEN** the documentation tells the adopter to edit the configuration themselves
- **AND** does not suggest that an update will add the permissions for them
