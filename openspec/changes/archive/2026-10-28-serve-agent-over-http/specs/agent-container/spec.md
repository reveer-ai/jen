# Spec Delta

## ADDED Requirements

### Requirement: The agent serves its protocol on port 8080
The agent SHALL run as a long-running server that listens on port 8080 on every interface in its container, serving the `agent-protocol` capability until it is stopped. It SHALL keep serving across messages and failed turns.

#### Scenario: Two messages to one container
- **WHEN** the container is started with its port published, and a client posts two messages in turn
- **THEN** both get replies from the same running container

#### Scenario: Restarted on the same volume
- **WHEN** a message is handled, the container is removed, and a new container on the same volume is sent a second message
- **THEN** the second turn sees the first

### Requirement: The agent requires a token
The agent SHALL read its token from `JEN_TOKEN`. If `JEN_TOKEN` is missing or empty, it SHALL exit non-zero at startup with an error naming the variable, and SHALL serve nothing.

#### Scenario: Missing token
- **WHEN** the agent starts without `JEN_TOKEN`
- **THEN** it exits non-zero and its error names `JEN_TOKEN`

## REMOVED Requirements

### Requirement: Each run handles one message
**Reason**: The agent is now a long-running server, reached over HTTP.
**Migration**: Start the container detached with its port published, and post messages to `/messages` with the token. See the `agent-protocol` capability.

### Requirement: A failed turn exits non-zero
**Reason**: A failed turn no longer ends the process. It's reported to the client that sent the message, and the agent keeps serving.
**Migration**: See "A failed turn is reported to its sender" in the `agent-protocol` capability.
