Three of these tasks are a person's and cannot be done by any pipeline role. Raising a ruleset needs `administration:write` and accepting a permission request needs organization ownership; no role holds either, deliberately — see `design.md`, *Context*. They are marked **(human)**. A stage that reaches one records what is outstanding on the issue and parks the task at `Pending` rather than waiting on it.

## 1. The tree

- [ ] 1.1 Update the gate section of `.claude/skills/setup-jen/SKILL.md` to read the class of settings that raise the effective approving-review requirement rather than the two it names today. Keep the two settings and their reasoning — they are why the bound exists — and add the unattributed-changes setting beside them, including that it is on by default on new and existing rulesets and inert at a count of zero, which is why a project can carry it unnoticed.
- [ ] 1.2 Add to the same section that a setting bearing on the requirement whose reach binding cannot establish is reported as undetermined, and that the gate is not reported satisfied on the strength of the configured count alone.
- [ ] 1.3 Confirm `.claude/skills/setup-jen/SKILL.md`'s permission table already lists `Statuses: read` for `deliver` and leave it alone if so. The table is correct; jen's own installation is what diverges from it.
- [ ] 1.4 `npx openspec validate eng-173-raise-the-merge-gate-once-a-verdict-can-count --strict` passes.

## 2. The permission

- [ ] 2.1 **(human)** Amend the `reveer-jen-deliver` application to request `Statuses: read`, keeping every permission it already holds.
- [ ] 2.2 **(human)** Accept the permission request on installation `153578706` as an organization owner. Amending the application does not amend the installation — until this is accepted, the application reads as amended while every token it mints carries the old set.
- [ ] 2.3 Verify on the **granted** side: `gh api orgs/reveer-ai/installations --jq '.installations[] | select(.app_slug=="reveer-jen-deliver") | .permissions'` reports `statuses:read` alongside the five it already had. Reading the application's requested permissions instead does not verify this.

## 3. The raise

- [ ] 3.1 **(human)** Set `primary` (ruleset `20589957`) to `required_approving_review_count: 1`, changing nothing else: `require_last_push_approval` and `dismiss_stale_reviews_on_push` stay `false`, the `check` requirement stays, the `User` bypass actor stays, and no `Integration` joins the bypass list.
- [ ] 3.2 Read the ruleset back and confirm each of those five facts individually, rather than confirming the count and inferring the rest.

## 4. The unattributed question

- [ ] 4.1 Read PR #12's requirement now that the count is `1` — `gh pr view 12 --repo reveer-ai/jen --json reviewDecision,mergeStateStatus` plus the branch's own reading of how many approvals it wants. It is application-authored and needs no approval today only because the setting is inert at zero. If #12 has been closed or merged by now, open a throwaway probe as `design` instead, as ENG-141 did with #10, and close it after.
- [ ] 4.2 Record which answer came back. **One approval** means the setting is scoped as the host documents it and does not reach the pipeline's pull requests. **Two** means it does, and 4.3 applies.
- [ ] 4.3 Only if two: turn `require_extra_approval_for_unattributed_changes` off on `primary` — the spec requires it off wherever it applies to the pipeline's own pull requests — and repeat 4.1 to confirm the requirement dropped to one. **(human)**, same reason as 3.1.
- [ ] 4.4 Write the answer into `cli/AGENTS.md`: what the setting is, that it is invisible at a count of zero, what was observed here, and which repository state that observation was made against. Whichever way it landed, this is what stops the next session re-deriving it from documentation that does not settle it.

## 5. The observation this task exists for

Evidence, not configuration. Each of these is a fact about a real pull request, and each names the identity that produced it — an approval submitted by a person satisfies the branch and proves nothing about the pipeline.

- [ ] 5.1 `deliver` submits an approving review on this change's own pull request, under `deliver`'s installation token rather than under whoever launched the session. Requires `JEN_GH_PRIVATE_KEY_DELIVER` and the rest of `credentialsFor`'s environment (`cli/github.ts:41`).
- [ ] 5.2 Confirm the approval **counts**: the pull request reports its approval requirement satisfied, not merely that a review was recorded. `reviewDecision: APPROVED` with `mergeStateStatus` no longer blocked on review is the reading; a recorded review sitting beside an unsatisfied requirement is the failure this task is named for.
- [ ] 5.3 `deliver` pushes the spec sync and the archive, then confirm the approval still stands and the pull request is still mergeable. This is the deadlock the eased settings exist to avoid and the one check that would have caught the original design.
- [ ] 5.4 Confirm the human bypass still opens, since it is the only way to break the glass on an unattended pipeline. Read it off the ruleset rather than exercising it.
- [ ] 5.5 `deliver` merges. The change that raised the gate goes through the gate it raised.

## 6. Recording it

- [ ] 6.1 Comment on ENG-173 with the evidence from group 5 — which identity approved, that the requirement read satisfied, that it survived delivery's push — so the observation lives on the task rather than only in a pull request timeline that later work will not read.
- [ ] 6.2 Note on ENG-136 that the gate is live, and that ENG-167 can now consume it as an acceptance criterion rather than as an assumption.
