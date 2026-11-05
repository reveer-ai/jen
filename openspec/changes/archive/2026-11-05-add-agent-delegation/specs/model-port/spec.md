# Spec Delta

## ADDED Requirements

### Requirement: A received message names its sender
A message the agent receives SHALL be a user message carrying `from`, the sender's agent ID, `owner` or `runtime`. The agent's own messages SHALL be assistant messages with no `from`.

#### Scenario: Message from a parent
- **WHEN** an agent receives "check the logs" from `owner`
- **THEN** the conversation holds `{"type": "message", "role": "user", "from": "owner", "text": "check the logs"}`

### Requirement: A model call carries system instructions
A model call SHALL take system instructions as text alongside the conversation and tools. A scripted model SHALL record the instructions it received on each call.

#### Scenario: Recorded instructions
- **WHEN** a scripted model is called with the instructions "You are agent a1."
- **THEN** that call's recorded input holds those instructions

### Requirement: A model call can be cancelled
A model call SHALL take a cancellation signal. Once the signal fires, the call SHALL fail promptly with a cancellation error and return no items. A scripted model SHALL honour the signal the same way.

#### Scenario: Cancelled call
- **WHEN** a model call's signal fires before the model returns
- **THEN** the call fails with a cancellation error and returns no items

## MODIFIED Requirements

### Requirement: Conversations are a flat list of items
A conversation SHALL be an ordered list of items, each one of: a message (role `user` or `assistant`, with text, and for a received user message the sender in `from`), a tool call (an id, a tool name and a JSON input), or a tool result (the id of the call it answers, and text output).

#### Scenario: A tool exchange as items
- **WHEN** the owner asks a question, the model calls a tool, and then answers
- **THEN** the conversation is four items: a user message from `owner`, a tool call, a tool result whose call id matches the tool call's id, and an assistant message
