# Spec Delta

## ADDED Requirements

### Requirement: Sending a message puts it in the inbox
`POST /messages` with a JSON body `{"text": "<message>"}` and an optional boolean `urgent` SHALL save the message, with its sender and urgency, in the agent's inbox, and answer status 202 once it's saved. The response SHALL hold no reply: replies arrive later as messages or on the event stream.

#### Scenario: Message to an idle agent
- **WHEN** a client posts `{"text": "hello"}` to an idle agent
- **THEN** it gets 202 once the message is saved, and the agent starts working on it

#### Scenario: Acknowledged means durable
- **WHEN** a client gets 202 for a message and the agent's process is killed straight after
- **THEN** the message is in the store when the agent next starts, and the agent works on it

### Requirement: A message during work is accepted
A `POST /messages` that arrives while the agent is working SHALL be saved to the inbox and answered 202, like any other. The agent SHALL NOT refuse a message because it is busy.

#### Scenario: Message during a turn
- **WHEN** a client posts a message while the agent is waiting on a model call
- **THEN** it gets 202, and the message reaches the model on a later model call

### Requirement: Every message carries its sender
The agent SHALL take a message's sender from its `Jen-From` header, which only the runtime sets. A `POST /messages` without a non-empty `Jen-From` SHALL get status 400 and save nothing. The sender SHALL be kept with the message and shown on the event stream once the message is delivered.

#### Scenario: No sender
- **WHEN** a client with the agent's token posts a message without `Jen-From`
- **THEN** it gets 400 and the inbox is unchanged

#### Scenario: Sender recorded
- **WHEN** a message arrives with `Jen-From: owner`
- **THEN** once delivered it appears on the event stream as a user message whose `from` is `owner`

### Requirement: Model failures are sent as error events
Each failed model call SHALL be sent to every open event stream as an event of type `error` whose `data` is `{"message": "<error>"}`, with no `id`. Nothing SHALL be saved for it.

#### Scenario: Model unreachable
- **WHEN** a stream is open and a model call fails
- **THEN** the stream receives an `error` event with the failure's message and no `id`, and no item is saved

### Requirement: A root agent that gave up tells every watcher
While a root agent has stopped trying after its model kept failing, every event stream already open, and every one opened later, SHALL receive the agent's failure notice as an `error` event. Once the agent works again, new streams SHALL NOT receive it.

#### Scenario: Owner connects after the failure
- **WHEN** a root agent has given up on its model, and the owner then opens its event stream
- **THEN** after the saved items, the stream receives an `error` event holding the notice

#### Scenario: After recovery
- **WHEN** the owner messages the root, and its next model call succeeds
- **THEN** a stream opened afterwards receives no notice

## MODIFIED Requirements

### Requirement: An invalid message is rejected
A `POST /messages` whose body isn't JSON, whose `text` isn't a non-empty string, or whose `urgent` is present and not a boolean, SHALL get status 400 with a JSON body `{"error": "<message>"}`, and SHALL save nothing. A body larger than 1 MiB SHALL get status 413, and the agent SHALL stop reading it once it passes that size.

#### Scenario: Empty text
- **WHEN** a client posts `{"text": ""}`
- **THEN** it gets 400 and the inbox and conversation are unchanged

#### Scenario: Not JSON
- **WHEN** a client posts a body that isn't JSON
- **THEN** it gets 400 and the inbox and conversation are unchanged

#### Scenario: Urgent isn't a boolean
- **WHEN** a client posts `{"text": "stop", "urgent": "yes"}`
- **THEN** it gets 400 and the inbox is unchanged

#### Scenario: Oversized body
- **WHEN** a client posts a body larger than 1 MiB
- **THEN** it gets 413, the rest isn't read, and the inbox is unchanged

### Requirement: The event stream sends only saved items
Every open stream SHALL receive each item once it's saved, in order, with none missed or repeated. Each model response, tool call result and delivered message SHALL be sent as soon as it's saved, not when its turn ends. A received message SHALL be sent once it's delivered, not when it arrives in the inbox. A turn that fails SHALL keep the items it already sent.

#### Scenario: Live turn
- **WHEN** a stream is open and the model calls a tool and then answers
- **THEN** the stream receives the tool call before the tool runs, its result once the tool finishes, and the answer once it's saved, in order

#### Scenario: Several watchers
- **WHEN** two streams are open and items are saved
- **THEN** each receives every item once

#### Scenario: Failed turn
- **WHEN** a stream is open and a model call fails after a tool call and its result were saved
- **THEN** the stream has received the tool call and its result, and receives no item for the failed call

## REMOVED Requirements

### Requirement: Sending a message runs a turn and returns its reply
**Reason**: Sending never waits for a reply, so two agents can't deadlock waiting on each other. A message is saved to the inbox and answered 202.
**Migration**: Read replies from `GET /events`, or, between agents, as messages sent back.

### Requirement: The agent runs one turn at a time
**Reason**: A message that arrives while the agent works is accepted into the inbox and reaches the model before its next model call. The `409` is gone.
**Migration**: None. Clients no longer need to retry a refused message.

### Requirement: A failed turn is reported to its sender
**Reason**: The sender's request ends when the message is saved, before any turn runs. Failures are sent as `error` events on the event stream, and a failed turn keeps the steps it finished.
**Migration**: Watch `GET /events` for `error` events.

### Requirement: A turn outlives its sender's connection
**Reason**: A message's request ends once the message is saved, so no turn is tied to its sender's connection.
**Migration**: None.
