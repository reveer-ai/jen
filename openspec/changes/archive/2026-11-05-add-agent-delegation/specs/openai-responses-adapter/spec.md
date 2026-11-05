# Spec Delta

## ADDED Requirements

### Requirement: Instructions are sent as Responses instructions
The adapter SHALL send a call's system instructions as the request's `instructions`.

#### Scenario: Instructions in the request
- **WHEN** the adapter is called with the instructions "You are agent a1."
- **THEN** the request's `instructions` is "You are agent a1."

### Requirement: A cancelled call aborts its request
When a call's cancellation signal fires, the adapter SHALL abort the request in flight and fail the call with a cancellation error.

#### Scenario: Cancelled mid-request
- **WHEN** the signal fires while the request is waiting on the provider
- **THEN** the request is aborted and the call fails with a cancellation error

## MODIFIED Requirements

### Requirement: jen items map to Responses input
The adapter SHALL send user and assistant messages as messages with that role and text, tool calls as function calls with the same call id, name and JSON-encoded input, and tool results as function call outputs with the same call id and output. A received message SHALL be sent as a user message whose text is `From: <sender>`, a blank line, then the message's text.

#### Scenario: A tool exchange is sent
- **WHEN** the conversation holds a user message, a tool call with id `c1` and input `{"key": "a"}`, and a result for `c1`
- **THEN** the request input is a user message, a function call with call id `c1` and arguments encoding `{"key": "a"}`, and a function call output for `c1`

#### Scenario: A received message is sent
- **WHEN** the conversation holds a user message "hi" from `a1b2c3d4e5f6`
- **THEN** the request input is a user message whose text is `From: a1b2c3d4e5f6`, a blank line, then `hi`
