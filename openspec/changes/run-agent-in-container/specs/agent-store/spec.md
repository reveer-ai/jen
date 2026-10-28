# Spec Delta

## Purpose

Defines how a jen agent persists its conversation so it outlives the process that ran it: what a fresh start loads, and what is saved when a turn completes or fails.

## ADDED Requirements

### Requirement: A new store starts with an empty conversation
Opening a store at a location that holds no saved conversation SHALL create it and load an empty conversation.

#### Scenario: First open
- **WHEN** a store is opened in an empty directory
- **THEN** it loads no items

### Requirement: A loaded conversation holds every saved item in order
Loading a store SHALL return every item it has saved, in the order saved, each equal to the item that was saved, including after the store is closed and opened again.

#### Scenario: Reload after reopening
- **WHEN** one turn's items are saved, then a second turn's, and the store is closed and reopened
- **THEN** loading returns the first turn's items followed by the second's, each equal to what was saved

#### Scenario: Every item type survives
- **WHEN** a user message, an assistant message, a tool call with nested JSON input, and a tool result are saved and the store is reopened
- **THEN** each loads back equal to what was saved

### Requirement: A turn is saved whole or not at all
Saving a turn SHALL make all of its items durable together. If saving fails partway, the store SHALL hold none of that turn's items.

#### Scenario: Failure while saving
- **WHEN** saving a turn fails after some of its items were written
- **THEN** loading returns only the items saved before that turn

### Requirement: A completed turn is saved and the next turn sees it
When the agent handles a message, it SHALL run the turn on the stored conversation, and once the turn completes, save every item the turn added.

#### Scenario: Second message sees the first
- **WHEN** the agent handles one message, then a second message on the same store
- **THEN** the model's first call for the second message is sent the first turn's items followed by the second message

### Requirement: A failed turn saves nothing
If a turn fails, the agent SHALL leave the stored conversation exactly as it was before the message.

#### Scenario: Model failure
- **WHEN** the model call fails while the agent handles a message
- **THEN** the stored conversation is unchanged
