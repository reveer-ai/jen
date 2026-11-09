# Spec Delta

## MODIFIED Requirements

### Requirement: jen items map to Responses input
The adapter SHALL send user and assistant messages as messages with that role and text, tool calls as function calls with the same call id, name and JSON-encoded input, and tool results as function call outputs with the same call id and output. A received message SHALL be sent as a user message whose text is `From: <sender>`, a blank line, then the message's text. A received message with an empty sender SHALL be sent as a user message holding only its text.

#### Scenario: A tool exchange is sent
- **WHEN** the conversation holds a user message, a tool call with id `c1` and input `{"key": "a"}`, and a result for `c1`
- **THEN** the request input is a user message, a function call with call id `c1` and arguments encoding `{"key": "a"}`, and a function call output for `c1`

#### Scenario: A received message is sent
- **WHEN** the conversation holds a user message "hi" from `a1b2c3d4e5f6`
- **THEN** the request input is a user message whose text is `From: a1b2c3d4e5f6`, a blank line, then `hi`

#### Scenario: A message with no sender
- **WHEN** the conversation holds a user message "hi" with an empty sender
- **THEN** the request input is a user message whose text is `hi`
