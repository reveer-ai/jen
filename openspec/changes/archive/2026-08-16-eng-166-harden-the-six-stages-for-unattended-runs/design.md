## Context

Six stage skills drive a task through its pipeline. Every one of them reads or writes the task on the tracker; four of them also touch the task's pull request, and they do that through the tracker too. ENG-135 chose that deliberately — its proposal states the rule as "Linear's MCP tools for everything the stages read and write on the task, and `gh` for the one thing they cannot do", `gh pr create --draft` being the single exception. Under a human's token that rule is sound, and it keeps the task's narrative on one surface.

ENG-141 changes the identity the pipeline runs as, and that is what invalidates it. A tracker renders a pull request by way of an integration that binds a tracker *user* to a git-host *account*. An identity acting as an application has no such account, so the binding cannot exist and the diff surface is empty for it — probed directly against a real app-user token: `list_diffs` returns `{"diffs":[]}` workspace-wide and `get_diff` returns `Diff not found`, for pull requests a human token reads fine.

What makes this worth a design rather than a find-and-replace is the failure mode. The diff tools are listed in `tools/list` for every identity; only their contents differ. A dispatched review therefore reads zero threads, anchors zero comments, submits no verdict, and reports success. Nothing distinguishes that from a pull request that genuinely had nothing on it.

The current state is four surfaces: the Threads convention and the one-PR convention in the root `AGENTS.md`, and one or two lines each in `design-task`, `review-task`, and `test-task`. `implement-task` and `deliver-task` name no diff tool and inherit the change through the shared conventions.

## Goals / Non-Goals

**Goals:**

- Every pull-request operation a stage performs runs against the git host, under instructions concrete enough that an unattended run does not have to discover the mechanism.
- The division between the two systems is stated once, as a shared convention, rather than six times.
- A review verdict is recorded in a form that counts toward the host's merge gate whenever the identities allow it, which is what unblocks ENG-141's gate work.
- A reintroduced diff-tool call fails a check.

**Non-Goals:**

- **Registering the identities.** ENG-141 owns the three applications and the tokens. No skill learns which role it is.
- **Tightening the merge gate.** Also ENG-141, and explicitly sequenced after this.
- **Moving issue work.** Status, comments, and attachments stay on the tracker and work correctly under an application identity.
- **Supporting a second git host.** The workflow already names `gh` in `AGENTS.md`; this change follows that, and the spec stays worded as "the git host's own client" so the prose is what would change, not the requirement.
- **Resolving PR #11's threads.** The findings they carry are fixed here, but the threads themselves stay open: #11 is merged, so nothing pushed to this branch can answer them. They are answered by the fix existing, not by a reply.

## Decisions

### The instructions name the commands

Three of the four operations are not reachable from `gh --help`, and one has no REST form at all. An unattended run that has to derive them burns turns and may quietly settle for a worse mechanism — posting an unanchored comment instead of an inline one, or leaving a thread unresolved because resolution looks unsupported. So the skills carry the incantations:

**Reading the threads on a PR**, with resolution state and the comment id a reply needs:

```bash
gh api graphql -f query='
query($owner:String!,$repo:String!,$number:Int!){
  repository(owner:$owner,name:$repo){ pullRequest(number:$number){
    author{login}
    reviewThreads(first:100){ nodes{
      id isResolved path line
      comments(first:1){ nodes{ databaseId author{login} body } } } } } } }' \
  -F owner=OWNER -F repo=REPO -F number=N
```

`isResolved` exists only on the GraphQL `reviewThreads` connection. The REST comments endpoint reports no resolution state at all, so a stage reading REST cannot tell an answered thread from an open one.

**A verdict with its inline comments, in one call:**

```bash
gh api repos/OWNER/REPO/pulls/N/reviews --method POST --input - <<'JSON'
{ "event": "APPROVE",
  "body": "…the verdict…",
  "comments": [ { "path": "src/thing.ts", "line": 42, "side": "RIGHT", "body": "…" } ] }
JSON
```

`gh pr review` cannot carry inline comments; it submits a body only. Posting the anchors separately and then the verdict reproduces exactly the failure ENG-166 already fixed elsewhere — comments saved but never published as part of a review.

**Replying to a thread, then resolving it:**

```bash
gh api repos/OWNER/REPO/pulls/N/comments/COMMENT_ID/replies --method POST -f body='…'
gh api graphql -f query='mutation($id:ID!){ resolveReviewThread(input:{threadId:$id}){ thread{ isResolved } } }' -F id=THREAD_ID
```

`COMMENT_ID` is the `databaseId` from the thread's first comment; `THREAD_ID` is the thread's GraphQL node id (`PRRT_…`). Resolution is a GraphQL mutation and has no REST equivalent — the reason to fetch both ids in the read above.

*Alternative considered:* keep the skills at intent level and put the commands in a shipped reference file. Rejected for what it costs — a new fixed path in the payload, which touches the `managed-payload` spec and the install/update contract, to hold four commands. *Also considered:* say nothing and let each run work it out. Rejected because the GraphQL-only resolve path is the kind of thing a run concludes is impossible.

