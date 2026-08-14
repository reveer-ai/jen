## ADDED Requirements

### Requirement: The documentation states the permissions the pipeline needs granted

The adopter's documentation SHALL state which permissions the pipeline's stages require and which of them the adopter has to grant.

It SHALL state that jen writes the permissions common to every project, and that the project's own typecheck, lint, build, and test commands are not among them, because jen cannot know what they are. Without them the stages that run those checks cannot complete an unattended run.

Because the assistant configuration is written once at installation and owned by the project from then on, jen SHALL NOT be presented as able to add these later. The documentation is what reaches an install that already exists.

#### Scenario: An adopter prepares a project for unattended runs

- **WHEN** the adopter's documentation is read
- **THEN** it names the project's own check commands as permissions the adopter must add
- **AND** it says what fails if they are not granted

#### Scenario: An existing install predates the guidance

- **WHEN** a project was installed before this guidance existed
- **THEN** the documentation tells the adopter to edit the configuration themselves
- **AND** does not suggest that an update will add the permissions for them
