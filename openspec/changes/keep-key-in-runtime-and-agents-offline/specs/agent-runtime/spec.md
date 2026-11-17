## MODIFIED Requirements

### Requirement: The runtime requires its configuration
The runtime SHALL read the owner's token from `JEN_OWNER_TOKEN` and the model settings it makes agents' model calls with from `JEN_MODEL`, `JEN_API_KEY` and the optional `JEN_BASE_URL`. If `JEN_OWNER_TOKEN`, `JEN_MODEL` or `JEN_API_KEY` is missing or empty, it SHALL exit non-zero at startup with an error naming the variable, and SHALL start no agents and serve nothing.

#### Scenario: Missing owner token
- **WHEN** the runtime starts without `JEN_OWNER_TOKEN`
- **THEN** it exits non-zero and its error names `JEN_OWNER_TOKEN`

#### Scenario: Missing API key
- **WHEN** the runtime starts without `JEN_API_KEY`
- **THEN** it exits non-zero and its error names `JEN_API_KEY`

### Requirement: The runtime alone decides how an agent runs
The runtime SHALL start every agent from the agent image named by `JEN_AGENT_IMAGE` (default `jen-agent`), with the same fixed settings: its own state volume, the agents' network, the runtime's model ID as `JEN_MODEL`, the agent's token and the runtime's address. No agent SHALL be given the API key or the model endpoint, in its environment or any other way. It SHALL start every workspace from the image named by `JEN_WORKSPACE_IMAGE` (default `jen-workspace`) with the workspace's fixed settings. Nothing a caller sends, other than the validated grant and a command's text and timeout, SHALL reach any container's configuration. No agent's port SHALL be published.

#### Scenario: Extra fields are ignored
- **WHEN** a spawn request carries fields besides `grant`
- **THEN** the agent is started with the same settings as without them

#### Scenario: Extra fields on a command
- **WHEN** a command request carries fields besides `command` and `timeout`
- **THEN** the command runs as it would without them

#### Scenario: No key in an agent
- **WHEN** the runtime starts an agent, with `JEN_BASE_URL` set
- **THEN** the agent's container configuration holds neither the value of `JEN_API_KEY` nor that of `JEN_BASE_URL`

## ADDED Requirements

### Requirement: Only an agent calls the model
`POST /model/responses` SHALL be the runtime's only route under `/model`; every other path there SHALL get `404`. Only an agent may call it, and the owner SHALL get `403`. A body over 32 MiB SHALL get `413`. Nothing refused SHALL reach the provider.

#### Scenario: The owner calls the model route
- **WHEN** the owner posts to `/model/responses`
- **THEN** it gets `403` and nothing reaches the provider

#### Scenario: Another provider path
- **WHEN** an agent posts to `/model/files`
- **THEN** it gets `404` and nothing reaches the provider

#### Scenario: An oversized call
- **WHEN** an agent posts a body over 32 MiB to `/model/responses`
- **THEN** it gets `413` and nothing reaches the provider

### Requirement: The runtime makes agents' model calls
The runtime SHALL send an agent's checked model call, serialized again, to `<JEN_BASE_URL>/responses` (default `https://api.openai.com/v1/responses`) with `Authorization: Bearer <JEN_API_KEY>`, JSON `Content-Type` and `Accept`, and no other header of the caller's. It SHALL stream the provider's status, headers less hop-by-hop ones, and body back unchanged, and abort the provider's call when the caller hangs up. An unreachable provider SHALL get the caller `502` with `{"error"}`.

#### Scenario: An agent calls the model
- **WHEN** a running agent posts a valid request to `/model/responses` with its own token
- **THEN** the provider receives it with the owner's key, and the agent receives the provider's response

#### Scenario: The agent hangs up
- **WHEN** an agent hangs up while its model call is in flight
- **THEN** the runtime aborts the call to the provider

#### Scenario: Provider errors pass through
- **WHEN** the provider answers `429` with `retry-after`
- **THEN** the agent gets `429` with the same `retry-after` and body

