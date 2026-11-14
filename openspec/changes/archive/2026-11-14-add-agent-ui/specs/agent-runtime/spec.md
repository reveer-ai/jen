## MODIFIED Requirements

### Requirement: Every request carries a credential
The runtime SHALL serve its API on port 8080, and every request but `GET /agents/:id/page` SHALL carry `Authorization: Bearer <token>`, where the token is either the owner's token or the current token of a running agent. Any other request SHALL get `401` with `WWW-Authenticate: Bearer`, and its body SHALL NOT be read. The caller is the principal the token belongs to: the owner, or that agent.

#### Scenario: No token
- **WHEN** a request other than for an agent's page arrives without a bearer token
- **THEN** it gets `401` and nothing changes

#### Scenario: A stopped agent's token
- **WHEN** an agent is stopped and a request presents the token it had while running
- **THEN** it gets `401`

### Requirement: Requests to an agent are relayed
`POST /agents/:id/messages`, `GET /agents/:id/events` and `GET /agents/:id/ui` SHALL be relayed to that agent's `agent-protocol` `/messages`, `/events` and `/ui`, passing the body and `Last-Event-ID` through and streaming the agent's response back unchanged. The caller SHALL NOT need, or ever receive, the agent's token. If the agent's response breaks off, the caller's response SHALL end too. `GET /agents/:id/ui` SHALL be refused with `403` unless the agent is a root whose grant has `workspace`.

#### Scenario: The owner talks to a root agent
- **WHEN** the owner posts a message to `/agents/:id/messages` for a running root agent
- **THEN** it gets `202` once the message is saved, and `/agents/:id/events` streams the conversation, including the agent's reply

#### Scenario: A stopped agent
- **WHEN** the owner posts a message to a stopped agent
- **THEN** the agent is started and the message relayed to it

#### Scenario: An agent stops while its events stream
- **WHEN** a caller is reading `/agents/:id/events` and the agent stops or crashes
- **THEN** the caller's stream ends, so it can reconnect

#### Scenario: A sub-agent's UI
- **WHEN** the owner requests `/agents/:id/ui` for a sub-agent
- **THEN** it gets `403`

#### Scenario: The UI of a root without workspace
- **WHEN** the owner requests `/agents/:id/ui` for a root whose grant has no `workspace`
- **THEN** it gets `403`

## ADDED Requirements

### Requirement: A root agent's page is relayed without a credential
`GET /agents/:id/page` SHALL be relayed to the agent's `/page` without a credential, only when the agent is a running root whose grant has `workspace`. For any other ID, whether a stopped agent, a sub-agent, a root without `workspace` or one that doesn't exist, it SHALL answer one `404`, `no UI for agent <id>`, and start nothing.

#### Scenario: The owner opens a root's page
- **WHEN** a browser requests `/agents/:id/page` for a running root agent with `workspace` and no `Authorization` header
- **THEN** it gets the agent's page

#### Scenario: A sub-agent's page
- **WHEN** a request without a credential asks for a running sub-agent's page
- **THEN** it gets the same `404` as for an ID that doesn't exist

#### Scenario: The page of a root without workspace
- **WHEN** a request without a credential asks for the page of a running root whose grant has no `workspace`
- **THEN** it gets the same `404` as for an ID that doesn't exist
