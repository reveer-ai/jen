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
