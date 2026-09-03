## Why

Every dispatched stage session is launched with `claude --permission-mode dontAsk`
([`cli/exec.ts:895`](../../../cli/exec.ts)). `dontAsk` is not a value the shipped Claude Code
CLI accepts for `--permission-mode` — the accepted values are `default`, `acceptEdits`,
`plan`, and `bypassPermissions` — so the flag is rejected rather than honoured and the
session does not start as intended. Found while exercising the pipeline end-to-end for
ENG-167. The full diagnosis — symptom, root cause, fix, and why it needs a jen release
rather than a local patch — is on the Linear issue, [ENG-184](https://linear.app/maain/issue/ENG-184).

## What Changes

- `--permission-mode dontAsk` → `--permission-mode acceptEdits` in the dispatched-session
  argv ([`cli/exec.ts:896`](../../../cli/exec.ts)).
- The test assertion pinning `dontAsk` is repointed to `acceptEdits`
  ([`test/exec.test.ts:342`](../../../test/exec.test.ts)), and the test comment at
  [`test/exec.test.ts:51`](../../../test/exec.test.ts) reworded off `dontAsk`.
- The two prose spots that name `dontAsk` as the thing that stops a run blocking on a human
  — the `prompt()` doc comment at [`cli/exec.ts:324`](../../../cli/exec.ts) and the workspace-trust
  note at [`cli/AGENTS.md:304`](../../../cli/AGENTS.md) — are reworded to name the real
  mechanism: a dispatched session runs under `-p`, and `-p` gives it no way to put a
  question to a person, so the stage prose's "never wait on a human" is enforced by the
  invocation regardless of what a permission rule would allow.
- A jen release is cut. The compiled `dist/exec.js` carries the same argv, and a scheduled
  runner installs jen fresh on every run, so the fix does not reach CI until it ships.

## Capabilities

### New Capabilities

<!-- None. -->

### Modified Capabilities

- `stage-execution` — sharpen "A run cannot block on a human" to state that asking is
  denied because the session is non-interactive, independently of its permission mode, and
  add a scenario covering a permission level that otherwise lets tools act without prompts.

## Impact

- `cli/exec.ts` — the dispatched-session argv, and one doc comment.
- `test/exec.test.ts` — one assertion, one comment.
- `cli/AGENTS.md` — the workspace-trust note.
- A jen release; `dist/exec.js` is rebuilt from `cli/exec.ts` as part of it.
- Every dispatched stage session after the release actually starts, where today the argv is
  rejected before the session runs.
