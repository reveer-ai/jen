# agent-loop Specification

## Purpose
Defines how a jen agent runs one conversation turn: taking a user message, working with the model and its tools until the model answers, and reporting what happened.

## Requirements

### Requirement: A turn starts from a user message and the existing conversation
A model call SHALL send the model the whole stored conversation, including every message delivered to it, along with the descriptions of the available tools and the agent's system instructions.

#### Scenario: First turn of a conversation
- **WHEN** an agent with an empty conversation is sent the message "hello" by `owner`
- **THEN** the model is sent exactly one item: a user message "hello" from `owner`

#### Scenario: Later turn of a conversation
- **WHEN** an agent whose conversation holds a received message and an assistant reply is sent a new message
- **THEN** the model is sent those two items followed by the new message, in order

#### Scenario: Tools are described to the model
- **WHEN** a model call runs with tools available
- **THEN** it receives every tool's name, description and input schema

### Requirement: Tool calls are run and their results returned to the model
When the model's response contains tool calls, the agent SHALL run each one, in the order given, with the input the model supplied. It SHALL then call the model again with the conversation extended by the response and by one tool result per call, each tied to its call.

#### Scenario: One tool call
- **WHEN** the model asks for tool `lookup` with input `{"key": "a"}`
- **THEN** `lookup` runs with `{"key": "a"}`, and the next model call includes the tool call followed by a result holding `lookup`'s output and that call's id

#### Scenario: Several tool calls in one response
- **WHEN** one model response asks for tool calls A then B
- **THEN** A runs before B, and the next model call includes A's result followed by B's result

### Requirement: The turn ends when the model answers without calling a tool
The agent SHALL keep calling the model while its responses contain tool calls or its inbox holds a message. It SHALL stop after the first response that contains no tool calls when the inbox is empty.

#### Scenario: Direct answer
- **WHEN** the model's first response is an assistant message with no tool calls and no message is waiting
- **THEN** the loop stops after one model call

#### Scenario: Answer after tool use
- **WHEN** the model calls a tool, then answers with a message, and no message is waiting
- **THEN** the loop stops after the second model call

### Requirement: Tool failures are reported to the model
If a tool throws, or the model asks for a tool that isn't available, the agent SHALL record a tool result whose output starts with `Error:` and describes the failure, and SHALL continue the turn.

#### Scenario: Tool throws
- **WHEN** a tool throws an error with message "not found"
- **THEN** its result's output is `Error: not found`, and the model is called again

#### Scenario: Unknown tool
- **WHEN** the model asks for a tool named `missing` that isn't available
- **THEN** its result's output starts with `Error:` and names `missing`, and the model is called again

### Requirement: Model failures end the turn
If a model call fails, the agent SHALL save nothing for that call and SHALL keep every step already saved. It SHALL then retry or wait, as a failed model call requires.

#### Scenario: Model call fails mid-turn
- **WHEN** the second model call of a turn fails
- **THEN** the first response, its tool calls and their results stay saved, and nothing is saved for the failed call

### Requirement: The agent works while it has work
The agent SHALL run its loop one step at a time while it has work, and stop when it has none. It has work when its most recent model response holds a tool call with no saved result, when its inbox holds a message, or when its conversation doesn't end with an assistant message. Whether it has work SHALL be read from its store alone.

#### Scenario: Turn ends when the inbox is empty
- **WHEN** the model answers without calling a tool and the inbox is empty
- **THEN** the loop stops after that model call

#### Scenario: Turn continues for a waiting message
- **WHEN** the model answers without calling a tool while a message waits in the inbox
- **THEN** the message is delivered and the model is called again

#### Scenario: Idle agent gets a message
- **WHEN** the loop isn't running and a message is accepted
- **THEN** the loop starts and the message reaches the model

### Requirement: A step settles calls, delivers messages, then calls the model
Each step SHALL first run the outstanding tool calls of the most recent model response in order, saving each result before the next call starts; then move every inbox message into the conversation in arrival order, in one transaction; then call the model with the whole conversation and save its response as soon as it returns.

#### Scenario: Plain message between two tool calls
- **WHEN** the model's response holds tool calls A and B, and a plain message arrives while A runs
- **THEN** A and B both run, and the next model call is sent A's result, B's result, then the message

#### Scenario: Message never splits a call from its result
- **WHEN** a message arrives while a tool call runs
- **THEN** in the saved conversation the call's result directly follows the response that made the call, and the message comes after every result of that response

### Requirement: An urgent message cancels the work in flight
When an urgent message is accepted while the loop runs, the agent SHALL cancel the model call or tool call in flight. A cancelled model call SHALL save nothing and SHALL NOT count as a failure. A cancelled tool call SHALL get the result `Error: cancelled by an urgent message before its result was saved, so whether it took effect is unknown.` The step SHALL then deliver the inbox and call the model.

