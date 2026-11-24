# Spec Delta

## ADDED Requirements

### Requirement: The runtime counts each agent's model usage
For every model call it proxies, the runtime SHALL count a call for the calling agent and add the answer's `usage`: input, cached input, output and reasoning tokens, and `cost` when the provider reports one. A call whose answer has no `usage` or doesn't parse SHALL count as a call with no tokens. Counting SHALL change nothing the agent receives. Counts SHALL be kept in memory for every agent since the runtime started, deleted agents included.

#### Scenario: A call with usage
- **WHEN** an agent's model call is answered with `usage` of 120 input tokens, 20 of them cached, and 30 output tokens, 10 of them reasoning
- **THEN** that agent's count gains one call, 120 input, 20 cached, 30 output and 10 reasoning tokens, and the agent receives the answer unchanged

#### Scenario: A failed call
- **WHEN** the provider answers an agent's call with `429` and no `usage`
- **THEN** that agent's count gains one call and no tokens

#### Scenario: A deleted agent
- **WHEN** an agent that made model calls is deleted
- **THEN** its counts are still reported

### Requirement: The owner reads usage
`GET /usage` SHALL answer the owner `200` with `{"agents": [...]}`, one entry for each agent with counts: `id`, `root` (the root it belongs to), `calls`, `inputTokens`, `cachedTokens`, `outputTokens`, `reasoningTokens`, and `cost` only when a provider reported one. An agent SHALL get `403`. Nothing an agent's tools show its model SHALL include usage.

#### Scenario: Usage by root
- **WHEN** a root and its sub-agent have each made model calls, and the owner gets `/usage`
- **THEN** both entries are listed, each with that root's ID as `root`

#### Scenario: An agent asks
- **WHEN** an agent gets `/usage` with its own token
- **THEN** it gets `403`

#### Scenario: Listing is unchanged
- **WHEN** an agent with sub-agents that made model calls lists `/agents`
- **THEN** no entry carries usage
