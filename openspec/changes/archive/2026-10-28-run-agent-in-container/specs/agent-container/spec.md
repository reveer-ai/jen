# Spec Delta

## Purpose

Defines how a jen agent is packaged and run as an OCI container: the state volume it keeps its conversation on, the model configuration it reads, and how it handles one message per run.

## ADDED Requirements

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

### Requirement: Each run handles one message
The agent SHALL take its message from its command-line arguments, joined with spaces, run one turn, print the reply to standard output, and exit zero. The reply is the text of the assistant messages that end the turn, separated by blank lines. With no message, it SHALL exit non-zero and save nothing.

#### Scenario: One message
- **WHEN** the container runs with the argument `hello`
- **THEN** it runs one turn on `hello`, prints the assistant's reply, and exits zero

#### Scenario: No message
- **WHEN** the container runs with no arguments
- **THEN** it exits non-zero and the stored conversation is unchanged

### Requirement: A failed turn exits non-zero
If the turn fails, the agent SHALL write the error to standard error, exit non-zero, and save nothing.

#### Scenario: Model unreachable
- **WHEN** the model call fails
- **THEN** the agent writes the error to standard error, exits non-zero, and the stored conversation is unchanged

### Requirement: The agent stops promptly when signalled
On an interrupt or termination signal, the agent SHALL exit promptly, saving nothing from an unfinished turn.

#### Scenario: Stopped mid-turn
- **WHEN** the container is stopped while a turn is waiting on the model
- **THEN** the agent exits without waiting for the stop timeout, and the stored conversation is unchanged
