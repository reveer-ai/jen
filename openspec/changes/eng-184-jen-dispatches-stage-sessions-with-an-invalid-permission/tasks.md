## 1. Fix the dispatched-session argv

- [ ] 1.1 In `cli/exec.ts` (`#session`, ~line 896), change the `--permission-mode` value
  from `dontAsk` to `acceptEdits`.
- [ ] 1.2 In `test/exec.test.ts` (~line 342), repoint the assertion from `dontAsk` to
  `acceptEdits`.

## 2. Reword the prose that names `dontAsk`

- [ ] 2.1 `cli/exec.ts` `prompt()` doc comment (~line 324): the half about naming the task
  interacts with the session being non-interactive under `-p`, not with a `dontAsk` mode.
  Reword.
- [ ] 2.2 `test/exec.test.ts` comment (~line 51): same — a bare skill name has no asking
  branch because the session is non-interactive, not "under `dontAsk`". Reword.
- [ ] 2.3 `cli/AGENTS.md` workspace-trust note (~lines 304-308): it explains the trust
  failure "under `dontAsk`". Reword to name `-p --permission-mode acceptEdits`, and keep
  the point intact — an untrusted clone still runs as though the allow-list were empty, and
  the stderr check is what catches it.

## 3. Confirm the fix

- [ ] 3.1 `npm test` (or the project's test command) passes.
- [ ] 3.2 Typecheck / build passes and `dist/exec.js` is rebuilt carrying `acceptEdits`
  (~`dist/exec.js:693`).
- [ ] 3.3 Verify the behaviour the modified `stage-execution` requirement states: a
  dispatched run under `-p --permission-mode acceptEdits` cannot block on a human — an
  attempt to ask is refused, not queued. If the shipped CLI makes this hard to assert in a
  unit test, note where it is covered (the ENG-167 end-to-end lineage) in `cli/AGENTS.md`.

## 4. Release

- [ ] 4.1 Add a changeset for the fix (patch).
- [ ] 4.2 Delivery cuts the release as its last act; CI installs jen fresh, so the fix
  reaches the scheduled runner only once the release ships.
