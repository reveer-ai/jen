# agent-protocol Specification

## Purpose
Defines how clients talk to a jen agent over HTTP: sending it a message, watching its conversation on an event stream and resuming that stream, and the token every request carries. Users, other agents and the UI all use this one protocol.

## Requirements

### Requirement: Every request carries the agent's token
The agent SHALL serve a request only when its `Authorization` header is `Bearer` followed by the agent's token. Any other request SHALL get status 401 with a `WWW-Authenticate: Bearer` header, and SHALL have no effect on the conversation.

#### Scenario: Missing token
- **WHEN** a client sends a message without an `Authorization` header
- **THEN** it gets 401 and the stored conversation is unchanged

#### Scenario: Wrong token
- **WHEN** a client opens the event stream with a bearer token that isn't the agent's
- **THEN** it gets 401 and no events

### Requirement: An invalid message is rejected
A `POST /messages` whose body isn't JSON, whose `text` isn't a string, or whose `urgent` is present and not a boolean, SHALL get status 400 with a JSON body `{"error": "<message>"}`, and SHALL save nothing. Empty `text` SHALL be accepted: it's an empty reply. A body larger than 1 MiB SHALL get status 413, and the agent SHALL stop reading it once it passes that size.

#### Scenario: Text isn't a string
- **WHEN** a client posts `{"text": 5}`
- **THEN** it gets 400 and the inbox and conversation are unchanged

#### Scenario: Empty text
- **WHEN** a client posts `{"text": ""}`
- **THEN** it gets 202, and the agent handles it as an empty message

#### Scenario: Not JSON
- **WHEN** a client posts a body that isn't JSON
- **THEN** it gets 400 and the inbox and conversation are unchanged

#### Scenario: Urgent isn't a boolean
- **WHEN** a client posts `{"text": "stop", "urgent": "yes"}`
- **THEN** it gets 400 and the inbox is unchanged

#### Scenario: Oversized body
- **WHEN** a client posts a body larger than 1 MiB
- **THEN** it gets 413, the rest isn't read, and the inbox is unchanged

### Requirement: The event stream sends the conversation
`GET /events` SHALL respond with status 200 and a `text/event-stream` body that stays open. Each conversation item SHALL be one event of type `item`. Its `data` SHALL be the item as JSON, and its `id` SHALL be the item's position in the conversation. Without a `Last-Event-ID` header, the stream SHALL begin with the first item.

#### Scenario: New client
- **WHEN** a client opens the stream on a conversation of two turns
- **THEN** it receives every item of both turns in order, each as an `item` event whose `id` is the item's position

#### Scenario: Empty conversation
- **WHEN** a client opens the stream before any message
- **THEN** the stream stays open and sends no `item` events

### Requirement: The event stream resumes after the last event seen
When `GET /events` carries a `Last-Event-ID` header, the stream SHALL begin with the first item after that position, and SHALL send nothing at or before it.

#### Scenario: Reconnect
- **WHEN** a client that received items up to position 2 reopens the stream with `Last-Event-ID: 2` on a conversation of four items
- **THEN** it receives items 3 and 4 and no others

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

### Requirement: A watcher that stops reading doesn't grow the agent's memory
When a client stops reading its event stream, the agent SHALL stop sending to that stream once the stream's buffer is full, and SHALL resume where it stopped once the client reads again. What it holds for the stream SHALL stay bounded, however many items are saved meanwhile. Other streams and requests SHALL be served normally.

#### Scenario: Stalled watcher
- **WHEN** a client opens the stream on a long conversation and reads nothing while more turns are saved
- **THEN** the agent's buffer for that stream stays bounded, other watchers and messages are served normally, and once the client reads it receives every item in order, with none missed or repeated

### Requirement: A quiet event stream is kept alive
While a stream has nothing to send, the agent SHALL write an SSE comment line at least every 15 seconds.

#### Scenario: Idle stream
- **WHEN** a stream is open and no turn runs for 15 seconds
- **THEN** the client receives a comment line within that time

### Requirement: Unknown routes are not found
A request with a valid token to any route other than `POST /messages` and `GET /events` SHALL get status 404 with a JSON error body.

Any request that fails unexpectedly SHALL end with that request, and SHALL NOT stop the agent.

#### Scenario: Unknown path
- **WHEN** a client sends `GET /status` with the token
- **THEN** it gets 404

#### Scenario: A target that looks like a host
- **WHEN** a client sends a request whose target is `//`, with the token
- **THEN** it gets 404, and the agent keeps serving

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
While a root agent has stopped trying after its model kept failing, every event stream already open, and every one opened later, SHALL receive the agent's failure notice as an `error` event whose `data` is `{"message": "<notice>", "gaveUp": true}`. No other `error` event SHALL carry `gaveUp`. Once the agent accepts a message, which makes it try again, new streams SHALL NOT receive it.

#### Scenario: Owner connects after the failure
- **WHEN** a root agent has given up on its model, and the owner then opens its event stream
- **THEN** after the saved items, the stream receives an `error` event holding the notice, with `gaveUp` true

#### Scenario: Watching as it gives up
- **WHEN** a stream is open while a root agent's model calls fail until it gives up
- **THEN** the stream receives an `error` event for each failed call without `gaveUp`, then the notice with `gaveUp` true

#### Scenario: Messaged again
- **WHEN** the owner messages a root that gave up, and its model calls still fail
- **THEN** a stream opened while it retries receives no notice

#### Scenario: After recovery
- **WHEN** the owner messages the root, and its next model call succeeds
- **THEN** a stream opened afterwards receives no notice

### Requirement: The agent serves its page and its UI
`GET /page` SHALL answer `200` with jen's fixed page as `text/html`, with its Content Security Policy and `Cache-Control: no-store`. `GET /ui` SHALL answer `200` with `{"version": <n>, "document": "<html>"}` as `application/json`: the latest published version, or version 0, the textbox, when none has been published. Both SHALL require the agent's token, as every route does.

#### Scenario: Before any publish
- **WHEN** a client requests `/ui` from an agent that has published nothing
- **THEN** it gets version 0 and the textbox's document

#### Scenario: After a publish
- **WHEN** a client requests `/ui` after the agent published version 2
- **THEN** it gets version 2 and its document

### Requirement: The event stream says when it has caught up
Whenever `GET /events` has sent every item saved so far, it SHALL send an event of type `synced` whose `data` is `{"seq": <n>}`, where `n` is the position of the last item the stream has sent, or 0 if none. It SHALL send one when it opens, after any history it resumes, and one after each later batch of items. A `synced` SHALL never come between items saved in the same step.

#### Scenario: Opening on history
- **WHEN** a client opens the stream on a conversation of four items
- **THEN** it receives items 1 to 4 and then `synced` with `seq` 4, before anything saved later

#### Scenario: Opening on an empty conversation
- **WHEN** a client opens the stream before any message
- **THEN** it receives `synced` with `seq` 0 and no `item` events

#### Scenario: A step arrives whole
- **WHEN** the agent saves a model response of an assistant message and a tool call while a client watches
- **THEN** the client receives both items and then one `synced`, with no `synced` between them

#### Scenario: Resuming
- **WHEN** a client reopens the stream with `Last-Event-ID: 2` on a conversation of four items
- **THEN** it receives items 3 and 4 and then `synced` with `seq` 4
