## Context

See [proposal.md](./proposal.md) — Why. The constraints that shape the approach, all verified rather than assumed:

- **The git host refuses a review from a pull request's author**, and returns `422 "Review Can not request changes on your own pull request"`. Through Linear's `submit_diff_review` the same refusal surfaces as a generic `400 invalid_request` with the reason stripped, so the condition is not diagnosable from the error. Recorded on ENG-141.
- **A required-reviewer rule cannot name an application identity.** The ruleset's required-reviewers setting takes teams only — up to fifteen, per file path, each needing write permission — and an application cannot join a team. The gate therefore cannot be expressed as "the `deliver` role must approve."
- **A CI platform's default workflow credential produces a review that does not count.** `github-actions[bot]` reviewing under the default token is recorded and rendered indistinguishably from any other review, and satisfies no approval requirement. A custom application's installation token does count.
- **The two hosts' registration flows are not equivalent.** The git host's app manifest can create an application and return its credentials; the tracker's manifest only pre-populates a creation form and returns nothing.
- **Today every stage authenticates as one human**, through `gh` for the git host and through the tracker's MCP server for the tracker. Neither is role-aware.
- **The tracker's diff surface is invisible to a non-human identity.** Probed live during design: an `actor=app` token sees all 53 MCP tools and a fully working issue surface, but `list_diffs` returns empty and `get_diff` returns `Diff not found` for pull requests a human token reads fine. Linear's diffs link a Linear user to a GitHub account, and an app user has none.
- **jen's own default branch** carries a ruleset requiring a pull request with an approving-review count of `0`, a required `check` status check, and one human bypass.

## Goals / Non-Goals

**Goals:**

- Three roles usable by both runners ENG-165 will ship, with no code path that only works under one.
- A stage session that is role-agnostic: it holds one identity, cannot name it, and cannot reach another.
- No stage skill changed *by this task*. Moving their pull-request calls off the tracker is required and belongs to ENG-166. The workflow document is not a stage skill and this task does change it — one convention, stated once, rather than the same prohibition copied into two skills.
- A gate that holds **as far as the host can express it**, and by stated convention past that point. This was "structurally, not by the pipeline's good behaviour" until the delivery flow proved it unreachable; see the gate decision below for what was traded and why.

**Non-Goals:**

- The dispatcher's injection of credentials into a session — ENG-164 owns that; this design fixes the contract it injects against.
- Any credential store, file format, or key rotation mechanism. Credentials are the operator's, held wherever their runner holds secrets.
- Registering the identities for jen's own repository as part of implementation. That is an operator action, tracked separately from the code that consumes it.

## Decisions

### The session sees role-agnostic variable names

The dispatcher resolves the role's git-host credential and injects **role-agnostic** names into the stage session: `GH_TOKEN` for the git host, `LINEAR_TOKEN` for the tracker. A stage reads the same two names whatever role it is running as, and nothing inside the session reveals which of the three it holds or how to reach another.

Only `GH_TOKEN` actually varies by role; `LINEAR_TOKEN` is the one shared agent's and is constant across all three. That asymmetry stays *inside* the dispatcher — the session's contract is two names either way, so a later decision to split the tracker agent per role would change what the dispatcher resolves and nothing a stage sees.

This is what makes "a run holds its stage's identity and never selects one" true by construction rather than by instruction — there is no role-selection API inside the session to misuse, because the role was resolved before it started.

`GH_TOKEN` specifically, not `GITHUB_TOKEN`: `gh` prefers `GH_TOKEN` when both are set, and under the Actions runner `GITHUB_TOKEN` is the very credential whose reviews silently fail to count. Naming the variable so it *wins* against the dangerous default, rather than colliding with it, is the difference between a review that gates and a review that decorates.

*Alternative rejected:* role-suffixed names inside the session (`GH_TOKEN_REVIEW` and so on). It would let a stage discover and potentially use another role's credential, and every skill would need to know its own role — pushing role awareness into the layer that must not have it.

### The tracker carries issue work; the git host carries pull-request work

The agent token is supplied to the tracker's MCP server as a bearer credential interpolated from `LINEAR_TOKEN`, and stages use it for issue-surface work: reading the task, moving its status, commenting, attaching artifacts. Pull-request work — review comments, threads, verdicts, merges — goes to the git host directly through `gh`, under the role's installation token.

**This split is forced, not preferred**, and the probe below is what forced it.

Bearer-token authentication as an app user is documented and works: Linear's MCP server "supports passing OAuth token and API keys directly in the `Authorization: Bearer <yourtoken>` header," naming use **as an app user** among the reasons. Probed live against a real `actor=app` token, the server returns all 53 tools, and the issue surface reads and writes correctly with actions attributed to the agent.

