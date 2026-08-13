## Context

See [proposal.md](./proposal.md) — Why. The constraints that shape the approach, all verified rather than assumed:

- **The git host refuses a review from a pull request's author**, and returns `422 "Review Can not request changes on your own pull request"`. Through Linear's `submit_diff_review` the same refusal surfaces as a generic `400 invalid_request` with the reason stripped, so the condition is not diagnosable from the error. Recorded on ENG-141.
- **A required-reviewer rule cannot name an application identity.** The ruleset's required-reviewers setting takes teams only — up to fifteen, per file path, each needing write permission — and an application cannot join a team. The gate therefore cannot be expressed as "the `review` role must approve."
- **A CI platform's default workflow credential produces a review that does not count.** `github-actions[bot]` reviewing under the default token is recorded and rendered indistinguishably from any other review, and satisfies no approval requirement. A custom application's installation token does count.
- **The two hosts' registration flows are not equivalent.** The git host's app manifest can create an application and return its credentials; the tracker's manifest only pre-populates a creation form and returns nothing.
- **Today every stage authenticates as one human**, through `gh` for the git host and through the tracker's MCP server for the tracker. Neither is role-aware.
- **jen's own default branch** carries a ruleset requiring a pull request with an approving-review count of `0`, a required `check` status check, and one human bypass.

## Goals / Non-Goals

**Goals:**

- Three roles usable by both runners ENG-165 will ship, with no code path that only works under one.
- A stage session that is role-agnostic: it holds one identity, cannot name it, and cannot reach another.
- No stage skill's text changes.
- A gate that holds structurally, not by the pipeline's good behaviour.

**Non-Goals:**

- The dispatcher's injection of credentials into a session — ENG-164 owns that; this design fixes the contract it injects against.
- Any credential store, file format, or key rotation mechanism. Credentials are the operator's, held wherever their runner holds secrets.
- Registering the identities for jen's own repository as part of implementation. That is an operator action, tracked separately from the code that consumes it.

## Decisions

### The session sees role-agnostic variable names

The dispatcher resolves three role-specific secret sets and injects **role-agnostic** names into the stage session: `GH_TOKEN` for the git host, `LINEAR_TOKEN` for the tracker. A stage reads the same two names whatever role it is running as, and nothing inside the session reveals which of the three it holds or how to reach another.

This is what makes "a run holds its stage's identity and never selects one" true by construction rather than by instruction — there is no role-selection API inside the session to misuse, because the role was resolved before it started.

`GH_TOKEN` specifically, not `GITHUB_TOKEN`: `gh` prefers `GH_TOKEN` when both are set, and under the Actions runner `GITHUB_TOKEN` is the very credential whose reviews silently fail to count. Naming the variable so it *wins* against the dangerous default, rather than colliding with it, is the difference between a review that gates and a review that decorates.

*Alternative rejected:* role-suffixed names inside the session (`GH_TOKEN_REVIEW` and so on). It would let a stage discover and potentially use another role's credential, and every skill would need to know its own role — pushing role awareness into the layer that must not have it.

### The tracker is reached by injecting the role's token into the MCP server, not by rewriting the skills

The skills call the tracker through its MCP server. The role's agent token is supplied to that server as a bearer credential interpolated from `LINEAR_TOKEN`, so every tool name a skill calls is unchanged and no skill learns anything new.

*Alternative rejected:* moving the skills onto the tracker's GraphQL API directly. It would give precise control over the acting identity, and it would rewrite all six stage skills — contradicting this change's premise that no stage's behaviour changes, and turning a three-point task into a rewrite of the workflow layer. If the MCP path proves unworkable (see Risks), that is a blocker to route back with, not a fallback to quietly take.

### Registration is guided on both hosts, and jen never receives a private key

Both halves of each pair are registered by the user, with the binding skill pre-filling what each host allows and verifying the result afterward. The credential goes from the host to the operator's secret store without passing through jen.

This **corrects the epic's expectation** that manifest flows make registration "a redirect and a confirm." That holds only for the git host, and only if something is listening on a redirect URL to exchange the temporary code for credentials — which a skill running inside an assistant is not. The tracker's manifest cannot return credentials at all. Rather than build a local listener for one host and hand-hold the other, both are guided the same way, and the asymmetry costs the operator a few minutes once per project.

The stronger reason is that it keeps jen's process from ever holding an application private key. A flow where jen receives the key and hands it onward would need to be trusted not to persist it; a flow where jen never sees it does not.

