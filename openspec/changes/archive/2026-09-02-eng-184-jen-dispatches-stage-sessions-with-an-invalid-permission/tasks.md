## 1. Fix the dispatched-session argv

- [x] 1.1 In `cli/exec.ts` (`#session`, ~line 896), change the `--permission-mode` value
  from `dontAsk` to `acceptEdits`.
- [x] 1.2 In `test/exec.test.ts` (~line 342), repoint the assertion from `dontAsk` to
  `acceptEdits`.

## 2. Reword the prose that names `dontAsk`

- [x] 2.1 `cli/exec.ts` `prompt()` doc comment (~line 324): the half about naming the task
  interacts with the session being non-interactive under `-p`, not with a `dontAsk` mode.
  Reword.
- [x] 2.2 `test/exec.test.ts` comment (~line 51): same — a bare skill name has no asking
  branch because the session is non-interactive, not "under `dontAsk`". Reword.
- [x] 2.3 `cli/AGENTS.md` workspace-trust note (~lines 304-308): it explains the trust
  failure "under `dontAsk`". Reword to name `-p --permission-mode acceptEdits`, and keep
  the point intact — an untrusted clone still runs as though the allow-list were empty, and
  the stderr check is what catches it.

## 3. Confirm the fix

- [x] 3.1 `npm test` (or the project's test command) passes.
- [x] 3.2 Typecheck / build passes and `dist/exec.js` is rebuilt carrying `acceptEdits`
  (~`dist/exec.js:693`).
- [x] 3.3 Verify the behaviour the modified `stage-execution` requirement states: a
  dispatched run under `-p --permission-mode acceptEdits` cannot block on a human — an
  attempt to ask is refused, not queued. If the shipped CLI makes this hard to assert in a
  unit test, note where it is covered (the ENG-167 end-to-end lineage) in `cli/AGENTS.md`.

## 4. Release

- [x] 4.1 Add a changeset for the fix (patch).
- [x] 4.2 Record the release handoff: the task PR carries the patch changeset; after it
  lands on `main`, release automation prepares the separate Version PR for a human to
  merge. CI installs jen fresh, so the fix reaches the scheduled runner only once that
  release ships.