The diff surface does not work under that identity, and cannot be made to:

| Call | As app user | As a human |
|---|---|---|
| `list_diffs`, unfiltered | `{"diffs":[]}` | returns the repository's pull requests |
| `get_diff` on a known pull request | `Error: Diff not found` | returns the diff |

The tools are *listed* and have nothing to act on. Linear's diffs originate in its GitHub integration, which links a Linear **user** to a **GitHub account**. An app user has no GitHub account to link, so no diff is ever visible to it. No scope widens this; it is structural.

*Alternative rejected:* holding a human's tracker token for diff work. It would restore the diff tools, and it would restore the original problem with them — a verdict submitted under the human who authored the pull request, which is the thing this change exists to stop.

**Consequence for scope.** Every stage that touches the pull request called tracker diff tools when this was written, so all six needed those calls moved to `gh`. That was not this task's work: it landed in ENG-166 as `e43bc91`, which already owned hardening the six stages for unattended runs, and a surface invisible to the unattended identity is exactly what unattended operation breaks. This change therefore **no longer claims that no stage skill's text changes** — it claims only that this task does not change them.

### Registration is guided on both hosts, and jen never receives a private key

Every identity is registered by the user — the three applications on the git host and the one agent on the tracker — with the binding skill pre-filling what each host allows and verifying the result afterward. The credential goes from the host to the operator's secret store without passing through jen.

This **corrects the epic's expectation** that manifest flows make registration "a redirect and a confirm." That holds only for the git host, and only if something is listening on a redirect URL to exchange the temporary code for credentials — which a skill running inside an assistant is not. The tracker's manifest cannot return credentials at all. Rather than build a local listener for one host and hand-hold the other, both are guided the same way, and the asymmetry costs the operator a few minutes once per project.

The stronger reason is that it keeps jen's process from ever holding an application private key. A flow where jen receives the key and hands it onward would need to be trusted not to persist it; a flow where jen never sees it does not.

*Alternative rejected:* a transient localhost listener to complete the git host's manifest conversion automatically. Fewer steps on one surface, at the cost of jen handling the private key and of a code path that behaves differently depending on whether a browser can reach the loopback interface.

### The tracker gets one agent, not one per role

Roles are distinguished on the git host and share a single agent on the tracker. See proposal.md — What Changes, for why: the constraint forcing distinct identities is the git host's refusal of an author's own review, and the tracker has no equivalent, so per-role tracker agents would differ only in the name on a comment while tripling the hand-registration an adopter performs.

The consequence worth stating here is what it costs. The tracker's issue timeline will read as one actor for all six stages, so "which stage moved this" has to be read from the status transition rather than from the author. And if ENG-163 settles on the tracker's `delegate` field as its in-flight lease carrier, `delegate` will say that *a* run holds the task rather than *which* stage does. Both are recoverable — splitting the agent later changes what the dispatcher resolves and nothing a stage sees — but ENG-163 should choose its carrier knowing this rather than discovering it.

*Alternative rejected:* three agents, matching the epic's original "three identity pairs." Rejected on cost: attribution on a surface that already records the status transition, bought with three passes through the manual registration flow for every adopter.

### Per-role permissions are the minimum each role's stages actually use

| Role | Git-host permissions | Why |
|---|---|---|
| `design` | `contents:write`, `pull_requests:write` | pushes the artifacts, opens the draft pull request |
| `dev` | `contents:write`, `pull_requests:write`, `workflows:write` | pushes the implementation, replies to and resolves threads |
| `deliver` | `contents:write`, `pull_requests:write`, `checks:read`, `workflows:write` | reviews and merges, reads whether checks passed, pushes the archive and spec sync |

`deliver` holding `contents:write` is unavoidable rather than generous: `deliver-task` merges the pull request and pushes the spec sync and archive. It is not a bypass — the gate constrains what may merge, not who holds write.

**`workflows:write` is granted where a role would otherwise be stopped by a push it has every reason to make.** An application cannot create or update any file under `.github/workflows/` without it, and the rejection arrives at push time naming the permission rather than the cause. `dev` needs it because a task whose implementation touches CI is ordinary — ENG-165, which puts a stage on Actions, cannot be implemented without it. `deliver` needs it because updating a pull request's branch from a base that has moved is [documented to fail the same way](https://github.com/Mergifyio/mergify/issues/5055) when workflow files are in play, and that update is exactly what `deliver-task` does before merging. `design` does not get it: it pushes OpenSpec artifacts and nothing else.

