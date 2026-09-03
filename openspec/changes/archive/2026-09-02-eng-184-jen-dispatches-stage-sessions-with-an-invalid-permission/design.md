## Context

This is a one-line bug fix with a fully-formed diagnosis on the Linear issue
([ENG-184](https://linear.app/maain/issue/ENG-184)). There is no architecture to decide.
This document exists only to record the one fact the fix rests on, because it is worth
verifying rather than assuming.

## The fact the fix rests on

The dispatched session already runs under `-p`. The claim is that `-p` alone leaves the
session no way to put a question to a person — `AskUserQuestion` cannot surface in a
non-interactive run — so "a stage never waits on a human" is enforced by the invocation
regardless of the permission mode. The fictional `--permission-mode dontAsk` was believed
to be a second, dedicated layer of that enforcement; it never existed, and `-p` was
carrying it alone the whole time.

`acceptEdits` is the replacement value because it is the mode a dispatched run wants on its
own merits: file edits proceed without a prompt that nothing would answer, while the
project's own `.claude/settings.json` allow-list still governs everything else. It is not
chosen for any bearing on asking — it has none, which is the point.

## What implementation and testing confirm

- `--permission-mode acceptEdits` is accepted by the shipped CLI and the session starts.
- A dispatched run under `-p --permission-mode acceptEdits` still cannot block on a human:
  an attempt to ask is refused, not queued, and the run does not hang. This is the
  behaviour the modified `stage-execution` requirement now states as a property of the
  session being non-interactive.
- `dist/exec.js` is rebuilt from `cli/exec.ts` and carries `acceptEdits`.

## Non-Goals

- Adding a real second enforcement layer for "never ask a human". `-p` is sufficient and
  the spec now says so; a belt-and-suspenders mechanism is not in scope.
- Editing ENG-164's archived proposal or design. Archived changes are history.

## Risks / Trade-offs

- [`-p` behaviour changes in a future CLI so that `AskUserQuestion` can somehow surface] →
  the modified requirement is stated as a property, so a regression is a spec violation
  that test-task's end-to-end exercise (the ENG-167 lineage) is positioned to catch.
- [`acceptEdits` is broader than a dispatched run strictly needs] → the project's own
  allow-list still governs non-edit tools; `acceptEdits` only removes the edit prompt,
  which in a run with nobody present is a prompt that would deadlock rather than protect.