#### Scenario: Urgent during a model call
- **WHEN** an urgent message arrives while the agent waits on a model call
- **THEN** that call is cancelled with nothing saved, and the next model call is sent the conversation followed by the urgent message

#### Scenario: Urgent during a tool call
- **WHEN** an urgent message arrives while tool call A runs
- **THEN** A is cancelled, its result is the cancellation error, and the next model call ends with A's result then the message

### Requirement: An urgent message skips the rest of a batch
Before running each outstanding tool call, the agent SHALL check its inbox for an urgent message. If one is there, it SHALL run none of the remaining calls, and give each one the result `Error: not run, because an urgent message arrived first. Call it again if it's still wanted.`

#### Scenario: Urgent message between two tool calls
- **WHEN** the model's response holds tool calls A and B, and an urgent message arrives after A's result is saved
- **THEN** B doesn't run, its result is the not-run error, and the next model call is sent A's result, B's result, then the message

#### Scenario: Urgent message to an idle agent
- **WHEN** an urgent message arrives while the loop isn't running
- **THEN** it is delivered and the model is called, as for any message

### Requirement: A start never carries on an old batch
When the agent starts with outstanding tool calls, it SHALL run none of them. The first SHALL get `Error: interrupted before its result was saved, so whether it took effect is unknown.`, except a send to `owner`, which SHALL get `Error: interrupted before it was sent, so it wasn't delivered.` Each later one SHALL get `Error: not run, because the agent was stopped first. Call it again if it's still wanted.` The next step SHALL then call the model.

#### Scenario: Crash after a saved call with a message waiting
- **WHEN** the agent crashes after saving A's result from a response with calls A, B and C, with a message in its inbox, and starts again
- **THEN** A isn't run again, B gets the interrupted error, C gets the not-run error, and the next model call is sent those results followed by the message

#### Scenario: Crash between two results of one response
- **WHEN** a response holds a tool call, then text, then a second tool call, and the agent crashes after the first call's result is saved
- **THEN** on start the second call gets the interrupted error and the first isn't run again

#### Scenario: Owner send interrupted by a crash
- **WHEN** the agent crashes while a send to `owner` is outstanding and starts again
- **THEN** that call's result is the not-delivered error, and the model is called

#### Scenario: Finished steps aren't repeated
- **WHEN** the agent crashes after a `spawn_agent` call's result is saved, and starts again
- **THEN** no second spawn happens

### Requirement: A waking start holds the loop until a message arrives
An agent started with `JEN_WAKE` SHALL NOT run its loop until it has saved a message since that start, which it records by saving the wake ID with the first message it accepts. If its store already holds that wake ID, it SHALL run the loop at once. A start without `JEN_WAKE` SHALL run the loop at once.

#### Scenario: Woken with a batch that never started
- **WHEN** a stopped agent with outstanding calls is started with `JEN_WAKE` and then sent the waking message
- **THEN** its first model call after the start is sent the recovery results followed by the waking message

#### Scenario: A notice after the waking message
- **WHEN** a held agent is sent the waking message, then a notice from `runtime` while its first model call runs, and that call answers without a tool call
- **THEN** the loop doesn't stop, and the next model call is sent the notice

#### Scenario: Crash restart after the waking message
- **WHEN** an agent has saved its waking message and its process restarts with the same `JEN_WAKE`
- **THEN** it runs its loop at once without waiting for another message

#### Scenario: Waking message never comes
- **WHEN** an agent started with `JEN_WAKE` never gets its waking message, and is later sent a message from its parent
- **THEN** that message ends the hold and the loop runs

### Requirement: A failed model call is retried, then the agent waits
A failed model call SHALL save nothing, and the agent SHALL retry it after 1, 5 and 25 seconds. If every retry fails, the agent SHALL stop its loop until a message is accepted or it starts again, either of which SHALL resume the work where it stopped.

#### Scenario: Transient failure
- **WHEN** a model call fails once and its first retry succeeds
- **THEN** the response is saved and the loop continues

#### Scenario: Persistent failure
- **WHEN** a model call and all three retries fail
- **THEN** the loop stops, and a later message resumes it with a model call

### Requirement: An agent that gives up tells its parent
When an agent stops its loop after its model kept failing, it SHALL send its parent, from its own ID, `My model is failing, so I've stopped working. Error: <error>. Message me to try again.` A root agent, and an agent whose send fails, SHALL instead show that notice on its own event stream.

#### Scenario: Sub-agent gives up
- **WHEN** a sub-agent's model fails on every retry
- **THEN** its parent receives the notice as a message from the sub-agent's ID, holding the provider's error
