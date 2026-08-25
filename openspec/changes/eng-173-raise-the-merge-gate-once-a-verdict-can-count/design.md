## Context

See `proposal.md` — Why. The state this design starts from, read off the hosts rather than off the description:

- `primary` (ruleset `20589957`, targeting `~DEFAULT_BRANCH`, enforcement `active`) carries `required_approving_review_count: 0`, `require_last_push_approval: false`, `dismiss_stale_reviews_on_push: false`, a required check named `check`, `require_extra_approval_for_unattributed_changes: true`, and one bypass actor — a `User`, with no `Integration` on the list.
- `deliver`'s installation carries `checks:read, contents:write, metadata:read, pull_requests:write, workflows:write`. `design` and `dev` match ENG-141's table already; only `deliver` is short, and only by `statuses:read`.
- No pipeline role has ever approved anything, and no pipeline role has ever opened a task pull request. Every task pull request on this repository was opened by a human account; the only application-authored one is #10, ENG-141's throwaway probe, closed a minute after it opened.

Two constraints shape everything below. The gate's own settings are inert at a count of zero — the host documents the unattributed-changes setting as having no effect there — so **the repository holds no evidence about its own gate and cannot be made to yield any without raising the count first**. And no pipeline role holds `administration:write`, so **no role can raise the gate**; that is deliberate, since a role that could edit the ruleset could also remove it.

## Goals / Non-Goals

**Goals:**

- Raise jen's gate to the state `pipeline-identity` describes, and leave the repository matching its own spec.
- Establish by observation — not by reading configuration — that a `deliver` verdict counts, that it survives delivery's own push, and that the human bypass still opens.
- Settle whether `require_extra_approval_for_unattributed_changes` reaches the pipeline's pull requests, and record the answer where the next session finds it.

**Non-Goals:**

- Automating the ruleset change. It is a repository-administration act, performed once per project by a person, and `setup-jen` already owns presenting and applying it on a bound project.
- Granting any role `administration:write` so that it could. The gate a role can edit is not a gate.
- Changing what any stage does. `review-task` already submits the verdict and `deliver-task` already merges; this change makes those acts load-bearing rather than advisory.

## Decisions

### Raise first, observe second

The observation cannot precede the raise. "Counts toward the requirement" is not a property a verdict has at a count of zero — there is no requirement for it to count toward — and the unattributed-changes setting is documented as inert at zero, so a probe run beforehand would answer neither question and would read as reassuring while doing it.

The order is therefore: grant the permission, raise the count, then observe. The human bypass is what makes this safe to do in that order — it is on the ruleset already, held by a `User`, and it is the escape hatch if the raise deadlocks something. Rollback is setting the count back to `0`, which is one call and immediate.

*Alternative considered:* raise it on a scratch repository first and observe there. Rejected — the thing under observation is this repository's applications against this repository's ruleset, and a scratch repository would need all three applications installed on it to reproduce anything. That is more setup than the rollback it avoids.

### PR #12 is the natural experiment for the unattributed question, and this change's own pull request cannot be

This is the decision most easily got wrong. **This change's pull request cannot answer the unattributed-changes question**, because a human authored it. The setting bites on pull requests the host treats as unattributed — opened by an application acting as itself — and a human-authored one is outside it however the host scopes the rule. Approving this pull request on one `deliver` verdict would therefore demonstrate nothing about the setting, while looking exactly like it had.

There is an application-authored pull request open on this repository right now: #12, `Version Packages`, opened by `app/reveer-release`. It requires no approval today because the count is zero. The moment the count goes to `1`, it reports its own requirement — one approval if the setting is scoped to the host's own assistant as documented, two if it reaches any application acting as itself. That is the whole question, answered by reading an existing pull request after a change already being made, with nothing opened and nothing thrown away.

*Alternative considered:* open a throwaway application-authored probe, as ENG-141 did with #10. Kept in reserve rather than adopted — if #12 has merged or been closed by the time the raise happens, a probe opened as `design` answers the same question, at the cost of a private key in the environment and a pull request to clean up.

### The two questions split across two vehicles

