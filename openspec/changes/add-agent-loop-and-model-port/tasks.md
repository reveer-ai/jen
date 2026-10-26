# Tasks

## 1. TypeScript project

- [x] 1.1 Create `package.json` (ESM, Node ≥ 26, scripts `check`, `test`, `test:live`) and install `openai`, `typescript`, `vitest` and `@types/node`. Verify with `npm ci` from a clean checkout.
- [x] 1.2 Add `tsconfig.json` (strict, `noEmit`, `erasableSyntaxOnly`, `verbatimModuleSyntax`, `.ts` import extensions) and the Vitest config, with `npm test` excluding `*.live.test.ts` and `test:live` running only those files. Verify that `npm run check` passes and that a non-erasable construct such as an `enum` fails it.
- [ ] 1.3 Add `.github/workflows/ci.yml` running `npm ci`, `npm run check` and `npm test` on Node 26 for every push and pull request. Verify the workflow passes on this branch's pull request.
- [x] 1.4 Record the layout and the `check`, `test` and `test:live` commands in `context/environment.md`. Verify each documented command runs as written.

## 2. Model port and scripted model

- [x] 2.1 Write `src/model/port.ts` with `Json`, `Item`, `ToolSpec` and `Model`, as in the design. Verify that `npm run check` passes and a JSON round-trip test over every item type passes.
- [x] 2.2 Write `src/model/scripted.ts` (`ScriptedModel`) with tests for in-order playback, snapshot recording and failure once the script runs out. Verify with `npm test`.

## 3. Agent loop

- [x] 3.1 Write `src/agent/loop.ts` (`Tool`, `runTurn`) against the scripted model, with a test for each `agent-loop` scenario: first and later turns, tool descriptions, one and several tool calls, ending the turn, returned items, an untouched caller conversation, tool errors, unknown tools, and model failure mid-turn. Verify with `npm test`.

## 4. OpenAI Responses adapter

- [x] 4.1 Write `src/model/openai-responses.ts` (`OpenAIResponsesModel`) with unit tests against a stubbed `fetch` passed to the SDK client. Cover the request shape (all items, `store: false`, no stored ids, non-strict function tools, base URL), the output mapping, dropped reasoning, unmapped types, malformed arguments and wrapped errors. Verify with `npm test`, and with a search showing `openai` is imported only in this file.
- [ ] 4.2 Write `src/model/openai-responses.live.test.ts` per the design's live check, skipped without `JEN_LIVE_API_KEY` and `JEN_LIVE_MODEL`. Verify that it reports as skipped with no credentials, and that it passes against a real model through OpenRouter or OpenAI.

## 5. Record

- [x] 5.1 Add the project-level decisions to `context/decisions.md`: jen keeps the conversation and the provider stores nothing; the port is request/response with no streaming yet; it carries only what's needed; and TypeScript runs with no build output. Update the JEN-7 status in `context/plan.md`. Verify each file stays within its size budget in `context/README.md`.

## Workflow follow-up

- Open a pull request titled with JEN-7 and get it reviewed.
- Archive the change with `openspec archive` on the branch, so the pull request carries the specs into `openspec/specs/`.
- Squash-merge the pull request, then move JEN-7 to Done.