*Alternative rejected:* a transient localhost listener to complete the git host's manifest conversion automatically. Fewer steps on one surface, at the cost of jen handling the private key and of a code path that behaves differently depending on whether a browser can reach the loopback interface.

### Per-role permissions are the minimum each role's stages actually use

| Role | Git-host permissions | Why |
|---|---|---|
| `design` | `contents:write`, `pull_requests:write` | pushes the artifacts, opens the draft pull request |
| `dev` | `contents:write`, `pull_requests:write` | pushes the implementation, replies to and resolves threads |
| `review` | `contents:write`, `pull_requests:write`, `checks:read` | reviews and merges, reads whether checks passed, pushes the archive and spec sync |

`review` holding `contents:write` is unavoidable rather than generous: `deliver-task` merges the pull request and pushes the spec sync and archive. It is not a bypass — the gate constrains what may merge, not who holds write.

### The gate is a count plus most-recent-push approval

The ruleset's pull-request rule becomes `required_approving_review_count: 1` with `require_last_push_approval: true`, leaving the existing `check` requirement and human bypass in place, and adding no role to the bypass list.

The second setting is not a refinement; it is what makes the gate sound. A count alone excludes only the pull request's *author*, and under three roles the author is `design` — so `dev` could approve the implementation it just pushed, and nothing structural would stop it. Requiring the approval to postdate the last push excludes the pusher too, leaving `review` (or the human) as the only actor able to satisfy it.

`dismiss_stale_reviews_on_push` stays off: `require_last_push_approval` already invalidates an approval overtaken by a push, and dismissing outright would erase the verdict from the record that ENG-136 wants readable after the fact.

*Alternative rejected:* a machine user in a team, which the required-reviewer setting *can* name. It would express the intent directly and costs a paid seat, a long-lived token, and a human-shaped account with a password to protect — which is what the epic already decided against.

### A token is minted per run and never held

The application's private key signs a short-lived assertion, which is exchanged for an installation token scoped to that role's installation. The token is minted as the run begins and discarded with the run.

## Risks / Trade-offs

**The tracker's MCP server may not accept an `actor=app` token, or may not expose every tool under one** → This is the design's load-bearing unverified assumption, and implementation verifies it first, before anything is built on it: authenticate as one role's agent and exercise the tools the stages actually depend on, `save_diff_comment`, `get_diff_threads`, `resolve_diff_thread`, `submit_diff_review`, and `merge_diff` among them. If it fails, the fix is not to rewrite the skills quietly — it is to route the task back to design with what was found, because the alternative changes this change's scope entirely.

**An installation token expires after an hour, and a stage run may outlast it** → `implement-task` is the plausible case. Mint at run start, and treat a mid-run expiry as a resumable failure rather than a fatal one: the status stays put and the next tick re-enters, which ENG-166 is making safe anyway. If it turns out to bite often, refreshing mid-run is a contained change behind the same contract.

**Pull requests opened by an application must still trigger CI, or delivery deadlocks** → The gate keeps the `check` status check required, so a pull request whose checks never ran can never merge. The suppression that causes this applies to the CI platform's own default credential, not to an application's installation token, so an application-opened pull request does trigger workflows. Verify it explicitly on the first pull request `design` opens, because the failure mode is a task stuck in delivery with no error anywhere.

**Three roles across two hosts is real setup friction, and a half-registered project is the likely state** → Binding names exactly which roles and which halves are outstanding and is re-runnable, so the operator converges across several sittings instead of needing one clean pass.

**The gate's guarantee is positional, not nominal** → It rests on `design` authoring and `dev` pushing last. A future change that had one role both open the pull request and push the implementation would collapse the two exclusions into one and let that role approve its own work. The specs state the guarantee in terms of author and last pusher for exactly this reason, and a change to which role does what has to re-check it.

**A human bypass remains** → Deliberate. Somebody must be able to break the glass on an unattended pipeline. It does mean the gate constrains the pipeline, not the operator, which is the correct asymmetry but worth stating plainly rather than discovering.

## Migration Plan

1. Verify the tracker MCP assumption above. A failure here stops the rest.
2. Register the three pairs against jen's own organization and workspace, recording their non-secret coordinates in `registry.yaml` and their credentials in the runner's secret store.
3. Tighten jen's `primary` ruleset from an approving-review count of `0` to the gate above. Do this **after** the roles exist, since raising the count first blocks merges nobody can yet approve.
4. Confirm on the first pull request opened by `design` that CI triggers and that a verdict submitted by `review` counts toward the requirement.

Rollback is dropping the count back to `0`: the identities can stay registered and unused, and the pipeline degrades to what it does today rather than breaking.
