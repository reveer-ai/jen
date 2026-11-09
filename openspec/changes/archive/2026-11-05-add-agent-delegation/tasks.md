# Tasks

## 1. Model port: senders, instructions and cancellation

- [x] 1.1 Add `from` to user messages in the port's item types, a third `instructions` argument and a fourth `AbortSignal` argument to `Model.next()`, and have the scripted model record instructions and fail promptly on abort; verify with model-port unit tests for the round trip of a message with `from`, recorded instructions, and a cancelled scripted call
- [x] 1.2 Map a received message to a user message prefixed `From: <sender>` and a blank line, send `instructions`, and pass the signal through to the OpenAI client in the Responses adapter; verify with adapter unit tests for the mapping, the instructions field and an aborted request

## 2. Store: per-step saves, inbox and wake ID

- [x] 2.1 Replace the whole-turn `append()` with one transaction per step, add the `inbox` table (sender, text, urgency, arrival order), a delivery that moves every inbox message into `items` in one transaction, and a wake ID saved with the message that ends a hold; verify with store tests for each `agent-store` scenario, including reopening and a failed save

## 3. Loop: one step at a time, urgent cancellation and recovery

- [x] 3.1 Replace `runTurn()` and `respond()` with a step function and a loop that runs while the store says there's work: find outstanding calls by ID, settle them in order with the urgent check before each, deliver the inbox, call the model and save its response; stream each save as it happens; verify with loop tests for the step order and the plain- and urgent-message-between-two-calls scenarios
- [x] 3.2 Cancel the step in flight through an `AbortSignal` when an urgent message is accepted mid-loop, recording the cancelled and not-run results; verify with tests for urgent during a model call and during a tool call
- [x] 3.3 Add start-up recovery (interrupted first call, owner send not delivered, later calls not run) and the `JEN_WAKE` hold that ends with the first message accepted since the start, saving the wake ID with it; verify with tests for every `agent-loop` crash and wake scenario, including the waking message held back while recovery is ready to run
- [x] 3.4 Retry a failed model call after 1, 5 and 25 seconds (with injectable delays for tests), then stop the loop until a message or start; on giving up, send the parent the failure notice, or show it on the stream for a root or a failed send; verify with tests for a transient failure, a persistent one, and the notice to parent and root

## 4. Protocol: inbox over HTTP and error events

- [x] 4.1 Change `POST /messages` to save into the inbox and answer `202`, require `Jen-From`, take an optional boolean `urgent`, cap bodies at 1 MiB with `413`, and drop the `409` and the reply body; verify with server tests for every new and modified `agent-protocol` scenario, including acknowledged-means-durable
- [x] 4.2 Send `error` events with no `id` for each failed model call, and re-send a root's give-up notice to every open and new stream until it recovers; verify with server tests for the error event, a late-connecting watcher and the notice clearing after recovery

## 5. Delegation tools

- [x] 5.1 Read and validate `JEN_AGENT_ID`, `JEN_PARENT` and `JEN_GRANT` at start-up and `JEN_WAKE` when set, in `main.ts`; verify with tests that each missing or malformed variable exits non-zero naming it
- [x] 5.2 Add `src/agent/delegation.ts` with a `node:http` runtime client and the tools `send_message` (always), and `spawn_agent`, `list_agents`, `stop_agent`, `start_agent` and `delete_agent` (only with `spawn`), turning runtime refusals into errors with status and message, and a root's send to `owner` into a no-I/O `delivered`; verify with tests against a stub runtime for each `agent-delegation` tool scenario
- [x] 5.3 Build the system instructions from the agent's ID, parent and grant as decision 11 lays out, and pass them on every model call; verify with a loop test that the scripted model records instructions holding both IDs

## 6. Runtime: senders, parents, waking and notices

- [x] 6.1 Reserve `owner` and `runtime` as IDs that every route answers with `404`, stamp `Jen-From` on every relayed message and strip any `Jen-From` from the caller, and open `POST /agents/:id/messages` to the caller's parent; verify with runtime server tests for each scenario in those requirements
- [x] 6.2 Pass `JEN_AGENT_ID`, `JEN_PARENT` and `JEN_GRANT` to every agent container; verify with a fake-Docker test of a sub-agent's environment
- [x] 6.3 Start a stopped target before relaying a message, in the tree-operation queue, with a fresh `JEN_WAKE`; relay the waking message first and the stopped-sub-agents notice after it, and send the notice alone, with `JEN_WAKE`, on an explicit start with stopped children; verify with runtime tests for the waking, plain-start and explicit-start scenarios, and that `/events` on a stopped agent still gets `409`
- [x] 6.4 Watch the engine's events for a container that exits and won't restart, and send its parent the restarts-ran-out notice from `runtime`; verify with a fake-Docker test for a child and a root

## 7. Live checks and docs

- [x] 7.1 Move the container and runtime live checks to read replies from the event stream, and update the curl commands and the `/messages` description in `record/environment.md`; verify with `npm run test:live` against Docker passing and the documented commands running as written
- [x] 7.2 Add the delegation live check: the owner asks a root agent for work it delegates to a sub-agent, the sub-agent asks the root a question and gets an answer, and the result reaches the owner as a `delivered` send on the root's stream; verify with `npm run test:live` passing with Docker and credentials, and record in the pull request whether the model followed the instructions without help
- [x] 7.3 Run `npm run check` and `npm test`, and `openspec validate add-agent-delegation --strict`; verify all three pass

## 8. Fixes from the full review

- [x] 8.1 Check an exit inside the tree-operation queue, and report it only if the container still exists, is exited and is the agent's current one; verify with runtime tests for a stop and a start queued ahead of the exit
- [x] 8.2 Give the runtime's messages to agents a 10-second deadline; verify with a test of a receiver that never answers, and of a start whose notice is never answered followed by a stop
- [x] 8.3 Count only `delivered` sends to `owner` as replies in both live checks, not assistant text; verify with `npm run test:live` passing

## Workflow follow-up

- Archive the change once the pull request is reviewed and merged.
