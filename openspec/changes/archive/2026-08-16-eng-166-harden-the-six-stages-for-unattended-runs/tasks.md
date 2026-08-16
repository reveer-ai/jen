## 1. The shared conventions

The skills defer to these, so they land first.

- [x] 1.1 In the root `AGENTS.md`, rewrite the **One PR per task** convention: the PR is opened and thereafter acted upon with `gh`, and the sentence explaining that the tracker can read, comment on, review, and merge a PR but not create one is removed — it now asserts the opposite of what holds under an agent identity.
- [x] 1.2 Add the division to the conventions: pull-request work goes to the git host, task work (status, comments, artifact attachments) to the tracker, and the issue's suggested branch name is the one value that crosses. State that the tracker's diff tooling is offered to every identity but returns empty to one acting as an application, so the failure is silent and the rule is held by instruction.
- [x] 1.3 Rewrite the **Threads** convention against `gh`: read threads with the GraphQL `reviewThreads` query (carrying `id`, `isResolved`, and the first comment's `databaseId`), reply with `POST /pulls/{n}/comments/{comment_id}/replies`, resolve with the `resolveReviewThread` mutation. Keep the existing rule that the fix is pushed first, unchanged.

## 2. The stages that touch the PR

- [x] 2.1 `review-task`: replace `save_diff_comment` and `submit_diff_review` with the single `POST /pulls/{n}/reviews` call carrying `event`, `body`, and the inline `comments` array — noting that `gh pr review` cannot carry anchors, which is why the endpoint is used directly.
- [x] 2.2 `review-task`: add the authorship comparison — `gh pr view --json author` against `gh api user` — with the real event when they differ, an `event: COMMENT` review carrying the verdict in its body when they match, and the attempt-then-fall-back path when the authenticated identity cannot be determined. State that the choice is never made by reading a refusal message.
- [x] 2.3 `review-task`: update the killed-run note — the hazard is unchanged (a pass nobody can see), but the mechanism is now a review left unsubmitted on the host.
- [x] 2.4 `test-task`: same treatment for its `changesRequested` verdict and its killed-run note, deferring to the convention rather than restating the mechanics `review-task` already carries.
- [x] 2.5 `design-task`: replace `get_diff_threads` with the GraphQL thread read, keeping `isResolved: false` as what it looks for.
- [x] 2.6 Confirm `implement-task` and `deliver-task` need no edit — neither names a diff tool, and both inherit the change through the conventions. If either turns out to name one, fix it here. *Confirmed by grep; neither names one. `deliver-task` says only "Merging the PR", which the conventions now route to `gh`. No edit made.*

## 3. The guard

- [x] 3.1 Add a test in `test/payload.test.ts`, beside the existing tooling-floor test, asserting that no skill named in the payload declaration and not the root `AGENTS.md` mentions a tracker diff tool (`list_diffs`, `get_diff`, `get_diff_threads`, `save_diff_comment`, `resolve_diff_thread`, `submit_diff_review`, `merge_diff`).
- [x] 3.2 Verify the guard is scoped to the payload declaration rather than the tree, so ENG-141's `.claude/skills/AGENTS.md` — which names these tools deliberately, to explain they are inert — can still merge.

## 4. The permissions section this task got wrong

- [x] 4.1 In `README.md` section 4, replace "Your project's own check commands are not among them, and jen cannot add them" with what is actually true: jen writes the workflow's own tooling for every project plus a starting shape that assumes npm, a project on another stack holds entries that do not apply and lacks the ones that do, and what jen cannot know is the project's commands. Do not remove the npm entries from the scaffold — writing them was a deliberate decision of the same task.
- [x] 4.2 Turn the example JSON from a complete file into the entries an adopter adds, so copying it cannot drop the four `npm run` entries jen writes.
- [x] 4.3 Apply the matching delta to `adoption-docs`, in the same commit as the README — the requirement carries the same wording, and shipping one without the other leaves the spec governing text that no longer says what it asserts. *The delta was already written and committed by design in `3a037ac`, so the two ship on the same PR rather than in the same commit. README text checked against it clause by clause; syncing it into the main specs is deliver-task's.*

## 5. Verification

- [x] 5.1 Run the project's checks: `npm run typecheck`, `npm run lint`, `npm run build`, and the full suite. *Typecheck, build, and 139 tests pass. `npm run lint` does not exist — this project defines no `lint` script, so there was nothing to run; not introduced here, since adding a linter is a change of its own.*
- [x] 5.2 `openspec validate eng-166-harden-the-six-stages-for-unattended-runs --strict`.
- [x] 5.3 Re-read the four edited documents as a set, in the order a stage meets them, and confirm no skill restates what the conventions now carry.
- [x] 5.4 Confirm every command named in the instructions is one that was actually run, not one inferred from documentation. *All eight run against PR #13: the thread read, the reviews POST carrying inline anchors, the replies POST, the `resolveReviewThread` mutation, the reviews listing, the events submit, the pending-review DELETE, and the two-value authorship probe. The self-review refusal was reproduced firsthand — `422 Review Can not request changes on your own pull request`. Probe threads deleted afterward; two self-labeled `COMMENTED` review shells remain, which the host offers no way to remove.*
- [x] 5.5 Read section 4 of `README.md` against the scaffold's actual allow list and confirm every claim it makes about what jen writes is true of that file.

## 6. Review round one

Three findings from the review of this PR, all prose, no code.

- [x] 6.1 Give **Where the work goes**'s "anchoring a comment to a line of the diff" a mechanism. The command lands in **Threads**, beside the reply and resolve it belongs with, rather than in the division bullet that only enumerates the operation. *`POST /pulls/N/comments` with `commit_id`, run against #13 before being written down; the probe comment was deleted afterward.*
- [x] 6.2 Carry the design's indeterminate-identity decision into the `stage-conventions` delta: a paragraph in the requirement, a scenario for it, and the reviewer-is-author scenario scoped to what the comparison reports rather than to who the author in fact is.
- [x] 6.3 `review-task`: give `POST /pulls/N/reviews/ID/events` its required `event` field. *The sibling `DELETE` on the same endpoint — the other half of the sentence — is written out with it.*
- [x] 6.4 Re-run the checks and `openspec validate --strict`.

## 7. Review round two

One finding and one note, both prose, no code and no spec change.

- [x] 7.1 In the root `AGENTS.md` **Threads** convention, state that the anchored-comment endpoint requires `LINE` to be in the diff and refuses anything else with a `422`, and route the note that can't be anchored to the Linear issue. Keep `gh pr comment` as the wrong answer where an anchor is possible.
- [x] 7.2 Answer the pending-review recovery note on `review-task` either way, on its thread. *Agreed rather than defended: the recovery path now reads the pending body first, deletes and reposts by default, and submits only when the body is already the verdict.*
- [x] 7.3 Re-run the checks and `openspec validate --strict`. *Typecheck, build, 139 tests, `openspec validate --strict` all pass.*

## 8. Review round three

Two findings, both prose, both in `review-task`'s pending-review recovery. No code and no spec change — the requirement says nothing about recovery mechanics.

- [x] 8.1 Add `body` to the reviews-listing projection, so the command answers the question the next sentence asks of it. It serves the verdict read in **Where the work goes** too, where `state` alone can't tell an anchoring shell from a verdict.
- [x] 8.2 Mark the `DELETE` and the events `POST` as alternatives rather than a sequence, at the commands themselves and not only in the prose above them.
- [x] 8.3 Act on the churn observation the review left as context: lift the recovery out of the **Watch for** bullet that has now carried three rounds of findings, and give it its own block at the altitude of the mechanism it describes.
- [x] 8.4 Re-run the checks and `openspec validate --strict`.
