# Spec Delta

## Purpose

Defines how a jen agent runs one conversation turn: taking a user message, working with the model and its tools until the model answers, and reporting what happened.

## ADDED Requirements

### Requirement: A turn starts from a user message and the existing conversation
A turn SHALL take the conversation so far and a new user message, and send the model the whole conversation with that message appended, along with the descriptions of the available tools.

#### Scenario: First turn of a conversation
- **WHEN** a turn runs with an empty conversation and the message "hello"
- **THEN** the model is sent exactly one item: a user message "hello"

#### Scenario: Later turn of a conversation
- **WHEN** a turn runs on a conversation that already holds a user message and an assistant reply
- **THEN** the model is sent those two items followed by the new user message, in order

#### Scenario: Tools are described to the model
- **WHEN** a turn runs with tools available
- **THEN** each model call receives every tool's name, description and input schema

### Requirement: Tool calls are run and their results returned to the model
When the model's response contains tool calls, the agent SHALL run each one, in the order given, with the input the model supplied. It SHALL then call the model again with the conversation extended by the response and by one tool result per call, each tied to its call.

#### Scenario: One tool call
- **WHEN** the model asks for tool `lookup` with input `{"key": "a"}`
- **THEN** `lookup` runs with `{"key": "a"}`, and the next model call includes the tool call followed by a result holding `lookup`'s output and that call's id

#### Scenario: Several tool calls in one response
- **WHEN** one model response asks for tool calls A then B
- **THEN** A runs before B, and the next model call includes A's result followed by B's result

### Requirement: The turn ends when the model answers without calling a tool
The agent SHALL keep calling the model while its responses contain tool calls. It SHALL end the turn after the first response that contains none.

#### Scenario: Direct answer
- **WHEN** the model's first response is an assistant message with no tool calls
- **THEN** the turn ends after one model call

#### Scenario: Answer after tool use
- **WHEN** the model calls a tool, then answers with a message
- **THEN** the turn ends after the second model call

### Requirement: A turn reports every item it added
A completed turn SHALL return the items it added to the conversation, in order: the user message, then each model and tool item as it occurred. It SHALL NOT change the conversation it was given.

#### Scenario: Items of a turn with a tool call
- **WHEN** a turn with one tool call completes
- **THEN** it returns the user message, the tool call, the tool result and the assistant message, in that order

#### Scenario: Caller's conversation untouched
- **WHEN** a turn completes
- **THEN** the conversation passed in holds exactly the items it held before

### Requirement: Tool failures are reported to the model
If a tool throws, or the model asks for a tool that isn't available, the agent SHALL record a tool result whose output starts with `Error:` and describes the failure, and SHALL continue the turn.

#### Scenario: Tool throws
- **WHEN** a tool throws an error with message "not found"
- **THEN** its result's output is `Error: not found`, and the model is called again

#### Scenario: Unknown tool
- **WHEN** the model asks for a tool named `missing` that isn't available
- **THEN** its result's output starts with `Error:` and names `missing`, and the model is called again

### Requirement: Model failures end the turn
If a model call fails, the turn SHALL fail with that error and SHALL NOT return a partial set of items.

#### Scenario: Model call fails mid-turn
- **WHEN** the second model call of a turn fails
- **THEN** the turn fails with that error, and the caller receives no items for the turn
