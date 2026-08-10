## MODIFIED Requirements

### Requirement: A fresh clone has working stage skills with no build step

Cloning the repository SHALL yield every skill jen ships — the six stage skills and the setup skill — immediately usable, without installing dependencies, running a build, or executing any initialization command. The skills a contributor edits SHALL be the same files the package ships.

#### Scenario: Stage skills work immediately after clone

- **WHEN** the repository is cloned and no build or install is run
- **THEN** every skill the payload declares is present at `.claude/skills/<name>/SKILL.md` and is a valid Agent Skill

#### Scenario: Editing a skill requires no regeneration

- **WHEN** a contributor edits a shipped skill's `SKILL.md` and commits it
- **THEN** no build, regeneration, or second copy needs updating for the change to be complete
