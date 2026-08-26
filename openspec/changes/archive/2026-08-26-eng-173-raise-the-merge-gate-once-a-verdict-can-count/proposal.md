## Why

The `pipeline-identity` spec says the default branch admits only an approved change. jen's own default branch admits anything: the `primary` ruleset sits at an approving-review count of `0`, so the review stage is decorative on the one repository that ships the review stage.

ENG-141 left it eased deliberately. Tightening a gate before any identity can satisfy it does not make delivery strict, it makes delivery impossible — every task parks waiting on an approval nothing can give. That reason has now expired: ENG-163 and ENG-164 landed the per-run installation token, so `deliver` holds a credential of its own and can submit a verdict the host attributes to something other than the pull request's author.

What has still never happened is the observation. Every task pull request on this repository — #9, #11, #13, #14, #15, #16 — was opened by a human account. The only application-authored one is #10, ENG-141's throwaway probe, and no verdict from any pipeline role has ever been recorded on anything. "A verdict counts" is a claim about a capability nobody has exercised, and this task's own history is two rounds of that same claim reading as satisfied off a proxy while the capability was absent.

## What Changes

**The gate goes up on jen's repository.** `primary` moves to an approving-review count of `1`, keeping `require_last_push_approval` and `dismiss_stale_reviews_on_push` off, the `check` requirement in place, the human bypass in place, and no role on the bypass list.

**`deliver`'s installation gains `statuses:read`.** ENG-141's permission table assigns it and the installation is one short — granted permissions today are `checks:read, contents:write, metadata:read, pull_requests:write, workflows:write`. `design` and `dev` match the table already. The gap is invisible while nothing gates on a pull request's result and becomes load-bearing the moment something does, which is this change. Verified on the granted side, because amending an application does not amend its installation.

**The observation is made, on a real pull request.** A verdict submitted by `deliver` counts toward the requirement rather than merely being recorded; the approval survives delivery's own spec-sync and archive push; the human bypass still opens. This change's own pull request is the vehicle — a human authored it, so `deliver` is eligible to approve it, and delivery's archive push is the survival test. If the pipeline can merge the change that raises its own gate, the gate is proven by the thing it gates.

**The gate requirement is restated as a property rather than as a list of settings.** The spec today names two host settings that must stay off. That enumeration is the same shape of defect the task's history is made of: it is a check on the inputs known when it was written, not on the capability. jen's ruleset already carries a third setting in that family — `require_extra_approval_for_unattributed_changes`, on by default — which raises the requirement to one *more* than configured for a pull request GitHub considers unattributed. The property the three share is what the spec should hold: **no branch configuration may raise the effective requirement above one approval from a non-author**, since one approval from `deliver` is the most the pipeline can produce. The named settings become instances of that property, and a fourth the host adds later is caught by the same words. This also subsumes what the spec currently notes in prose about team-scoped required reviewers, which an application cannot join.

**Whether the third setting bites is settled by observation, not by reading.** GitHub documents it as scoped to Copilot opening a pull request under its own app identity, and documents that it has no effect at an approving-review count of zero — which is why jen has never seen it and why no evidence about it exists on this repository today. The API field is named for unattributed *changes* with no mention of Copilot, and GitHub calls the feature preview and subject to change. Raising the count to `1` is the act that makes it live for the first time. So the first application-authored pull request after the raise either needs one approval or two, and that is the answer. Needing two makes it a third instance of the property, turned off on jen and read by binding like the other two. Needing one makes it a documented non-hazard, recorded where the next session would otherwise re-derive it.

## Capabilities

### Modified Capabilities

- `pipeline-identity`: the gate requirement is restated as a bound on the effective approving-review count that no branch configuration may exceed, with the individually named settings as instances rather than as the whole of it.
- `project-binding`: binding verifies the gate against that bound — reading every setting that raises the effective requirement, not a fixed pair by name — and reports a branch that exceeds it as not satisfying the gate.

## Impact

- **jen's own hosts, not its tree**: the `primary` ruleset's approving-review count, and `deliver`'s installation permissions. Neither is a tracked file; both are verified by reading the host back.
- `openspec/specs/pipeline-identity/spec.md` — the gate requirement's wording.
- `openspec/specs/project-binding/spec.md` — what binding reads before reporting.
- `.claude/skills/setup-jen/SKILL.md` — the gate section, which enumerates the two settings today and states the permission table.
- A note in `cli/AGENTS.md` — jen's sources sit there rather than under `src/` — recording what the observation established about the unattributed-changes setting, whichever way it lands.
- Every later task on this repository merges through a gate that requires an approval, so a stage that skips the review verdict now blocks delivery instead of passing unnoticed.
