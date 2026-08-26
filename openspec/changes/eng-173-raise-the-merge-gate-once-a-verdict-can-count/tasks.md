Three of these tasks are a person's and cannot be done by any pipeline role. Raising a ruleset needs `administration:write` and accepting a permission request needs organization ownership; no role holds either, deliberately — see `design.md`, *Context*. They are marked **(human)**. A stage that reaches one records what is outstanding on the issue and parks the task at `Pending` rather than waiting on it.

## 1. The tree

- [x] 1.1 Update the gate section of `.claude/skills/setup-jen/SKILL.md` to read the class of settings that raise the effective approving-review requirement rather than the two it names today. Keep the two settings and their reasoning — they are why the bound exists — and add the unattributed-changes setting beside them, including that it is on by default on new and existing rulesets and inert at a count of zero, which is why a project can carry it unnoticed.
- [x] 1.2 Add to the same section that a setting bearing on the requirement whose reach binding cannot establish is reported as undetermined, and that the gate is not reported satisfied on the strength of the configured count alone.
- [x] 1.3 Confirm `.claude/skills/setup-jen/SKILL.md`'s permission table already lists `Statuses: read` for `deliver` and leave it alone if so. The table is correct; jen's own installation is what diverges from it.
- [x] 1.4 `npx openspec validate eng-173-raise-the-merge-gate-once-a-verdict-can-count --strict` passes.

## 2. The permission

- [x] 2.1 **(human)** Amend the `reveer-jen-deliver` application to request `Statuses: read`, keeping every permission it already holds.
- [x] 2.2 **(human)** Accept the permission request on installation `153578706` as an organization owner. Amending the application does not amend the installation — until this is accepted, the application reads as amended while every token it mints carries the old set.
- [x] 2.3 Verify on the **granted** side: `gh api orgs/reveer-ai/installations --jq '.installations[] | select(.app_slug=="reveer-jen-deliver") | .permissions'` reports `statuses:read` alongside the five it already had. Reading the application's requested permissions instead does not verify this.

## 3. The raise

- [x] 3.1 **(human)** Set `primary` (ruleset `20589957`) to `required_approving_review_count: 1`, changing nothing else: `require_last_push_approval` and `dismiss_stale_reviews_on_push` stay `false`, the `check` requirement stays, the `User` bypass actor stays, and no `Integration` joins the bypass list.
- [x] 3.2 Read the ruleset back and confirm each of those five facts individually, rather than confirming the count and inferring the rest.

## 4. The unattributed question

- [x] 4.1 Read PR #12's requirement now that the count is `1` — `gh pr view 12 --repo reveer-ai/jen --json reviewDecision,mergeStateStatus` plus the branch's own reading of how many approvals it wants. It is application-authored and needs no approval today only because the setting is inert at zero. If #12 has been closed or merged by now, open a throwaway probe as `design` instead, as ENG-141 did with #10, and close it after.
- [x] 4.2 Record which answer came back. **One approval** means the setting is scoped as the host documents it and does not reach the pipeline's pull requests. **Two** means it does, and 4.3 applies.
  - **Answer: one approval.** PR #12 (`app/reveer-release`) went `REVIEW_REQUIRED`/`BLOCKED` at zero approvals to `APPROVED`/`CLEAN` on one, with `require_extra_approval_for_unattributed_changes` still `true` on `primary`. The setting is scoped as documented and does not reach an ordinary application's pull request, so **4.3 does not apply** and the setting stays on.
  - The requirement could not be *read*, only observed: `PullRequest.reviewRequirements` is not a GraphQL field, `rules/branch/main` answers `404`, and `reviewDecision` is identical for a one- and a two-approval branch until an approval exists. Recorded in `cli/AGENTS.md`.
- [~] 4.3 **Does not apply** — 4.2 came back one approval. Only if two: turn `require_extra_approval_for_unattributed_changes` off on `primary` — the spec requires it off wherever it applies to the pipeline's own pull requests — and repeat 4.1 to confirm the requirement dropped to one. **(human)**, same reason as 3.1.
- [x] 4.4 Write the answer into `cli/AGENTS.md`: what the setting is, that it is invisible at a count of zero, what was observed here, and which repository state that observation was made against. Whichever way it landed, this is what stops the next session re-deriving it from documentation that does not settle it.

## 5. The observation this task exists for

Evidence, not configuration. Each of these is a fact about a real pull request, and each names the identity that produced it — an approval submitted by a person satisfies the branch and proves nothing about the pipeline.