The cost is real and worth naming: `dev` can edit the very `check` workflow its own pull request must pass. Nothing structural prevents that — it is caught by `deliver` reading the diff, the same way any other self-serving change is. Withholding the permission does not buy protection, it buys a class of task that deadlocks at push with an error naming a permission.

### The gate is a count of one, and the rest is convention

The ruleset's pull-request rule becomes `required_approving_review_count: 1`, leaving `require_last_push_approval` **off**, the existing `check` requirement and human bypass in place, and adding no role to the bypass list.

**Last-push approval was the first design and it does not survive contact with the delivery flow.** `deliver-task` is not a merger; it is a pusher and then a merger — it syncs the delta specs into `openspec/specs/`, moves the change under `openspec/changes/archive/`, pushes that, and only then merges. So `deliver` is the last pusher on every pull request the pipeline completes. Under `require_last_push_approval`, the approval must come from someone other than the last pusher: `design` is the author and the host refuses its review outright, `dev` is not running by then, and `deliver` cannot approve its own push. No pipeline role can satisfy it. The gate does not merely become strict — it becomes unsatisfiable, and every task parks in delivery until a human breaks the glass, which is the failure this epic exists to remove.

**What the count alone still enforces, for free.** `design` opens the pull request, and the host refuses an approval from a pull request's own author no matter what any prompt says. That exclusion is structural and costs nothing.

**What moves from the host to the workflow document.** `dev` is not excluded by anything the host offers, so the prohibition is stated as a convention instead: only review-task approves, only deliver-task merges. This is a real reduction in what the configuration guarantees, and it is accepted deliberately — the alternative designs that preserved a fully structural gate each cost more than the guarantee was worth. Keeping `dev` a *distinct identity* is what makes a breach legible: an approval from `dev` is visible in the pull request timeline as the wrong actor, where under a single shared identity it would be indistinguishable from correct behaviour. The convention is not enforced, but its violation is not silent.

A second, quieter exclusion survives the change: an approval by `dev` of its own work would still have to get past `deliver` reading the diff, because `deliver` merges. Nothing about the eased gate lets a pull request reach `main` without the delivering role handling it.

`dismiss_stale_reviews_on_push` stays off, and the reason changes rather than disappearing. It was justified by `require_last_push_approval` already covering the stale case, plus preserving the verdict for the record ENG-136 wants readable. With last-push approval gone it becomes load-bearing in its own right: turned on, `deliver-task`'s own archive push would dismiss the approval it is about to merge on, reintroducing the deadlock by another route. The stale-approval risk it would have covered — review approves, testing routes back, `dev` pushes a fix, delivery merges on the old verdict — is covered by the pipeline's routing instead, since `In Progress` always passes through `In Review` again before reaching delivery.

*Alternatives rejected:*

- **A fourth identity, splitting `review` from `deliver`.** Its only structural job was to supply an approver who was not the last pusher. Once the gate stops asking about the last pusher, the split buys only timeline legibility, at the price of a fourth registration flow for every adopter.
- **A required status check that inspects the approver's identity.** The one mechanism that can express "the `review` identity approved," since it reads the approval list itself rather than relying on the host's exclusions. Rejected on scope and on configuration weight: it puts a bespoke workflow between every task and its merge, and its own failure modes — a check that must report against the head SHA, and a required check that does not run on every event stranding a pull request at "expected" — are less obvious than the rule it replaces.
- **Reordering delivery so it never pushes**, moving the spec sync and archive to the implementation side. It preserves the fully structural gate and was the cheapest such option, but it relocates work away from the stage that owns it to satisfy a branch-protection setting.
- **A machine user in a team**, which the required-reviewer setting *can* name. It would express the intent directly and costs a paid seat, a long-lived token, and a human-shaped account with a password to protect — which is what the epic already decided against.

### A token is minted per run and never held

The application's private key signs a short-lived assertion, which is exchanged for an installation token scoped to that role's installation. The token is minted as the run begins and discarded with the run.

## Risks / Trade-offs

**The pipeline's review path depends on two things this change does not deliver** → Resolved from a risk into a known dependency. A verdict that counts needs the stage skills to issue their pull-request calls through `gh`, because the diff tools are invisible to the agent identity — and it needs the stage session to *hold* the role's identity, because an approval from the pull request's own author is refused however it is sent. The first landed in ENG-166 as `e43bc91`; the second is ENG-163's and ENG-164's and has not. Registering the identities is still independently useful and independently correct, but the epic needs all three, and ENG-141 delivering alone leaves the gate satisfiable only by a human. Ordering: the merge gate should not be tightened on any repository until both hold there, or delivery blocks on an approval no stage can give.

