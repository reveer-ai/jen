# Spec Delta

## ADDED Requirements

### Requirement: A turn's final text is the agent's reply to its parent
When the agent saves a model response with no tool calls, its reply SHALL be the response's assistant text, joined and trimmed. An agent with a parent agent SHALL put the reply in its outbox in the same transaction that saves the response, unless the reply is empty and no reply is owed, when it SHALL send nothing. A root SHALL have no outbox: its reply is the saved assistant message on its event stream.

#### Scenario: A sub-agent replies
- **WHEN** a sub-agent given a task by its parent ends its turn with the text "Herons wait in reeds"
- **THEN** its parent receives the message "Herons wait in reeds" from the sub-agent

#### Scenario: Nothing is owed
- **WHEN** a sub-agent woken by a message from `runtime` ends its turn with no text
- **THEN** nothing is sent to its parent

#### Scenario: An empty reply is owed
- **WHEN** a sub-agent whose parent sent it "Thanks" ends its turn with no text
- **THEN** its parent receives a message with empty text from the sub-agent

#### Scenario: A root replies
- **WHEN** a root ends its turn with the text "Canberra"
- **THEN** nothing is posted, and its event stream holds the assistant message "Canberra"

### Requirement: A reply is owed once the parent has messaged the agent
A reply SHALL be owed to the parent once a non-empty message from the parent has been delivered to the agent, as a conversation message or in a `wait` result, since the agent last saved a response with no tool calls.

#### Scenario: A message in a wait result
- **WHEN** the agent's parent sends it a message that answers its open `wait`, and the agent's next response ends its turn with no text
- **THEN** its parent receives a message with empty text

### Requirement: Replies are posted from the outbox
After every save, and on start before the loop runs, the agent SHALL post its outbox entries to its parent in order, through the runtime, deleting each one once the runtime answers `202`. A failed post SHALL be retried after 1, 5 and 25 seconds. If every retry fails, the entry SHALL stay in the outbox, the agent's event stream SHALL show a notice that its reply wasn't sent, and each later save and each start SHALL try again. A post the runtime answers `404` SHALL delete the entry.

#### Scenario: A post fails once
- **WHEN** the first post of a reply fails and its retry succeeds
- **THEN** the parent receives the reply once, and the outbox is empty

#### Scenario: Crash before the post
- **WHEN** the agent crashes after saving a reply to its outbox and before posting it, and starts again
- **THEN** it posts the reply before its loop runs

#### Scenario: The parent is down
- **WHEN** every post of a reply fails
- **THEN** the reply stays in the outbox, the event stream shows the notice, and the next save posts it

#### Scenario: The parent was deleted
- **WHEN** the runtime answers a post with `404`
- **THEN** the entry is deleted and not posted again

### Requirement: The parent's messages reach the model with no sender
The agent SHALL pass each message from its parent to the model with an empty sender. Messages from anyone else SHALL keep their sender. The store SHALL keep every message's real sender.

#### Scenario: A message from the parent
- **WHEN** a sub-agent's parent sends it "write a haiku"
- **THEN** the model is sent a user message "write a haiku" with an empty sender, and the event stream shows it from the parent's ID

#### Scenario: A message from a sub-agent
- **WHEN** sub-agent `a1` sends the agent "done: the haiku"
- **THEN** the model is sent it from `a1`

### Requirement: An empty message never wakes the agent
An accepted message with empty text SHALL clear its sender's debt like any message, and SHALL never be urgent. It SHALL NOT be delivered as a conversation message, and SHALL NOT cause a model call by itself. It SHALL be shown only in a `wait` result. An empty message still in the inbox when the agent saves a response with no tool calls, or accepted while the agent's conversation ends with an assistant message and has no outstanding call, SHALL be dropped.

#### Scenario: An empty reply after a thank-you
- **WHEN** a root has ended its turn and its sub-agent sends it an empty message
- **THEN** the root's model isn't called, and the message is dropped

#### Scenario: An empty reply during a step
- **WHEN** an empty message arrives while the agent runs a tool call, and the model then ends its turn
- **THEN** the message is never sent to the model, and the inbox is empty

#### Scenario: An empty reply while others still work
- **WHEN** the agent waits on `a1` and `a2`, and `a1` sends an empty message
- **THEN** the `wait` stays open, and is answered with both messages once `a2` replies

### Requirement: A wait is answered from the inbox
The loop SHALL answer a `wait` call itself, never running it as a tool. When the `wait` comes up, the loop SHALL answer it at once if the inbox holds a non-empty message or no sub-agent owes a reply, and otherwise SHALL stop with the call open, holding nothing in memory. Each accepted message SHALL start the loop, which SHALL answer an open `wait` under the same rule. An urgent message SHALL NOT cancel a `wait`.

