# Tasks

## 1. Lab: the empty reply as approved

- [x] 1.1 Build a lab image from `lab/bc10/` with the approved empty reply (posted only when owed, never wakes the parent, shown by `wait` as a bare `From:` line, dropped at turn end), and a second image whose leaves drop their first reply; run the `thanks` task 6 times and the dropped-reply tasks 9 times on Luna, plus the six live-check tasks as a regression; verify with `lab/tally.mjs` and the transcripts that no thank-you draws an extra owner reply or a model call, and that every parent asks again for a dropped result, and record the results in the design

## 2. Store: wait results, outbox and debts

- [x] 2.1 Add the `outbox`, `owed` and owed-reply records to `src/agent/store.ts`: deliver only non-empty messages, drop empty ones, answer a `wait` from the inbox in one transaction, save a turn-ending response with its reply, record a reply owed when a parent's message is delivered, and clear a sender's debt when its message is accepted; verify with store tests for every `agent-store` scenario

## 3. Loop: replies and wait

- [x] 3.1 Save a turn's final text as the reply, post the outbox after every save and on start with the model-call retry delays, drop a `404`'d entry, show a notice while an entry is stuck, and move the give-up notice into the outbox; verify with loop tests for each reply and outbox scenario in `agent-loop`
- [x] 3.2 Answer `wait` in the loop: run it after its batch, refuse a second one, answer or stop under the inbox and debt rules, keep it open across a restart when it's the only outstanding call, never cancel it for an urgent message, and build its result and status line; pass the parent's messages to the model with an empty sender, and keep empty messages from waking the agent; verify with loop tests for every `wait`, empty-message and recovery scenario

## 4. Protocol and adapter

- [x] 4.1 Accept empty `text` on `POST /messages`, and send a message with an empty sender as plain user content in the Responses adapter; verify with server and adapter tests for the modified scenarios

## 5. Delegation tools, instructions and wiring

- [x] 5.1 Replace `send_message` with `message_sub_agent`, offered only with `spawn`: refuse the parent and names for it, turn a `404` into the no-sub-agent error, record and clear debts, and return the new result text; leave the parent out of `spawn_agent` and `list_agents` results and list only direct sub-agents; clear a debt on a confirmed stop or delete; verify with delegation tests against a stub runtime for each `agent-delegation` tool scenario
- [x] 5.2 Rewrite the instructions from `lab/bc10-instructions.md` to say what the spec lists, tuned by the lab results, and wire the parent, `wait`, the outbox post and the debts in `src/agent/main.ts`; verify with delegation tests that the instructions hold no IDs and that an agent without `spawn` gets no tools

## 6. Live checks and docs

- [x] 6.1 Read owner replies as assistant messages with no tool call in the same response in `src/runtime/runtime.live.test.ts` and `src/agent/container.live.test.ts`, and update the commands and `/messages` description in `record/environment.md`; verify with `npm run test:live` passing those checks
- [x] 6.2 Add `src/runtime/behavior.live.test.ts` from `lab/harness.ts`, with the six tasks three times each and the failure rules in `agent-delegation`; verify by running it on Luna, and report its pass rate to the maintainer before committing it
- [x] 6.3 Update `docs/architecture.html` where it shows a reply as a send, and run `npm run check`, `npm test` and `openspec validate add-replies-and-wait --strict`; verify all three pass

## 7. Review fixes

- [x] 7.1 Look the receiver up in `message_sub_agent` and go on only for a direct sub-agent, since the runtime also delivers to the parent and every descendant; verify with delegation tests for a grandchild, the parent, a made-up name and a sub-agent deleted before the post, and with the runtime live check
- [x] 7.2 Leave the parent out of `stop_agent` and `start_agent` results; verify with a delegation test using the runtime's real answer shape
- [x] 7.3 Abort an outbox post with no answer after 60 seconds, even one that ignores its signal, so retries, the notice and later saves still run; verify with loop tests for a post that's never answered
- [x] 7.4 Read a reply in the live checks as the text of a whole model response with no tool call anywhere in it, from one helper in `src/agent/model/replies.ts`, and only once the stream has been quiet; verify with unit tests for text after, between and before tool calls and for a response read in part, and with `npm run test:live`
