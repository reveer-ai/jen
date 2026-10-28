# Spec Delta

## Purpose

Defines how clients talk to a jen agent over HTTP: sending it a message, watching its conversation on an event stream and resuming that stream, and the token every request carries. Users, other agents and the UI all use this one protocol.

## ADDED Requirements

### Requirement: Every request carries the agent's token
The agent SHALL serve a request only when its `Authorization` header is `Bearer` followed by the agent's token. Any other request SHALL get status 401 with a `WWW-Authenticate: Bearer` header, and SHALL have no effect on the conversation.

#### Scenario: Missing token
- **WHEN** a client sends a message without an `Authorization` header
- **THEN** it gets 401 and the stored conversation is unchanged

#### Scenario: Wrong token
- **WHEN** a client opens the event stream with a bearer token that isn't the agent's
- **THEN** it gets 401 and no events

### Requirement: Sending a message runs a turn and returns its reply
`POST /messages` with a JSON body `{"text": "<message>"}` SHALL run one turn on the stored conversation. Once the turn is saved, the response SHALL be status 200 with the JSON body `{"reply": "<reply>"}`. The reply is the text of the assistant messages that end the turn, separated by blank lines.

#### Scenario: One message
- **WHEN** a client posts `{"text": "hello"}`
- **THEN** the agent runs one turn on `hello`, saves it, and responds 200 with the assistant's reply

#### Scenario: Second message sees the first
- **WHEN** a client posts one message, then a second
- **THEN** the second turn is run on the conversation that includes the first turn

### Requirement: An invalid message is rejected
A `POST /messages` whose body isn't JSON, or whose `text` isn't a non-empty string, SHALL get status 400 with a JSON body `{"error": "<message>"}`, and SHALL run no turn.

#### Scenario: Empty text
- **WHEN** a client posts `{"text": ""}`
- **THEN** it gets 400 and the stored conversation is unchanged

#### Scenario: Not JSON
- **WHEN** a client posts a body that isn't JSON
- **THEN** it gets 400 and the stored conversation is unchanged

### Requirement: The agent runs one turn at a time
While a turn is running, any further `POST /messages` SHALL get status 409 with a JSON error body, and SHALL run no turn. Once the running turn ends, the agent SHALL accept messages again.

#### Scenario: Message during a turn
- **WHEN** a client posts a message while another message's turn is still running
- **THEN** the second post gets 409, and only the first turn is saved

#### Scenario: Message after a turn
- **WHEN** a turn has ended and a client posts a message
- **THEN** the agent runs it

### Requirement: A failed turn is reported to its sender
If a turn fails, its `POST /messages` SHALL get status 500 with a JSON body `{"error": "<message>"}`. The stored conversation SHALL be unchanged, and the agent SHALL keep serving requests.

#### Scenario: Model unreachable
- **WHEN** the model call fails during a turn
- **THEN** the post gets 500 with the error, the stored conversation is unchanged, and the next message is handled normally

### Requirement: A turn outlives its sender's connection
If the client that sent a message disconnects before its turn ends, the agent SHALL finish the turn and save it.

#### Scenario: Sender hangs up
- **WHEN** a client posts a message and closes the connection before the reply
- **THEN** the turn is still saved, and its items reach the event stream

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
Every open stream SHALL receive a turn's items once the turn is saved, in order, with none missed or repeated. A failed turn SHALL send no events.

#### Scenario: Live turn
- **WHEN** a stream is open and a client posts a message whose turn completes
- **THEN** the stream receives that turn's items in order, after any items it already had

#### Scenario: Several watchers
- **WHEN** two streams are open and a turn completes
- **THEN** each receives that turn's items once

#### Scenario: Failed turn
- **WHEN** a stream is open and a turn fails
- **THEN** the stream receives no events for it

### Requirement: A quiet event stream is kept alive
While a stream has nothing to send, the agent SHALL write an SSE comment line at least every 15 seconds.

#### Scenario: Idle stream
- **WHEN** a stream is open and no turn runs for 15 seconds
- **THEN** the client receives a comment line within that time

### Requirement: Unknown routes are not found
A request with a valid token to any route other than `POST /messages` and `GET /events` SHALL get status 404 with a JSON error body.

#### Scenario: Unknown path
- **WHEN** a client sends `GET /status` with the token
- **THEN** it gets 404
