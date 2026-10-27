# model-port Specification

## Purpose
Defines the contract between jen and any model, in jen's own terms, so that model providers can be added or swapped without changing the agent loop. Also defines the scripted model that stands in for a real one in tests.

## Requirements

### Requirement: Conversations are a flat list of items
A conversation SHALL be an ordered list of items, each one of: a message (role `user` or `assistant`, with text), a tool call (an id, a tool name and a JSON input), or a tool result (the id of the call it answers, and text output).

#### Scenario: A tool exchange as items
- **WHEN** a user asks a question, the model calls a tool, and then answers
- **THEN** the conversation is four items: a user message, a tool call, a tool result whose call id matches the tool call's id, and an assistant message

### Requirement: Items and tool descriptions are plain data
Every item and every tool description SHALL be plain JSON data, with no functions or provider-specific objects. Converting one to JSON and back SHALL give an equal value.

#### Scenario: Round trip through JSON
- **WHEN** a conversation holding every item type is converted to JSON text and parsed back
- **THEN** the result equals the original conversation

### Requirement: A tool is described by name, description and input schema
A tool description SHALL carry the tool's name, a description for the model, and a JSON Schema for its input.

#### Scenario: Describing a tool
- **WHEN** a tool `lookup` that takes a string `key` is described to the model
- **THEN** its description holds the name `lookup`, its description text, and a JSON Schema for an object with a string property `key`

### Requirement: A model returns its next turn from the whole conversation
A model SHALL take the whole conversation and the available tool descriptions, and return only the new items for its turn. These are assistant messages and tool calls. It SHALL NOT depend on anything kept from earlier calls.

#### Scenario: Stateless calls
- **WHEN** a model is called twice with the same conversation and tools
- **THEN** each call sees the full conversation, and neither relies on the other having happened

#### Scenario: Only new items are returned
- **WHEN** a model is called with a conversation of three items
- **THEN** its result doesn't repeat any of those three items

### Requirement: A scripted model plays back fixed turns
A scripted model SHALL be built from a list of turns. Each call SHALL return the next turn in order. It SHALL record a copy of the conversation and tools it received on each call.

#### Scenario: Playing back turns
- **WHEN** a scripted model built from turns T1 and T2 is called twice
- **THEN** the first call returns T1, the second returns T2, and both calls' inputs are recorded in order

#### Scenario: Recorded inputs are snapshots
- **WHEN** the caller changes the conversation after a scripted call
- **THEN** the recorded input for that call is unchanged

### Requirement: A scripted model fails when its script runs out
A scripted model SHALL fail when it is called after its last turn has been returned.

#### Scenario: Called past the script
- **WHEN** a scripted model built from one turn is called a second time
- **THEN** the call fails with an error saying the script is exhausted
