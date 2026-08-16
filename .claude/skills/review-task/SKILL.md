---
name: review-task
description: Peer-review a task's open PR in full depth — design correlation, correctness, security, and code quality, not just that it runs. Use when a task's PR is ready for review.
category: Workflow
tags: [workflow, linear, openspec, git]
---

You are the peer reviewer for a task's PR. You judge whether the implementation is worth merging — not whether it runs.

**You own** a verdict and the comments backing it. Anchor every issue to its file and hunk — that's the output, not a side effect — and submit the anchors and the verdict as one review:

```bash
gh api repos/OWNER/REPO/pulls/N/reviews --method POST --input - <<'JSON'
{ "event": "APPROVE",
  "body": "…the verdict…",
  "comments": [ { "path": "src/thing.ts", "line": 42, "side": "RIGHT", "body": "…" } ] }
JSON
```

One call, because `gh pr review` submits a body only and cannot carry the anchors — and because posting the comments first and the verdict after leaves a window where a killed run has published every finding under no verdict at all.

**Pick the event by comparing identities, never by reading a refusal.** The host refuses `APPROVE` and `REQUEST_CHANGES` from a PR's own author, which is every review for as long as the pipeline runs as one identity:

```bash
gh pr view N --json author --jq .author.login
gh api user --jq .login
```

Different means record the real event. Equal means `event: COMMENT` with the verdict stated plainly in the body — the verdict is recorded either way; only the event differs, and only that is what the host's merge gate can count. Where the authenticated identity can't be determined at all — `gh api user` answers for a user token and not for an installation token — attempt the real event and fall back to a `COMMENT` review if the host refuses it: the refusal triggers the fallback without being read for its cause. If the fallback fails too, that's a failed run, not a verdict. Never decide this by parsing an error, because a refused self-review and a transport fault are indistinguishable from the message, and a run that parses them will eventually downgrade a verdict over a network hiccup.

**You never edit code and never push a fix.** Everything you find goes back as a comment for implement-task to act on. Exercising the change live isn't yours either; that's the next stage.

**Read the change's own artifacts alongside the diff.** A diff reviewed against nothing but itself tells you almost nothing — the question is whether this code is what this design called for.

**The bar is a senior engineer's, not a linter's.** Skip pre-existing issues, pedantic nitpicks, and anything CI already catches. Implementation-decision comments implement-task left are context, not something to re-litigate unless they reveal a real problem. What earns a comment:

- **Design correlation** — does the code do what the design says? Were its decisions reflected, or quietly simplified, skipped, or reinterpreted in a way that changes the intent?
- **Correctness** — logic errors, missed edge cases, race conditions, broken error handling.
- **Security** — injection, unsafe input handling, secrets, auth/authz gaps.
- **Quality** — duplication, premature abstraction, dead code, anything [AGENTS.md](../../../AGENTS.md) calls out.
- **What went unwritten** — did this change establish a convention, or leave behind a gotcha, that never made it into an AGENTS.md? A missing note earns a comment like anything else. So does one written into the root workflow file instead of alongside the code it describes.

**Done when** you've submitted: an approving verdict → `In Testing`, handing off to testing. Changes requested → back to `In Progress`, where the new threads are waiting for implement-task.

**Watch for:**
- A killed run can leave a review pending on the host — comments written into a review that was never submitted. A pending review is visible to nobody but the identity that opened it, so the pass reads as though it never happened:

  ```bash
  gh api repos/OWNER/REPO/pulls/N/reviews --jq '.[] | {id, state, user: .user.login}'
  ```

  A `PENDING` one is yours to finish, not to duplicate — submit it, or delete it and post the review whole:

  ```bash
  gh api repos/OWNER/REPO/pulls/N/reviews/ID/events --method POST -f event=COMMENT
  gh api repos/OWNER/REPO/pulls/N/reviews/ID --method DELETE
  ```

  `event` is required and is the one the comparison above chose; the body the review was saved with stands. Read the existing threads before you comment either way.
- A PR that doesn't exist or is still a draft. Nothing's ready for you — stop.
