# openai-responses-adapter Specification

## Purpose
Lets a jen agent use any model served through the OpenAI Responses API, from OpenAI directly or from a compatible endpoint such as OpenRouter, while jen keeps the conversation.

## Requirements

### Requirement: The adapter is configured with a model, an API key and an optional endpoint
The adapter SHALL be configured with a model name and an API key. It SHALL use OpenAI's endpoint unless a base URL is given, in which case it SHALL send every request to that URL instead.

#### Scenario: Default endpoint
- **WHEN** the adapter is configured with only a model and an API key
- **THEN** its requests go to OpenAI's API, authenticated with that key, naming that model

#### Scenario: Compatible endpoint
- **WHEN** the adapter is configured with the base URL `https://openrouter.ai/api/v1`
- **THEN** its requests go to OpenRouter's Responses endpoint

### Requirement: The adapter relies on no conversation state kept by the provider
Every request SHALL carry the whole conversation and SHALL turn off the provider's storage of response state. No request SHALL refer to a response or item stored by the provider. This is not a data-retention guarantee: what else the provider retains depends on its policies and the account's data controls.

#### Scenario: Request contents
- **WHEN** the adapter is called with a conversation of several items
- **THEN** the request includes every item, turns off response storage, and carries no previous-response reference and no stored item ids

### Requirement: jen items map to Responses input
The adapter SHALL send user and assistant messages as messages with that role and text, tool calls as function calls with the same call id, name and JSON-encoded input, and tool results as function call outputs with the same call id and output.

#### Scenario: A tool exchange is sent
- **WHEN** the conversation holds a user message, a tool call with id `c1` and input `{"key": "a"}`, and a result for `c1`
- **THEN** the request input is a user message, a function call with call id `c1` and arguments encoding `{"key": "a"}`, and a function call output for `c1`

### Requirement: Tool descriptions map to function tools
The adapter SHALL send each tool description as a function tool with the same name, description and input schema, without strict schema enforcement.

#### Scenario: A tool is offered
- **WHEN** the adapter is called with a tool description `lookup`
- **THEN** the request offers a non-strict function tool `lookup` with that description and schema

### Requirement: Responses output maps to jen items
The adapter SHALL return each output message as one assistant message holding its text, including the explanation of any refusal, and each function call as a tool call with the provider's call id, the name, and the parsed input, in output order. It SHALL drop reasoning output.

#### Scenario: Text and a function call
- **WHEN** the response output is a message with text "checking" followed by a function call `lookup` with call id `c1`
- **THEN** the adapter returns an assistant message "checking", then a tool call `lookup` with id `c1` and the parsed input

#### Scenario: Refusal
- **WHEN** the response output is a message whose content is a refusal explaining "I can't help with that."
- **THEN** the adapter returns an assistant message "I can't help with that."

#### Scenario: Reasoning output
- **WHEN** the response output includes a reasoning item
- **THEN** nothing is returned for it

### Requirement: Unexpected output fails the call
The adapter SHALL fail the call if the output holds an item type it doesn't map, or a function call whose arguments aren't valid JSON.

#### Scenario: Unmapped output type
- **WHEN** the response output holds an item type other than a message, function call or reasoning
- **THEN** the call fails with an error naming that type

#### Scenario: Malformed arguments
- **WHEN** a function call's arguments aren't valid JSON
- **THEN** the call fails with an error naming the tool

### Requirement: Provider failures surface as jen errors
When a request fails, or the provider reports in a successful response that generation failed, the adapter SHALL fail the call with a standard error that keeps the provider's message and holds the original error as its cause.

#### Scenario: Authentication failure
- **WHEN** the provider rejects the API key
- **THEN** the call fails with a standard error carrying the provider's message, with the provider's error as its cause

#### Scenario: Failed generation in a successful response
- **WHEN** the provider answers with a successful HTTP status, but the response's status is `failed` with the error message "Generation failed"
- **THEN** the call fails with a standard error carrying "Generation failed", with the provider's error as its cause

### Requirement: The loop works against a real model through the adapter
A turn run through the adapter against a real model SHALL complete a tool exchange. This check SHALL run only when credentials and a model are configured, and SHALL be skipped otherwise.

#### Scenario: Live tool exchange
- **WHEN** credentials and a model are configured, and a turn asks a question only a provided tool can answer
- **THEN** the turn holds a tool call and its result, and the final assistant message contains the tool's answer

#### Scenario: No credentials
- **WHEN** no API key or model is configured
- **THEN** the live check is skipped, not failed