#### Scenario: Waiting on a sub-agent
- **WHEN** the agent calls `wait` while `a1` owes a reply and the inbox is empty
- **THEN** the loop stops with the call open and no model call, and when `a1`'s reply is accepted, the call's result holds the reply and the model is called

#### Scenario: Nothing to wait for
- **WHEN** the agent calls `wait` while no sub-agent owes a reply and the inbox is empty
- **THEN** the call is answered at once

#### Scenario: The parent interrupts a wait
- **WHEN** the agent waits on `a1`, and its parent sends it a message
- **THEN** the `wait` is answered with the parent's message

#### Scenario: Urgent message during a wait
- **WHEN** the agent waits on `a1`, and an urgent message arrives
- **THEN** the `wait` is answered with the urgent message

### Requirement: A wait comes after the rest of its batch
The loop SHALL run a batch's other calls before its `wait`, and give each further `wait` in the same batch `Error: you already waited in this batch.`

#### Scenario: Sends go out before the wait
- **WHEN** one response holds `wait`, then a `message_sub_agent` call
- **THEN** the send runs first, then the loop handles the `wait`

#### Scenario: Two waits in a batch
- **WHEN** one response holds two `wait` calls
- **THEN** the second gets `Error: you already waited in this batch.`

### Requirement: A wait's result shows the messages and who still owes a reply
A `wait` result SHALL show each message it answers with, in arrival order, as `From: <sender>`, a blank line, then the text, separated by `---` lines. A message from the parent SHALL be shown as its text alone, and an empty message as its `From:` line alone. A `---` line and a status line SHALL end the result.

#### Scenario: One reply of two
- **WHEN** the agent waits on `a1` and `a2`, and `a1` replies "first"
- **THEN** the result is `From: a1`, a blank line, `first`, a `---` line, and `Still working: a2.`

#### Scenario: An empty reply
- **WHEN** the agent waits on `a1` only, and `a1` sends an empty message
- **THEN** the result is `From: a1`, a `---` line, and the status that every sub-agent has replied

#### Scenario: A message from the parent
- **WHEN** the agent waits on `a1`, and its parent sends "stop and report"
- **THEN** the result is `stop and report`, a `---` line, and `Still working: a1.`

### Requirement: A wait's status line says who still owes a reply
A `wait` result's status line SHALL be `Still working: <ids>.` naming every sub-agent that still owes a reply, or `Every sub-agent you sent work to has replied. End your turn with your result for your parent.` when none does. A `wait` answered at once with nothing owed and nothing in the inbox SHALL get only `Nothing to wait for: none of your sub-agents owes you a reply.`

#### Scenario: The last reply
- **WHEN** the agent waits on `a1` only, and `a1` replies "done"
- **THEN** the result ends with `Every sub-agent you sent work to has replied. End your turn with your result for your parent.`

#### Scenario: Nothing owed, nothing waiting
- **WHEN** the agent calls `wait` while no sub-agent owes a reply and the inbox is empty
- **THEN** the result is `Nothing to wait for: none of your sub-agents owes you a reply.`

### Requirement: An open wait survives a restart
When the agent starts and its only outstanding call is a `wait`, the call SHALL stay open, and be answered as any open `wait` is.

#### Scenario: Restart during a wait
- **WHEN** the agent stops with an open `wait` while `a1` owes a reply, starts again, and then accepts `a1`'s reply
- **THEN** no model call is made before the reply, and the `wait`'s result holds the reply

### Requirement: A start settles an old batch without running it
When the agent starts with outstanding tool calls, other than a lone `wait`, it SHALL run none of them. Taking the calls in the order the loop runs them, the first SHALL get `Error: interrupted before its result was saved, so whether it took effect is unknown.`, and each later one, a `wait` included, SHALL get `Error: not run, because the agent was stopped first. Call it again if it's still wanted.` The next step SHALL then call the model.

#### Scenario: Crash after a saved call with a message waiting
- **WHEN** the agent crashes after saving A's result from a response with calls A, B and C, with a message in its inbox, and starts again
- **THEN** A isn't run again, B gets the interrupted error, C gets the not-run error, and the next model call is sent those results followed by the message

#### Scenario: Crash between two results of one response
- **WHEN** a response holds a tool call, then text, then a second tool call, and the agent crashes after the first call's result is saved
- **THEN** on start the second call gets the interrupted error and the first isn't run again

#### Scenario: Crash before a wait in its batch
- **WHEN** the agent crashes while running A from a response with calls A and `wait`, and starts again
- **THEN** A gets the interrupted error, the `wait` gets the not-run error, and the model is called

#### Scenario: Finished steps aren't repeated
- **WHEN** the agent crashes after a `spawn_agent` call's result is saved, and starts again
- **THEN** no second spawn happens

