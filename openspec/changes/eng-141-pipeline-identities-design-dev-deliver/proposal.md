## Why

Every stage authenticates as the same identity — the user's. `implement-task` opens and pushes the task's PR, and `review-task` then submits a verdict on it. GitHub refuses both `approved` and `changesRequested` from a pull request's own author, so the pipeline cannot record a review verdict at all. What it does instead is post a `COMMENT` review with the verdict written into the body: advisory prose sitting where a merge gate belongs. Nothing prevents an unreviewed change from merging, and a review signed by the author was never a peer review to begin with.

Attended, that is a cosmetic problem — the user is right there, and the verdict in the body is read by the person who would have caught the problem anyway. Unattended, it is the whole point. This epic's pipeline runs with nobody watching, and a gate that only advises is not a gate.

## What Changes

- **Three roles — `design`, `dev`, and `deliver`** — distinguished by a separate application identity on the git host each. `design` covers `design-task`; `dev` covers `implement-task`; `deliver` covers `review-task`, `test-task`, and `deliver-task`. Two would satisfy GitHub's constraint; three matches the agent mapping and makes the PR timeline name the stage that acted.
- **One shared tracker agent, not one per role.** This **corrects the epic**, which decided three identity pairs. The constraint that makes distinct identities necessary — a host refusing a review from the pull request's own author — is GitHub's alone and has no tracker equivalent. Three tracker agents would carry identical scopes and identical capability, differing only in the name attached to a comment, while tripling the manual half of every adopter's setup. The tracker identity exists so an unattended run can authenticate at all; that job needs exactly one.
- **Registration is driven from `setup-jen`, per fork.** The three applications and the one agent are registered into the adopter's own GitHub organization and Linear workspace. Nothing is published centrally, because a jen-published App would mint tokens through infrastructure somebody operates, and this epic's premise is that nothing centralizes.
- **A run authenticates as its stage's role.** The role's installation token is minted per run rather than held, and the session is launched with it already in place — a stage never selects its own identity.
- **Credentials resolve from the environment and are never written to disk.** This **corrects the epic's wording**: ENG-141 says "credential storage and scoping," and there is no store. ENG-163 establishes `jen run` as a resolver rather than a store, and the same rule governs here — a resolver, nothing outside the process, nothing left behind on the host.
- **The default branch requires an approving review**, which is what converts the verdict from advisory into load-bearing. GitHub's refusal to accept a review from the author covers `design` for free, and covers nobody else: the host's protections subtract actors from the eligible set and cannot name an approver, and the setting that would also exclude the last pusher turns out to lock delivery out of its own merge. **That which role approves is workflow convention rather than branch configuration** is the one place this change accepts less than it set out to — stated plainly here because a reader who assumes the branch enforces it would never think to check.
- **`registry.yaml` records the identities' non-secret coordinates** — enough to identify each role's application and the workspace's agent user, and no secret of any kind.

**This task changes no stage skill, but it does not leave them workable either.** Design probed the tracker with a real agent token and found its diff surface invisible to any non-human identity — `list_diffs` empty and `get_diff` reporting `Diff not found` for pull requests a human reads fine, because Linear's diffs link a Linear user to a GitHub account and an app user has none. Every stage that touches the pull request calls those tools today, so all six must move that work to `gh`. That lands in ENG-166, which already owns hardening the stages for unattended runs. Until it does, these identities are registered and correct and no stage can yet submit a verdict with them.

This is additive for an existing install: binding a project again reports identity registration as outstanding rather than failing, and a project driving its stages attended keeps working untouched.

## Capabilities

### New Capabilities

- `pipeline-identity`: the three roles and the stages each covers; a distinct application identity per role on the git host and one shared agent identity on the tracker; per-fork registration; credentials resolved from the environment and never stored; a run acting as its stage's role; and the merge gate that makes a review verdict load-bearing.

### Modified Capabilities

- `project-binding`: binding grows identity registration alongside tracker binding, and the registry records the identities' non-secret coordinates. Today the capability covers the tracker only — the team, the project, the statuses, and the labels — and says the registry holds "the shape the stages read when they need to know what they are acting on." Identities are part of that shape, and binding is where they are established.

Deliberately unmodified: `stage-conventions` and `agent-instructions`. A stage never chooses its own identity — it inherits credentials the dispatcher put in its environment — so no convention shared by every stage changes, and the root workflow document gains no new rule. The identity mapping is operator-facing, which places it in `pipeline-identity` and in what binding reports.

## Impact

**Changed here**

- `.claude/skills/setup-jen/SKILL.md` — registration of the three applications and the agent, verification on re-run, and the merge gate check.
- `scaffold/registry.yaml` — the documented resource shape gains identity entries.
- jen's own repository configuration — the existing `primary` ruleset requires a pull request but with an approving-review count of `0`, which has to rise for the gate to bite.

**Not changed here**

- The CLI. `jen run` carries the Linear client and reads these credentials, and that is ENG-163's; this task establishes *what* the credentials are and how a role's token is minted, not the plumbing that consumes them during a tick. Stated explicitly because without the line drawn, both tasks build a credential path.
- Any stage skill's behaviour.

**Depended on**

- Linear's GitHub integration had to be authorized for the `reveer-ai` organization before any Linear-mediated PR mechanism worked on jen's own pull requests — `list_diffs` returned Linear's knowledge of a personal-account repository and nothing for this one. Connected 2026-08-13. Because Linear mirrors pull requests going forward and does not backfill closed ones, the first PR opened after that is the confirmation, and this change's own draft PR is it.
- ENG-141's "confirm first" — seeing the self-approval refusal through Linear's `submit_diff_review` specifically rather than through GitHub's API alone — closes against that same PR.

**Depends on this**

- ENG-163 and ENG-164, which launch a stage session under a role and therefore need the roles to exist.

**This depends on**

- ENG-166, for the pull-request work to reach a surface the agent identity can actually see. The identities are independently correct without it; the review path is not complete until both have landed, and the merge gate should not be tightened on any repository before then.