### The verdict picks its event by comparing identities, not by reading a refusal

GitHub refuses `APPROVE` and `REQUEST_CHANGES` from a pull request's own author — `422 Review Can not request changes on your own pull request`, verified against this repository. Today every run is one human, so every review is a self-review; under ENG-141's identities the author and the reviewer are different applications and the refusal disappears.

The check is a comparison of two values the host reports:

```bash
gh pr view N --json author --jq .author.login
gh api user --jq .login
```

Equal means record the verdict as an `event: COMMENT` review with the verdict stated in the body. Different means record the real event.

It must not be done by attempting the event and reading the error. The tracker's proxy for the same call returns a generic `400 invalid_request`, and even against the host directly a refused self-review and a transport failure are indistinguishable from the message — a run that parses them will eventually downgrade a verdict because the network hiccuped.

One wrinkle this design names rather than solves: `gh api user` identifies a *user* token. An installation token has no user behind it and the call does not answer for it. That case is exactly the case where the identities are distinct by construction, so the rule is: when the authenticated identity cannot be determined, attempt the real event; if the host refuses it, record the verdict as a comment review instead. The refusal triggers the fallback without being interpreted for its cause, and if the fallback fails too, the run reports a failure rather than a verdict. ENG-141 is where this gets exercised for real.

### `AGENTS.md` carries the division; the skills carry only their own use of it

The Threads convention and the one-PR convention are shared, so the rule — pull request to the host, task to the tracker — is stated there once. The three skills each lose their tool names and gain nothing but the specific call their own stage makes. This is the `agent-instructions` requirement that a skill does not restate a shared convention, applied to the thing being changed.

The one-PR convention's second paragraph currently explains that the tracker can do everything to a PR *except* create it. That sentence inverts: creating it was never the exception, it was the only part already in the right place.

### The guard is scoped to the shipped skills

A test alongside the existing tooling-floor test in `test/payload.test.ts`, reading the skills named in the payload declaration plus the root `AGENTS.md`, asserting that none of them names a tracker diff tool.

It must not be a tree-wide grep. ENG-141's branch adds a `.claude/skills/AGENTS.md` whose *purpose* is to name these tools and explain that they are inert under an application identity — a note that would fail a tree-wide check forever. Scoping to the payload declaration also means a skill added later is covered automatically.

### The permissions section says what jen actually writes, and its example stops being a whole file

Two defects in the section ENG-166 itself added, found by that task's review and approved through as non-blocking. They are corrected here because this is the change that touches the same work, and because a doc fix does not earn its own trip through six stages.

The claim to fix is "your project's own check commands are not among them, and jen cannot add them", which sits one line below the statement that `jen init` writes the standard `npm run` names. The resolution is not to stop writing them — that was a deliberate decision of the same task — but to say the true thing: jen writes the workflow's own tooling for everyone, plus a starting shape that assumes one ecosystem, and a project outside that ecosystem has entries that are useless to it and entries missing that it needs. What jen cannot know is the project's commands, which is the durable half of the original claim.

The example becomes a fragment showing the entries an adopter *adds*, rather than a complete file. A whole-file example is what makes copying it lossy, and the section's purpose is to establish permissions, not to hand over a file that quietly drops four of them.

The `adoption-docs` requirement carries the same wording, so the delta moves with the README rather than after it. Shipping one without the other leaves the spec asserting something the documentation it governs no longer says.

## Risks / Trade-offs

- **Concrete commands in prose rot when `gh` changes** → they are pinned to REST and GraphQL endpoints rather than to `gh` subcommand flags, which is the slower-moving of the two surfaces. `gh api` is a passthrough.
- **Both this branch and ENG-141 edit the root `AGENTS.md`** → whichever merges second resolves it. The edits are in different conventions except that both touch the neighbourhood of Threads, so the conflict should be mechanical. Flagged on the PR.
- **A run that cannot determine its identity attempts a call the host may refuse** → the fallback is safe and the failure is reported rather than swallowed; the cost is one wasted call in the ambiguous case.
- **The verdict is a comment review for as long as the pipeline runs single-identity** → no review is recorded, so ENG-141's gate stays unsatisfiable until its identities land. That ordering is already ENG-141's, and this change is what makes the real event possible at all.
- **A stage could still reach for a tracker diff tool out of habit** → the guard fails the check, and the convention says it in one place rather than six.

## Migration Plan

Nothing to migrate. The change is instructions plus one test; there is no stored state and no data shape. A task already in flight picks up the new instructions at its next stage, and a task mid-review keeps its existing threads — they are the host's threads either way, since the tracker was only ever rendering them.

Rollback is a revert of the branch.

## Open Questions

- **How an installation-token run names itself to the host**, if it ever needs to. Not answerable here, because no stage learns its own role by design; ENG-141's dispatcher is where the token is injected and where this can be settled.
