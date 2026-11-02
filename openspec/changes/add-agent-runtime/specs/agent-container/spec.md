# Spec Delta

## ADDED Requirements

### Requirement: One image runs an agent or the runtime
The jen image SHALL start an agent when it's run with no command, and SHALL start the runtime (the `agent-runtime` capability) when it's run with the command `src/runtime/main.ts`.

#### Scenario: Default command
- **WHEN** the image is run with no command and the agent's environment
- **THEN** it serves the agent's protocol on port 8080

#### Scenario: Runtime command
- **WHEN** the image is run with the command `src/runtime/main.ts`, the engine's socket and the runtime's environment
- **THEN** it serves the runtime's API on port 8080
