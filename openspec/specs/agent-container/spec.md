# agent-container Specification

## Purpose
Defines how a jen agent is packaged and run as an OCI container: the state volume it keeps its conversation on, the model configuration it reads, and how it handles one message per run.

## Requirements

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

### Requirement: The agent does not run as root
The image SHALL run the agent as a non-root user that can write to a new named volume mounted at `/state` without any setup.

#### Scenario: Unprivileged run
- **WHEN** the agent runs on a new named volume
- **THEN** its process is not root and it saves the turn

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

### Requirement: The agent requires a token
The agent SHALL read its token from `JEN_TOKEN`. If `JEN_TOKEN` is missing or empty, it SHALL exit non-zero at startup with an error naming the variable, and SHALL serve nothing.

#### Scenario: Missing token
- **WHEN** the agent starts without `JEN_TOKEN`
- **THEN** it exits non-zero and its error names `JEN_TOKEN`

### Requirement: The agent calls the model through the runtime
The agent SHALL read its model ID from `JEN_MODEL`, and SHALL call the model at `<JEN_RUNTIME_URL>/model`, defaulting to `http://runtime:8080/model`, with its own token, `JEN_TOKEN`, as the API key. It SHALL read no API key and no model endpoint. If `JEN_MODEL` or `JEN_TOKEN` is missing, it SHALL exit non-zero with an error naming the variable and save nothing.

#### Scenario: Missing model
- **WHEN** the agent runs without `JEN_MODEL`
- **THEN** it exits non-zero, its error names `JEN_MODEL`, and the stored conversation is unchanged

#### Scenario: Model calls go to the runtime
- **WHEN** the agent calls the model
- **THEN** the call goes to `<JEN_RUNTIME_URL>/model/responses` with `Authorization: Bearer <JEN_TOKEN>`

#### Scenario: No key needed
- **WHEN** the agent runs with `JEN_MODEL` and `JEN_TOKEN` and without `JEN_API_KEY`
- **THEN** it starts and serves its protocol
