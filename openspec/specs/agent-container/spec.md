# agent-container Specification

## Purpose
Defines how a jen agent is packaged and run as an OCI container: the state volume it keeps its conversation on, the model configuration it reads, and how it handles one message per run.

## Requirements

### Requirement: An agent runs as an OCI image with a state volume
The agent SHALL be packaged as an OCI image whose conversation is kept on a volume mounted at `/state`, so the conversation outlives any one container.

#### Scenario: State survives a new container
- **WHEN** a message is handled in one container, and a second message in a new container on the same volume
- **THEN** the second turn sees the first

#### Scenario: Fresh volume
- **WHEN** the agent runs on a new, empty volume
- **THEN** it handles the message as the first turn of a new conversation

### Requirement: The agent does not run as root
The image SHALL run the agent as a non-root user that can write to a new named volume mounted at `/state` without any setup.

#### Scenario: Unprivileged run
- **WHEN** the agent runs on a new named volume
- **THEN** its process is not root and it saves the turn

### Requirement: The model is configured through the environment
The agent SHALL read its model ID from `JEN_MODEL` and API key from `JEN_API_KEY`, and SHALL use `JEN_BASE_URL` as the model endpoint when set. If `JEN_MODEL` or `JEN_API_KEY` is missing, it SHALL exit non-zero with an error naming the variable and save nothing.

#### Scenario: Missing key
- **WHEN** the agent runs without `JEN_API_KEY`
- **THEN** it exits non-zero, its error names `JEN_API_KEY`, and the stored conversation is unchanged

#### Scenario: Alternate endpoint
- **WHEN** `JEN_BASE_URL` is set
- **THEN** model calls go to that endpoint

### Requirement: The agent stops promptly when signalled
On an interrupt or termination signal, the agent SHALL exit promptly, saving nothing from an unfinished turn.

#### Scenario: Stopped mid-turn
- **WHEN** the container is stopped while a turn is waiting on the model
- **THEN** the agent exits without waiting for the stop timeout, and the stored conversation is unchanged

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
