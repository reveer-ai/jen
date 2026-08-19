## Context

See [proposal.md](./proposal.md) — Why. The constraints that shape the approach, verified rather than assumed:

- **The CLI has never made a network call.** `init` and `update` are filesystem-only by rule (ENG-160), and the package carries exactly one runtime dependency. `jen run` is the first command that talks to anything.
- **A hidden marker survives a Linear comment round trip verbatim.** Probed live during design: a comment body containing `<!-- jen:picked-up stage=design-task -->` comes back through `list_comments` byte-identical, HTML comment intact. Whether Linear's *editor* renders it invisibly was **not** verified and this design does not depend on it.
- **The tracker's diff surface is invisible to an application identity** (ENG-141, probed there). Nothing in the tick reads a diff, so this does not constrain it — but it is why the tick's only tracker reads are the issue surface.
- **Two runners will drive this** (ENG-165) and neither exists yet. The tick is therefore designed against the contract, not against a caller.
- **`Pending` does not exist on jen's own Linear team.** The statuses today are `backlog`, `todo`, `in design`, `in progress`, `in review`, `in testing`, `in delivery`, `done`, `canceled`, `Duplicate`. Binding verifies statuses and never creates them, so this is an operator action before any tick can park a task.
- **Status names on the team are lowercase** (`in design`, not `In Design`), while the workflow document writes them capitalized. `project-binding` already requires case-insensitive comparison; the tick inherits that rather than inventing its own rule.

## Goals / Non-Goals

**Goals:**

- A tick whose decision is a pure function of what the tracker says, so two runners over identical state reach identical conclusions.
- A dispatch path with no judgment in it — every step a lookup or a comparison — so that what it will do is predictable by reading it.
- Useful on its own, before ENG-164 exists to consume anything it emits.

**Non-Goals:**

- The stage skills' own edits. Six skills gain the announcement and the `Pending` move, and that is mechanical work this change carries, not something the design has decisions to make about beyond the marker's shape.
- Any retry, backoff, deduplication window, or run history. The pipeline's answer to a failed run is a human, by decision, not by omission.
- Any abstraction over trackers. Linear is the only one, and a second one is not on the horizon; a provider interface written now would be shaped by a sample of one.

## Decisions

### The tracker client is `fetch` against the GraphQL API, not the vendor SDK

The tick needs three reads — issues by team and project with their statuses, each candidate's comments, and the issue's suggested branch name — and no writes. `@linear/sdk` brings a GraphQL client, a schema, and a generated document set to serve that, against a package whose entire dependency list today is one entry and whose tarball is asserted by test.

Node 20.19 is already the engine floor and has global `fetch`. Three hand-written queries against a documented, stable API is less code than the wiring the SDK would need, and it keeps the install cost of `jen run` at zero for adopters who never use it.

*Alternative rejected:* `@linear/sdk`. It earns its weight where an application makes many varied calls; this one makes three, forever, and the tick is deliberately the part that never grows.

*Consequence accepted:* schema drift is ours to notice. The queries request named fields, so a removed field fails loudly at the tick rather than silently producing an empty candidate set — which is the failure mode that matters, since an empty set is indistinguishable from "no work" and would look like a healthy quiet pipeline.

### A session's announcement is a hidden marker inside a comment written for a human

A stage opens its session by commenting on the task. The comment is prose — what stage this is, that it has picked the task up — and carries a machine-readable marker the tick matches:

```
<!-- jen:run stage=design-task event=start -->
```

and its closing counterpart, `event=end`, in the comment every session already ends with.

The tick's in-flight test is then: **among the comments authored by the tracker agent, find the most recent one carrying a `jen:run` marker; the task is in flight if that marker is `event=start`.** Nothing else about the comment is parsed, and comments without a marker — a stage's note to a human, a person's reply — are ignored entirely.

This is what makes re-entry work without reading transition history. A task routed back to `In Progress` a second time carries the first session's `start` *and* its `end`; the most recent marker is `end`, so the task is not in flight. A task whose session died carries a `start` with no `end` after it, and stays in flight until a human moves it — which is the specified behavior, not a leak.

*Why a marker rather than matching the prose:* the comment is written by a model and its wording will vary. Matching prose would make the pipeline's concurrency control depend on phrasing, which is the kind of thing that works for months and then does not.

*Why hidden rather than visible:* the marker is bookkeeping and the comment is for a person. It survives the API round trip verbatim, which is what the tick needs. **The design does not assume Linear hides it** — that was not verified. The prose stands on its own if the marker renders, so the worst case is a visible line of bookkeeping, not a broken comment.

*Alternative rejected:* the `delegate` field, a label, or a structured comment the dispatcher edits in place. All three make the tick write, and the tick writing is what this design gives up in order to be safe to run at any time, twice, and before anything consumes it. A field or a label also carries no ordering, so neither can express "started, then finished" — which is the whole of the in-flight test.