- **Does a setting scoped to unattributed pull requests reach ours?** — PR #12, or a `design`-authored probe. Requires an application-authored pull request and nothing else.
- **Does a `deliver` verdict count, and does it survive delivery's own push?** — this change's own pull request. Requires a pull request `deliver` did not author, which this one is, and a real delivery sequence: approve, then push the spec sync and the archive, then merge. Delivery's push is the survival test, and it is the check that would have caught the original design.

Neither vehicle answers the other's question. Running only one and reporting the gate proven is the failure this task exists to stop repeating.

### The spec states a bound; the settings are instances

The requirement changes from an enumeration of two host settings to a bound on the effective approving-review count — see `specs/pipeline-identity/spec.md`. The enumeration was accurate when written and is already incomplete: the host has since added a third setting in the same family, on by default on new and existing rulesets, which nobody noticed because it is invisible at a count of zero.

An enumeration of another party's settings has a fixed failure mode: it goes stale silently, and every reading of it stays correct about the settings it names. That is the same defect this task's own history is made of — a check on an input to a capability rather than on the capability — so reproducing it in the fix would be a poor joke.

*Alternative considered:* name the third setting and keep the list. Rejected for the reason above; naming a third is a list of three with the same property as a list of two. The known settings stay in the spec as instances, because they carry the reasoning a reader needs, but the normative statement is the bound.

### Binding reports "undetermined" rather than "satisfied"

`setup-jen` reads a branch it did not configure, on a host that adds settings. Where it meets a setting bearing on the approving-review requirement whose reach it cannot establish, the honest report is that it could not tell — not that the count reads correct. A gate reported satisfied on a branch where delivery cannot merge is precisely the failure mode the pipeline cannot see from the inside: every check green, every task parked.

## Risks / Trade-offs

**The release pipeline starts needing a human approval.** → PR #12 and every changeset release pull request after it are opened by `app/reveer-release`, which holds `contents:write` and `pull_requests:write` and nothing that approves. Once the count is `1`, those pull requests need an approving review from someone with write access, and no automation on this repository provides one. This is a real operational consequence of the change and not a side effect to discover later: releasing now includes a person approving the version bump. Accepted rather than mitigated — adding `reveer-release` to the bypass list would put an application on the bypass list, which the gate forbids for the pipeline's own roles and which is no better here.

**The unattributed setting reaches our pull requests and delivery deadlocks.** → Observed on PR #12 before any task depends on it. If it needs two approvals, the setting is turned off on `primary` — which the spec already requires wherever it applies to the pipeline's own pull requests — and the observation is repeated.

**The raise deadlocks something not anticipated.** → The human bypass is on the ruleset and stays there; rollback is the count back to `0`. Both are one call.

**`statuses:read` is amended on the application but never accepted on the installation.** → ENG-141's own gotcha, and the reason the spec says to verify on the granted side. Amending an installed application leaves the new permission as a pending request until an organization owner accepts it, and in between the application reads as amended while every token it mints carries the old set. Verification reads `orgs/reveer-ai/installations` and compares the granted permissions, never the application's requested ones.

**The observation is made under a human's credentials by accident.** → The verdict must be submitted by `deliver`, which needs `JEN_GH_PRIVATE_KEY_DELIVER` and the rest of `credentialsFor`'s environment (`cli/github.ts:41`). A session that lacks them and approves anyway approves as a person, which satisfies the branch and proves nothing about the pipeline. The task that makes the observation names the identity in its evidence, so an approval by the wrong actor is visible in the record rather than silently counted.

## Migration Plan

1. Amend `deliver`'s application to request `statuses:read`; accept it on the installation as an organization owner; verify on the granted side.
2. Raise `primary` to `required_approving_review_count: 1`, changing nothing else on the ruleset.
3. Read PR #12's requirement. One approval settles the unattributed question as documented; two settles it the other way and the setting comes off.
4. Take this change's pull request through a real delivery: `deliver` approves, `deliver` pushes the spec sync and the archive, the pull request stays mergeable, `deliver` merges.
5. Record what step 3 established in `cli/AGENTS.md`.

**Rollback:** set the count back to `0`. The gate returns to its current state and nothing else on the ruleset has been touched.

## Open Questions

None. The one unknown — whether the unattributed-changes setting reaches the pipeline's pull requests — is answered by step 3 rather than deferred, and the spec is written to hold either answer without changing.
