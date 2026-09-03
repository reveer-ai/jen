## MODIFIED Requirements

### Requirement: A run cannot block on a human

A session SHALL be started with no interactive channel to a person, so that it has no
way to put a question to one, and that inability SHALL hold even where a permission rule
would otherwise allow the asking. The stage skills state that they never wait on a human;
this requirement SHALL make it enforced by how the session is started rather than trusted
to the prose. The enforcement SHALL be a property of the session being non-interactive,
not of a permission level: no `--permission-mode` value denies asking, and a requirement
written as though one did invites an enforcement that does not exist.

A run SHALL NOT be left waiting on input that cannot arrive. Where a stage needs a person,
it SHALL record what it needs and park the task, which the workflow already requires of it,
rather than stalling.

#### Scenario: A stage would ask a question

- **WHEN** a session attempts to ask a person a question
- **THEN** it is denied
- **AND** the run does not wait

#### Scenario: A permission rule would allow asking

- **WHEN** a configuration would otherwise permit the asking
- **THEN** the denial still holds

#### Scenario: The permission level would not prompt

- **WHEN** the session runs under a permission mode that lets tools act without prompting
- **THEN** it still has no channel on which to ask a person a question
- **AND** the denial does not depend on which permission mode was chosen
