## MODIFIED Requirements

### Requirement: A failed model call is retried, then the agent waits
A failed model call SHALL save nothing, and the agent SHALL retry it after 1, 5 and 25 seconds. If every retry fails, the agent SHALL stop its loop until a message is accepted or it starts again, either of which SHALL resume the work where it stopped. If a message is waiting when the last retry fails, the agent SHALL NOT stop, but SHALL deliver the message and retry from the start.

#### Scenario: Transient failure
- **WHEN** a model call fails once and its first retry succeeds
- **THEN** the response is saved and the loop continues

#### Scenario: Persistent failure
- **WHEN** a model call and all three retries fail
- **THEN** the loop stops, and a later message resumes it with a model call

#### Scenario: A message arrives during the retries
- **WHEN** a message is accepted while the last retry is in flight, and that retry fails
- **THEN** the agent doesn't give up, and calls the model again with the message delivered
