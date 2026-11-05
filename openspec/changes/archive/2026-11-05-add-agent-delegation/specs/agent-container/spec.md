# Spec Delta

## MODIFIED Requirements

### Requirement: The agent stops promptly when signalled
On an interrupt or termination signal, the agent SHALL exit promptly. Every step saved before the signal SHALL stay saved, and the agent SHALL resume its unfinished work on its next start.

#### Scenario: Stopped mid-turn
- **WHEN** the container is stopped while the agent waits on a model call after a tool call and its result were saved
- **THEN** the agent exits without waiting for the stop timeout, the tool call and its result stay saved, and a new container on the same volume resumes with a model call

### Requirement: The agent serves its protocol on port 8080
The agent SHALL run as a long-running server that listens on port 8080 on every interface in its container, serving the `agent-protocol` capability until it is stopped. It SHALL keep serving across messages and failed model calls.

#### Scenario: Two messages to one container
- **WHEN** the container is started with its port published, and a client posts two messages in turn
- **THEN** both are accepted by the same running container, and replies to both appear on its event stream

#### Scenario: Restarted on the same volume
- **WHEN** a message is handled, the container is removed, and a new container on the same volume is sent a second message
- **THEN** the model call for the second message is sent the first message and its reply

### Requirement: An agent runs as an OCI image with a state volume
The agent SHALL be packaged as an OCI image whose conversation and inbox are kept on a volume mounted at `/state`, so both outlive any one container.

#### Scenario: State survives a new container
- **WHEN** a message is handled in one container, and a second message in a new container on the same volume
- **THEN** the second message's model call sees the first

#### Scenario: Fresh volume
- **WHEN** the agent runs on a new, empty volume
- **THEN** it handles the message as the first of a new conversation

#### Scenario: Inbox survives a new container
- **WHEN** a message is accepted and the container is removed before the message is delivered
- **THEN** a new container on the same volume delivers it and works on it