- [ ] 5.1 `deliver` submits an approving review on this change's own pull request, under `deliver`'s installation token rather than under whoever launched the session. Requires `JEN_GH_PRIVATE_KEY_DELIVER` and the rest of `credentialsFor`'s environment (`cli/github.ts:41`).
- [ ] 5.2 Confirm the approval **counts**: the pull request reports its approval requirement satisfied, not merely that a review was recorded. `reviewDecision: APPROVED` with `mergeStateStatus` no longer blocked on review is the reading; a recorded review sitting beside an unsatisfied requirement is the failure this task is named for.
- [ ] 5.3 `deliver` pushes the spec sync and the archive, then confirm the approval still stands and the pull request is still mergeable. This is the deadlock the eased settings exist to avoid and the one check that would have caught the original design.
- [x] 5.4 Confirm the human bypass still opens, since it is the only way to break the glass on an unattended pipeline. Read it off the ruleset rather than exercising it.
  - Read after the raise: `bypass_actors` is `[{actor_id: 314685034, actor_type: "User", bypass_mode: "always"}]` — the same single human, unchanged by the raise, and no `Integration` beside it.
- [ ] 5.5 `deliver` merges. The change that raised the gate goes through the gate it raised.

## 6. Recording it

- [ ] 6.1 Comment on ENG-173 with the evidence from group 5 — which identity approved, that the requirement read satisfied, that it survived delivery's push — so the observation lives on the task rather than only in a pull request timeline that later work will not read.
- [ ] 6.2 Note on ENG-136 that the gate is live, and that ENG-167 can now consume it as an acceptance criterion rather than as an assumption.

## 7. What review sent back

Added by `implement-task` after review requested changes, so the record of this change carries the work rather than only the pull request thread. 7.1–7.6 are round two's finding and the carry-over review asked to stop being a thread; 7.7–7.8 are round three's.

- [x] 7.1 The finding: `undetermined` had no exit for a project at binding time. The chain was entirely inside this change — the unattributed setting is on by default, its reach is unreadable, what settles it is a pull request the pipeline opened, and a project *being bound* has never had one — so every adopter's first run would report the gate unsatisfied with no move available. Closed by shipping the observation this task bought as a **cited observation** in `.claude/skills/setup-jen/SKILL.md` rather than by relaxing the rule: host, date, vehicle, and the repository state it was made against, with the instruction to cite it rather than restate it as a conclusion. Undetermined stays the report for a setting no observation covers.
- [x] 7.2 Carry the same distinction into both spec deltas, so the skill and the specs do not go out of step: `project-binding` gains the settled-by-observation report beside `undetermined` and two scenarios; `pipeline-identity` gains that a recorded observation establishes a setting's reach on the same terms as a fresh one, provided it is cited with its provenance.
- [x] 7.3 Examine the consequence in `design.md` — *Risks*, beside the release-approval consequence it was missing next to, and refine the *Binding reports "undetermined"* decision to agree with it.
- [x] 7.4 Extend `test/merge-gate.test.ts` to hold the shipped observation to its provenance and to the three-shaped report, since both go quiet if the wording drifts back.
- [x] 7.5 Note in `cli/AGENTS.md` that the observation now exists in two places and that they must be updated together.
- [x] 7.6 File the bypass-attribution carry-over as its own task, which is what review asked for — it has survived two reviews and lived in four places, none of them a task. Not taken here: it changes what binding is instructed to read, `specs/project-binding/spec.md` is silent on attribution, and settling it in the skill alone would put the two out of step in the change that is tightening how they agree.

- [x] 7.7 Round three's finding: the observation `7.1` shipped landed three paragraphs below text `61886ed` wrote, and the two disagreed about `require_extra_approval_for_unattributed_changes`. The bullet under **Four are known to breach it** asserted the reach — "the pipeline's pull requests are opened by an application acting as itself" — that the observation refutes, and the instruction beneath the list was unconditional, so a run reading top to bottom hit *report it as not satisfying the gate, present turning it off* before ever reaching the observation. Since the setting is on by default, that is every adopter's first binding; it also contradicts `4.3`, where this change deliberately left the setting `true` on `primary`. Closed by conditioning the bullet on a reach it now names as unreadable rather than asserting, and by qualifying the instruction as being on the *breach* rather than on the name — with a settled-as-not-reaching setting explicitly left on. The taxonomy under *One observation is already recorded* was already right and is unchanged; both spec deltas already condition the same way (`pipeline-identity`: "SHALL be off **wherever it applies to** the pipeline's own pull requests"), so neither needed a matching edit and the skill now agrees with them.
- [x] 7.8 Two tests in `test/merge-gate.test.ts` hold the fix, scoped to the bullet and to the instruction rather than to the whole section — the contradiction was two agreeing greps apart, so a section-wide match cannot catch it. `conditions the unattributed setting on a reach it does not assert` and `does not tell a run to turn off a setting an observation has settled`. All four phrases they match are absent from the previous revision of the skill, so they fail on it rather than passing vacuously.
