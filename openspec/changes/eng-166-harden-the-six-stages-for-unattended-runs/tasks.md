## 1. The shared conventions

The skills defer to these, so they land first.

- [ ] 1.1 In the root `AGENTS.md`, rewrite the **One PR per task** convention: the PR is opened and thereafter acted upon with `gh`, and the sentence explaining that the tracker can read, comment on, review, and merge a PR but not create one is removed — it now asserts the opposite of what holds under an agent identity.
- [ ] 1.2 Add the division to the conventions: pull-request work goes to the git host, task work (status, comments, artifact attachments) to the tracker, and the issue's suggested branch name is the one value that crosses. State that the tracker's diff tooling is offered to every identity but returns empty to one acting as an application, so the failure is silent and the rule is held by instruction.
- [ ] 1.3 Rewrite the **Threads** convention against `gh`: read threads with the GraphQL `reviewThreads` query (carrying `id`, `isResolved`, and the first comment's `databaseId`), reply with `POST /pulls/{n}/comments/{comment_id}/replies`, resolve with the `resolveReviewThread` mutation. Keep the existing rule that the fix is pushed first, unchanged.

## 2. The stages that touch the PR

- [ ] 2.1 `review-task`: replace `save_diff_comment` and `submit_diff_review` with the single `POST /pulls/{n}/reviews` call carrying `event`, `body`, and the inline `comments` array — noting that `gh pr review` cannot carry anchors, which is why the endpoint is used directly.
- [ ] 2.2 `review-task`: add the authorship comparison — `gh pr view --json author` against `gh api user` — with the real event when they differ, an `event: COMMENT` review carrying the verdict in its body when they match, and the attempt-then-fall-back path when the authenticated identity cannot be determined. State that the choice is never made by reading a refusal message.
- [ ] 2.3 `review-task`: update the killed-run note — the hazard is unchanged (a pass nobody can see), but the mechanism is now a review left unsubmitted on the host.
- [ ] 2.4 `test-task`: same treatment for its `changesRequested` verdict and its killed-run note, deferring to the convention rather than restating the mechanics `review-task` already carries.
- [ ] 2.5 `design-task`: replace `get_diff_threads` with the GraphQL thread read, keeping `isResolved: false` as what it looks for.
- [ ] 2.6 Confirm `implement-task` and `deliver-task` need no edit — neither names a diff tool, and both inherit the change through the conventions. If either turns out to name one, fix it here.

## 3. The guard

- [ ] 3.1 Add a test in `test/payload.test.ts`, beside the existing tooling-floor test, asserting that no skill named in the payload declaration and not the root `AGENTS.md` mentions a tracker diff tool (`list_diffs`, `get_diff`, `get_diff_threads`, `save_diff_comment`, `resolve_diff_thread`, `submit_diff_review`, `merge_diff`).
- [ ] 3.2 Verify the guard is scoped to the payload declaration rather than the tree, so ENG-141's `.claude/skills/AGENTS.md` — which names these tools deliberately, to explain they are inert — can still merge.

## 4. The permissions section this task got wrong

- [ ] 4.1 In `README.md` section 4, replace "Your project's own check commands are not among them, and jen cannot add them" with what is actually true: jen writes the workflow's own tooling for every project plus a starting shape that assumes npm, a project on another stack holds entries that do not apply and lacks the ones that do, and what jen cannot know is the project's commands. Do not remove the npm entries from the scaffold — writing them was a deliberate decision of the same task.
- [ ] 4.2 Turn the example JSON from a complete file into the entries an adopter adds, so copying it cannot drop the four `npm run` entries jen writes.
- [ ] 4.3 Apply the matching delta to `adoption-docs`, in the same commit as the README — the requirement carries the same wording, and shipping one without the other leaves the spec governing text that no longer says what it asserts.

## 5. Verification

- [ ] 5.1 Run the project's checks: `npm run typecheck`, `npm run lint`, `npm run build`, and the full suite.
- [ ] 5.2 `openspec validate eng-166-harden-the-six-stages-for-unattended-runs --strict`.
- [ ] 5.3 Re-read the four edited documents as a set, in the order a stage meets them, and confirm no skill restates what the conventions now carry.
- [ ] 5.4 Confirm every command named in the instructions is one that was actually run, not one inferred from documentation.
- [ ] 5.5 Read section 4 of `README.md` against the scaffold's actual allow list and confirm every claim it makes about what jen writes is true of that file.