#### Scenario: The provider can't be reached
- **WHEN** the provider's address doesn't answer
- **THEN** the agent gets `502` with `{"error"}`

### Requirement: A model call carries only what jen's adapter sends
The runtime SHALL accept a model call only if its body is a JSON object with exactly `model` (a string), `instructions` (a string), `input` and `tools` (arrays, as the next requirement says) and `store` (`false`), with no other field at any level. It SHALL refuse any other with `400` and `{"error"}` naming the first field that doesn't fit, and send nothing to the provider. It SHALL replace `model` with its own `JEN_MODEL`.

#### Scenario: The adapter's own request
- **WHEN** an agent sends the request the Responses adapter builds for a conversation with messages, tool calls and their results
- **THEN** it's accepted

#### Scenario: An unknown field
- **WHEN** a request carries `previous_response_id`
- **THEN** it gets `400` naming `previous_response_id`, and nothing reaches the provider

#### Scenario: Another model
- **WHEN** a request names a model other than `JEN_MODEL`
- **THEN** the provider receives the request with `JEN_MODEL` as its model

### Requirement: A model call's input is text and its tools are functions
Each element of `input` SHALL be exactly one of `{"role": "user" | "assistant", "content": <string>}`, `{"type": "function_call", "call_id", "name", "arguments"}` with string values, or `{"type": "function_call_output", "call_id", "output"}` with string values. Each element of `tools` SHALL be exactly `{"type": "function", "name": <string>, "description": <string>, "parameters": <object>, "strict": <boolean>}`. Anything else SHALL be refused as the previous requirement says.

#### Scenario: An image by URL
- **WHEN** a request's input holds a message whose content is an array with an `input_image` part
- **THEN** it gets `400` naming that content, and nothing reaches the provider

#### Scenario: A hosted tool
- **WHEN** a request's tools hold `{"type": "web_search"}`
- **THEN** it gets `400` and nothing reaches the provider

### Requirement: Agents' network reaches nothing beyond the runtime and the agents
The runtime SHALL create its network, named for the runtime, as an internal Docker network with IPv6 disabled and an isolated IPv4 gateway, and SHALL join it under the alias `runtime`. Agents SHALL be started on that network only. An agent SHALL reach the runtime and other agents on it, and SHALL NOT reach the internet, any address of the engine's host, or a DNS server outside the network. The runtime SHALL reach the model provider through the network it was started on.

#### Scenario: An agent reaches the runtime
- **WHEN** a process in an agent's container connects to `runtime:8080`
- **THEN** it connects

#### Scenario: An agent can't reach out
- **WHEN** a process in an agent's container connects to a public address, looks up a public name, or connects to a service listening on all of the engine's host's interfaces
- **THEN** each fails

### Requirement: The agent's container is probed on every push
The boundary live check (see `agent-workspace`) SHALL also probe the agent's own container. It SHALL fail if the agent's environment, or any of its processes', holds the runtime's API key or `JEN_BASE_URL`; if the agent can't reach the runtime; or if it reaches a public address, gets a DNS answer for a public name, or reaches a listener on the engine's host network at any address that host has.

#### Scenario: The agent's boundary holds
- **WHEN** the boundary live check runs with Docker
- **THEN** every probe of the agent's container passes, or the check fails naming the one that didn't

### Requirement: The model route is probed on every push
The boundary live check SHALL start a stand-in model provider on Docker's default bridge and give its address to the runtime as `JEN_BASE_URL`, so it needs no model credentials. It SHALL fail if a valid model call from inside the agent's container doesn't reach the stand-in with the runtime's model and key, or if a call with an `input_image` part isn't refused with `400` or reaches the stand-in.

#### Scenario: The proxy holds
- **WHEN** the boundary live check runs with Docker
- **THEN** the valid call reaches the stand-in with the runtime's model and key, and the `input_image` call reaches nothing
