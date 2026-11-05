# agent-store Specification

## Purpose
Defines how a jen agent persists its conversation so it outlives the process that ran it: what a fresh start loads, what is saved when a turn completes or fails, and the stable position each saved item gets.

## Requirements

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
- **WHEN** a received message with a sender, an assistant message, a tool call with nested JSON input, and a tool result are saved and the store is reopened
- **THEN** each loads back equal to what was saved

### Requirement: Each saved item has a stable position
The store SHALL give each saved item a position that is greater than every position before it, and never changes or repeats, including after the store is closed and opened again. Reading the items after a position SHALL return every item saved after it, in order, each with its position. Reading after position 0 SHALL return every item. A read MAY be limited to a number of items, and SHALL then return only the first that many.

#### Scenario: Items after a position
- **WHEN** two turns of two items each are saved, and the items after the second item's position are read
- **THEN** the second turn's two items are returned in order, each with its position

#### Scenario: Positions survive reopening
- **WHEN** a turn is saved, the store is closed and reopened, and another turn is saved
- **THEN** the first turn's items keep their positions, and the new items' positions are greater than all of them

#### Scenario: Limited read
- **WHEN** four items are saved, and at most two items after the first item's position are read
- **THEN** the second and third items are returned, in order

#### Scenario: Nothing after the last item
- **WHEN** the items after the last saved item's position are read
- **THEN** no items are returned

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
