---
name: review-change
description: Review a pull request against what it set out to do, its specs and the project's conventions, post the review on it, and re-review after fixes. Use when asked to review or re-review a change.
---

# Review a change

A review answers one question: should this merge as it is? Read it as the person who will maintain it without having written it.

## Before the diff

- Read what the project record says about reviews.
- Read what the change is for: its issue, and its proposal, design and spec deltas if it has them. Judge the diff against that, not against what you would have built.
- On a re-review, read your earlier review first.

## What to look for

In order of weight:

1. **Correctness.** Everything the change promises is met, and nothing it does breaks an existing requirement. A requirement that stays silent where it needed to say something is a finding.
2. **Failure.** Crashes and restarts, timeouts, concurrent callers, a peer that never answers, input at and past every bound. Most real findings are here.
3. **Tests.** Each behavior and each fix has a test that fails without it. Watch for tests that pass for the wrong reason, such as asserting on a fake's own echo.
4. **What it leaves behind.** The project record, docs and specs say what is now true, and nothing the change made stale is left standing.
5. **Structure**, only where it will cost the next change. Not style.

Reproduce every finding before you report it, with a failing test, a script or an exact trace through the code. Drop what you can't show. Rank each one: P1 is broken or unsafe, P2 should be fixed before merge, P3 is optional. Give each the smallest fix you see.

Run the project's checks yourself rather than trusting a reported pass, and say which ones you ran and which you couldn't.

## Posting

Post on the pull request: a summary with the verdict, what you verified and what you didn't, and each actionable finding as an inline comment on its line. Write the review body to a file before posting it, so a refused post can be retried unchanged. On GitHub, one `POST /repos/{owner}/{repo}/pulls/{n}/reviews` with `body`, `event` and `comments` (each with `path`, `line` and `body`) posts all of it. Threads are resolved with the GraphQL `resolveReviewThread` mutation.

## Re-review

Verify each earlier finding at the new commit with its original reproduction, then resolve its thread or say why you didn't. Then review everything that changed since, with the same care. Don't reopen what was settled, and don't hold back a new finding because it's late.

The review lives on the pull request. Don't copy it into the project record.