*Alternative rejected:* the announcement written by the dispatcher at dispatch time. It would close the one hole this leaves — a session that dies between being emitted and announcing itself is re-emitted next tick — at the cost of making the tick a writer. That hole is bounded by the concurrency cap and self-corrects; a writing tick is a permanent property. Chosen deliberately; see Risks.

### The report goes to stderr and run requests go to stdout

A tick prints one JSON object per line to stdout, one per run request, and writes its human report — every candidate considered, and for each, dispatched or the reason it was not — to stderr.

`jen run | executor` then works with no flag, and a person running it by hand sees the report without the run requests getting in the way of reading it. It also matches how `cli.ts` already splits the two: `io.err` carries what the run wants said, `io.out` carries the run's output.

*Alternative rejected:* a `--json` flag switching the whole output. It makes the useful mode the non-default one, and gives ENG-164 and a human two different commands to reason about.

### The status table is compiled in, and a test holds it against `AGENTS.md`

The status→skill→role mapping lives in a module in `cli/`. It restates the stage table in `AGENTS.md`, which makes it a second statement of the same fact and therefore something that will drift — the exact failure `payload.ts` exists to prevent for the payload.

It cannot be read from `AGENTS.md` at runtime: the tick does not read the filesystem, by requirement, and the scheduled runner does not even check out the repository. So the mitigation is a test that parses the stage table out of `AGENTS.md` and asserts the compiled table matches it, in the idiom `test/payload.test.ts` already uses for the scaffold's skill references. Drift then fails CI in this repository, which is where both statements live.

*Alternative rejected:* deriving the table from the workflow document at build time. It moves the coupling into the build, where a stale `dist/` produces a table that matches an older document — the same class of failure `stage-payload.js` already has to guard against, added for no gain over a test.

### Role resolution is a second column of the same table

`design-task` → `design`; `implement-task` → `dev`; `review-task`, `test-task`, `deliver-task` → `deliver`, per `pipeline-identity`. It sits beside the skill because it is the same lookup keyed by the same status, and because splitting it invites a caller to resolve one without the other.

The run request names the role; it never carries the role's credential. What turns a role name into a token is the session launcher's (ENG-164), which is what lets a run request be printed, piped, and logged without becoming a secret.

### Candidacy is an allow list, not a deny list

The tick treats a status as a candidate only if it is in the table. `Todo`, `Pending`, `Backlog`, `Done`, `Canceled`, and anything a team adds for its own reasons are all non-candidates by the same rule, rather than by being enumerated as exclusions.

A team will add statuses jen has never heard of, and the failure mode of a deny list there is dispatching a stage against a task in a status nobody intended — expensive, and confusing to diagnose.

### The concurrency cap counts what the poll already returned

In-flight is established per candidate from its own comments, so the count of runs in flight is a count over the candidate set the tick already fetched. No extra query, and the ceiling holds across runners because every runner derives it from the same tracker state.

This misses a run in flight against a task whose status has since left the pipeline — a session that moved the task to `Done` and is still finishing up. That is a session on its way out, not one about to start work, so counting it would only make the cap more conservative than intended.

The cap is a flag with a default of 3. It is a spend control more than a correctness control; correctness is the per-task rule, which has no cap in it.

## Risks / Trade-offs

**A session that dies between dispatch and its first comment is dispatched again** → Accepted, and named in the spec rather than mitigated. The window is the time from process start to the first tracker write — seconds against a session that runs for minutes. Each repeat costs one session start, and the concurrency cap bounds how many can be in that window at once. Closing it would require the tick to write, which is the property being protected.

**A stage that forgets its announcement is dispatched repeatedly** → The announcement is what makes a task in flight, so a stage that never writes one is re-dispatched every tick, each time doing real work. This is the one failure the design has no backstop for, having removed the failure counter. Mitigation is that the announcement is the *first* thing a session does, before any work, and that all six skills are edited in this change rather than left to adopt it independently.

**The tick reads every candidate's comments** → One query per candidate per tick, against a pipeline that will rarely have more than a handful of tasks in flight. If the candidate set grows large this becomes the tick's cost, and the fix is to fetch comments only for candidates that survive the status filter — which is already the case — and then only until the first marker is found. Not optimized further now; ENG-165 is where the poll's cost is actually measured.

**A hidden marker may render visibly in Linear's editor** → Unverified, deliberately not depended upon. The comment reads correctly either way. If it does render, the fallback is a visible one-line footer, which changes the marker's format and nothing about the design.

**`Pending` must exist before a tick can park anything** → It is an operator action on every project, jen's own included, and binding reports it as missing rather than creating it. A project that has not added it has stages that cannot park a blocked task, which is a worse failure than the tick refusing outright. The tick verifies `Pending` resolves on the team as part of its startup check and refuses the run if it does not — the same shape as a missing credential, and for the same reason.

## Open Questions

- **Where `jen watch` gets its interval and how it logs** are ENG-165's, and nothing here constrains them beyond the tick being safe to call repeatedly.
- **Whether the report should carry a stable machine-readable form too** — a person reads it today and ENG-165's operator surface may want to consume it. Deferrable: it is additive to stderr and changes no requirement here.
