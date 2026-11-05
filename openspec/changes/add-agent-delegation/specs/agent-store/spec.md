# Spec Delta

## ADDED Requirements

### Requirement: Each step is saved on its own
The store SHALL save each model response, each tool result and each delivery of messages as its own transaction, durable once the save returns. A failed save SHALL leave the store as it was before that save.

#### Scenario: Response saved before its tools run
- **WHEN** the model returns a response holding a tool call
- **THEN** the response is in the store before the tool runs

#### Scenario: Failure while saving a step
- **WHEN** saving a model response fails after some of its items were written
- **THEN** loading returns only the items saved before that response

### Requirement: The inbox holds messages until they're delivered
The store SHALL keep an inbox of accepted messages, each with its sender, text and urgency, in arrival order, across closing and reopening. Delivering SHALL move every inbox message into the conversation in arrival order in one transaction, so a message is either in the inbox or in the conversation, never both and never neither.

#### Scenario: Inbox survives reopening
- **WHEN** a message is saved to the inbox and the store is closed and reopened
- **THEN** the inbox still holds that message with its sender and urgency

#### Scenario: Delivery moves messages
- **WHEN** two messages are in the inbox and the inbox is delivered
- **THEN** the inbox is empty, and the conversation ends with both messages in arrival order

### Requirement: The store keeps the wake ID that ended a hold
The store SHALL save a wake ID in the same transaction as the message that ended its hold, and SHALL report whether it holds a given wake ID, across closing and reopening.

#### Scenario: Wake ID with its message
- **WHEN** a message is saved together with wake ID `w1` and the store is reopened
- **THEN** the store holds both the message and `w1`

## MODIFIED Requirements

### Requirement: A loaded conversation holds every saved item in order
Loading a store SHALL return every item it has saved, in the order saved, each equal to the item that was saved, including after the store is closed and opened again.

#### Scenario: Reload after reopening
- **WHEN** one turn's items are saved, then a second turn's, and the store is closed and reopened
- **THEN** loading returns the first turn's items followed by the second's, each equal to what was saved

#### Scenario: Every item type survives
- **WHEN** a received message with a sender, an assistant message, a tool call with nested JSON input, and a tool result are saved and the store is reopened
- **THEN** each loads back equal to what was saved

## REMOVED Requirements

### Requirement: A turn is saved whole or not at all
**Reason**: Each step is saved the moment it happens, so an interrupted turn can resume from its last saved step. Atomicity now applies to each step (see "Each step is saved on its own").
**Migration**: None.

### Requirement: A completed turn is saved and the next turn sees it
**Reason**: Replaced by per-step saves and the loop working from the stored conversation (`agent-loop`).
**Migration**: None.

### Requirement: A failed turn saves nothing
**Reason**: A failed model call now keeps the steps already saved, which is an accurate record. What a failure saves is defined in `agent-loop` ("Model failures end the turn").
**Migration**: None.
