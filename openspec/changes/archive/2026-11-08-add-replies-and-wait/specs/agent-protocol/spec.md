# Spec Delta

## MODIFIED Requirements

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