**Key that ordering on the capability itself, and state it as an observation.** Two proxies for it have now gone true while the capability stayed absent. "Has ENG-166 landed" went true when ENG-166 merged as `1280f80` without making the move. Its replacement — a grep of the skills for the tracker's diff calls — went true when `e43bc91` did make the move, while the stages continued to authenticate as whoever launched them. Each replacement was right about its predecessor and inherited the same defect: it checked one input to the capability rather than the capability. The capability is an approving review recorded on a real pull request by an identity that is not its author, and it needs the surface *and* the identity. An issue's status is a claim about intent; the skills' text is evidence of the surface a stage reaches, not of the identity it holds; only the timeline of such a pull request is evidence of both.

**A future reader may assume the diff tools work because they appear in `tools/list`** → They are listed for every token; only their contents differ. Anyone debugging an empty `list_diffs` will reasonably suspect the GitHub integration is disconnected, because that is the other cause and it looks identical. This is exactly what the note in task 7 exists to prevent.

**An installation token expires after an hour, and a stage run may outlast it** → `implement-task` is the plausible case. Mint at run start, and treat a mid-run expiry as a resumable failure rather than a fatal one: the status stays put and the next tick re-enters, which ENG-166 is making safe anyway. If it turns out to bite often, refreshing mid-run is a contained change behind the same contract.

**Pull requests opened by an application must still trigger CI, or delivery deadlocks** → The gate keeps the `check` status check required, so a pull request whose checks never ran can never merge. The suppression that causes this applies to the CI platform's own default credential, not to an application's installation token, so an application-opened pull request does trigger workflows. Verify it explicitly on the first pull request `design` opens, because the failure mode is a task stuck in delivery with no error anywhere.

**Three roles across two hosts is real setup friction, and a half-registered project is the likely state** → Binding names exactly which roles and which halves are outstanding and is re-runnable, so the operator converges across several sittings instead of needing one clean pass.

**The gate now depends on a convention the host does not enforce** → `dev` holds `pull_requests:write` and the branch asks for one approval from anyone with write access, so nothing in the configuration stops `dev` approving its own implementation. Only the workflow document does. The mitigations are that the roles stay distinct identities, which makes a breach visible in the timeline rather than silent, and that `deliver` still merges and still reads the diff. If breaches turn out to happen, the rejected identity-inspecting status check is the escalation path, and it does not require unwinding anything decided here.

**The host's exclusions could never have expressed the intent anyway** → Worth recording, because it is the reason the trade above is smaller than it first looks. Both mechanisms the host offers are *subtractive*: they remove the author and the most recent pusher from the eligible set, and never name an approver. Even a fully structural gate would have said "one approval from anyone else with write access," not "one approval from `review`." The last-pusher exclusion is also only ever one deep — a push by a second role returns the first to eligibility, so a flow of `design` opens, `dev` pushes, `design` amends would have left `dev` free to approve the implementation it wrote. The setting protects the last hop, not the history.

**A human bypass remains** → Deliberate. Somebody must be able to break the glass on an unattended pipeline. It does mean the gate constrains the pipeline, not the operator, which is the correct asymmetry but worth stating plainly rather than discovering.

## Migration Plan

1. Register the three applications and the one agent against jen's own organization and workspace, recording their non-secret coordinates in `registry.yaml` and their credentials in the runner's secret store. The tracker agent already exists — it is the `jen` app user the design probe registered.
2. Confirm on the first pull request opened by `design` that CI triggers, since a pull request whose checks never run can never merge.
3. **Wait until a stage can submit a verdict the host accepts** — an approving review on a real pull request from an identity that is not its author. That needs the stage skills to issue their pull-request calls through `gh`, which ENG-166 landed as `e43bc91`, *and* the stage session to run under its role's own installation token, which is ENG-163's and ENG-164's and has not landed. Verified by observing such an approval, not by reading either issue's status and not by the skills' text alone — the skills evidence the surface, never the identity.
4. Only then raise jen's `primary` ruleset from an approving-review count of `0` to `1`, leaving `require_last_push_approval` and `dismiss_stale_reviews_on_push` off, and confirm that a verdict submitted by `deliver` counts toward the requirement.

The ordering is the plan. Tightening the gate before step 3 blocks delivery on an approval no stage is able to give, leaving the human bypass as the only way to merge anything — which looks like a working pipeline while it is doing nothing.

The convention half of the gate has no migration step, which is precisely why it is worth a line here: it lands with the workflow document and applies from the next run of any stage, on every project that takes the update. Nothing reports whether it is being honoured. An adopter auditing their own pipeline should read the pull request timeline for the identity on each approval, not the branch protection.

Rollback is dropping the count back to `0`: the identities can stay registered and unused, and the pipeline degrades to what it does today rather than breaking.
