## REMOVED Requirements

### Requirement: The model is configured through the environment
**Reason**: The agent no longer holds the model key or endpoint; the runtime makes its model calls.
**Migration**: See "The agent calls the model through the runtime" below. Anything that starts the agent image itself gives it `JEN_MODEL`, `JEN_TOKEN` and a `JEN_RUNTIME_URL` that serves `/model/responses`.

## ADDED Requirements

### Requirement: The agent calls the model through the runtime
The agent SHALL read its model ID from `JEN_MODEL`, and SHALL call the model at `<JEN_RUNTIME_URL>/model`, defaulting to `http://runtime:8080/model`, with its own token, `JEN_TOKEN`, as the API key. It SHALL read no API key and no model endpoint. If `JEN_MODEL` or `JEN_TOKEN` is missing, it SHALL exit non-zero with an error naming the variable and save nothing.

#### Scenario: Missing model
- **WHEN** the agent runs without `JEN_MODEL`
- **THEN** it exits non-zero, its error names `JEN_MODEL`, and the stored conversation is unchanged

#### Scenario: Model calls go to the runtime
- **WHEN** the agent calls the model
- **THEN** the call goes to `<JEN_RUNTIME_URL>/model/responses` with `Authorization: Bearer <JEN_TOKEN>`

#### Scenario: No key needed
- **WHEN** the agent runs with `JEN_MODEL` and `JEN_TOKEN` and without `JEN_API_KEY`
- **THEN** it starts and serves its protocol
