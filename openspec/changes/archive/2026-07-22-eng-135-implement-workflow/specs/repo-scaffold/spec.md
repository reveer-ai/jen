## ADDED Requirements

### Requirement: Assistant configuration is shared except where it is per-install

Assistant configuration SHALL be split in two. The permissions the workflow's stages depend on are identical in every clone and SHALL be tracked, in `.claude/settings.json`, so they are granted once rather than per install.

Configuration whose values differ from one install to the next — `.claude/settings.local.json`, which carries MCP server ids meaningless in anyone else's clone — SHALL NOT be tracked.

#### Scenario: A clone needs the permissions the stages use

- **WHEN** the repository is cloned
- **THEN** `.claude/settings.json` is present with the workflow's permissions
- **AND** they do not have to be re-granted

#### Scenario: Per-install configuration is written

- **WHEN** an install writes `.claude/settings.local.json`
- **THEN** git does not record it
- **AND** it stays local to that install
