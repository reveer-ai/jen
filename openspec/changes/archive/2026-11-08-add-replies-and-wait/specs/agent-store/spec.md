# Spec Delta

## ADDED Requirements

### Requirement: The inbox can be delivered as a wait's result
The store SHALL save the result of a `wait` call from the inbox in one transaction: it SHALL build the result from every inbox message, empty ones included, in arrival order, save it as the call's result, and clear the inbox. A crash SHALL leave either all of that done or none of it.

#### Scenario: Answering a wait
- **WHEN** two messages are in the inbox and a `wait` call is answered from it
- **THEN** the conversation ends with the call's result, which shows both messages, and the inbox is empty

#### Scenario: Failure while answering
- **WHEN** answering a `wait` fails partway through
- **THEN** the inbox still holds its messages, and the call has no result

### Requirement: The store records whether a reply to the parent is owed
The store SHALL record that a reply is owed in the same transaction that delivers a non-empty message from the agent's parent, whether into the conversation or into a `wait` result. It SHALL clear the record in the same transaction that saves a response with no tool calls. The record SHALL survive closing and reopening.

#### Scenario: Owed after delivery
- **WHEN** a message from the parent is delivered and the store is reopened
- **THEN** a reply is owed

#### Scenario: Cleared by the reply
- **WHEN** a reply is owed and a response with no tool calls is saved
- **THEN** no reply is owed

### Requirement: The outbox holds replies until the parent has them
The store SHALL keep an outbox of replies for the parent, in the order saved, across closing and reopening. A response with no tool calls and its reply SHALL be saved in one transaction. An entry SHALL leave the outbox only when it's deleted.

#### Scenario: Reply saved with its response
- **WHEN** a response with no tool calls is saved with the reply "done"
- **THEN** the conversation ends with the response, and the outbox holds "done"

#### Scenario: Outbox survives reopening
- **WHEN** two replies are in the outbox and the store is reopened
- **THEN** the outbox holds both in order

### Requirement: The store records which sub-agents owe a reply
The store SHALL keep the set of sub-agent IDs that owe the agent a reply, across closing and reopening. Accepting a message SHALL remove its sender from the set in the same transaction that saves the message.

#### Scenario: A reply clears its sender
- **WHEN** `a1` and `a2` owe a reply and a message from `a1` is accepted
- **THEN** only `a2` owes a reply

#### Scenario: The record survives reopening
- **WHEN** `a1` owes a reply and the store is reopened
- **THEN** `a1` still owes a reply

## MODIFIED Requirements

### Requirement: The inbox holds messages until they're delivered
The store SHALL keep an inbox of accepted messages, each with its sender, text and urgency, in arrival order, across closing and reopening. Delivering SHALL move every non-empty inbox message into the conversation in arrival order in one transaction, so a message is either in the inbox or in the conversation, never both and never neither. Empty messages SHALL stay in the inbox until a `wait` result shows them or they're dropped, and dropping SHALL remove every empty message from the inbox.

#### Scenario: Inbox survives reopening
- **WHEN** a message is saved to the inbox and the store is closed and reopened
- **THEN** the inbox still holds that message with its sender and urgency

#### Scenario: Delivery moves messages
- **WHEN** two messages are in the inbox and the inbox is delivered
- **THEN** the inbox is empty, and the conversation ends with both messages in arrival order

#### Scenario: Delivery leaves empty messages
- **WHEN** a message with text and an empty message are in the inbox and the inbox is delivered
- **THEN** the conversation ends with the message with text, and the inbox holds only the empty message