## MODIFIED Requirements

### Requirement: A turn starts from a user message and the existing conversation
A model call SHALL send the model the whole stored conversation, including every message delivered to it, along with the descriptions of the available tools and the agent's system instructions.

#### Scenario: First turn of a conversation
- **WHEN** an agent with an empty conversation is sent the message "hello" by its parent
- **THEN** the model is sent exactly one item: a user message "hello" with an empty sender

#### Scenario: Later turn of a conversation
- **WHEN** an agent whose conversation holds a received message and an assistant reply is sent a new message
- **THEN** the model is sent those two items followed by the new message, in order

#### Scenario: Tools are described to the model
- **WHEN** a model call runs with tools available
- **THEN** it receives every tool's name, description and input schema

### Requirement: The turn ends when the model answers without calling a tool
The agent SHALL keep calling the model while its responses contain tool calls or its inbox holds a non-empty message. It SHALL stop after the first response that contains no tool calls when the inbox holds no non-empty message.

#### Scenario: Direct answer
- **WHEN** the model's first response is an assistant message with no tool calls and no message is waiting
- **THEN** the loop stops after one model call

#### Scenario: Answer after tool use
- **WHEN** the model calls a tool, then answers with a message, and no message is waiting
- **THEN** the loop stops after the second model call

### Requirement: The agent works while it has work
The agent SHALL run its loop one step at a time while it has work, and stop when it has none. It has work when its most recent model response holds a tool call with no saved result, other than a `wait` the loop can't answer yet; when its inbox holds a non-empty message; or when its conversation doesn't end with an assistant message. Whether it has work SHALL be read from its store alone.

#### Scenario: Turn ends when the inbox is empty
- **WHEN** the model answers without calling a tool and the inbox is empty
- **THEN** the loop stops after that model call

#### Scenario: Turn continues for a waiting message
- **WHEN** the model answers without calling a tool while a message waits in the inbox
- **THEN** the message is delivered and the model is called again

#### Scenario: Idle agent gets a message
- **WHEN** the loop isn't running and a message is accepted
- **THEN** the loop starts and the message reaches the model

#### Scenario: An open wait isn't work
- **WHEN** the conversation's last item is a `wait` call with no result, a sub-agent owes a reply, and the inbox is empty
- **THEN** the loop stops without calling the model

### Requirement: A step settles calls, delivers messages, then calls the model
Each step SHALL first settle the outstanding tool calls of the most recent model response, running them in order and saving each result before the next call starts; then move every non-empty inbox message into the conversation in arrival order, in one transaction; then call the model with the whole conversation and save its response as soon as it returns.

#### Scenario: Plain message between two tool calls
- **WHEN** the model's response holds tool calls A and B, and a plain message arrives while A runs
- **THEN** A and B both run, and the next model call is sent A's result, B's result, then the message

#### Scenario: Message never splits a call from its result
- **WHEN** a message arrives while a tool call runs
- **THEN** in the saved conversation the call's result directly follows the response that made the call, and the message comes after every result of that response

### Requirement: An urgent message skips the rest of a batch
Before running each outstanding tool call, the agent SHALL check its inbox for an urgent message. If one is there, it SHALL run none of the remaining calls, and give each one the result `Error: not run, because an urgent message arrived first. Call it again if it's still wanted.`, except a `wait`, which SHALL be answered with the inbox.

#### Scenario: Urgent message between two tool calls
- **WHEN** the model's response holds tool calls A and B, and an urgent message arrives after A's result is saved
- **THEN** B doesn't run, its result is the not-run error, and the next model call is sent A's result, B's result, then the message

#### Scenario: Urgent message before a wait
- **WHEN** the model's response holds tool call A and a `wait`, and an urgent message arrives while A runs
- **THEN** A is cancelled, and the `wait`'s result holds the urgent message

#### Scenario: Urgent message to an idle agent
- **WHEN** an urgent message arrives while the loop isn't running
- **THEN** it is delivered and the model is called, as for any message

### Requirement: An agent that gives up tells its parent
When an agent stops its loop after its model kept failing, an agent with a parent agent SHALL put `My model is failing, so I've stopped working. Error: <error>. Message me to try again.` in its outbox. A root SHALL instead show that notice on its own event stream.

#### Scenario: Sub-agent gives up
- **WHEN** a sub-agent's model fails on every retry
- **THEN** its parent receives the notice as a message from the sub-agent's ID, holding the provider's error

## REMOVED Requirements

### Requirement: A start never carries on an old batch
**Reason**: A start now keeps an open `wait` that is the only outstanding call, and the exception for an interrupted send to `owner` is gone with that send. Replaced by "A start settles an old batch without running it" and "An open wait survives a restart".
**Migration**: None. Saved conversations aren't migrated.
