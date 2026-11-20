## ADDED Requirements

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

## MODIFIED Requirements

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
