## Context

See [proposal.md](./proposal.md) — Why. The constraints that shape the approach, verified rather than assumed:

- **The CLI has never made a network call.** `init` and `update` are filesystem-only by rule (ENG-160), and the package carries exactly one runtime dependency. `jen run` is the first command that talks to anything.
- **A hidden marker survives a Linear comment round trip verbatim.** Probed live during design: a comment body containing `<!-- jen:picked-up stage=design-task -->` comes back through `list_comments` byte-identical, HTML comment intact. Whether Linear's *editor* renders it invisibly was **not** verified and this design does not depend on it.
- **The tracker's diff surface is invisible to an application identity** (ENG-141, probed there). Nothing in the tick reads a diff, so this does not constrain it — but it is why the tick's only tracker reads are the issue surface.
- **The tracker's rate limits are not a constraint at this scale, and neither, it turns out, is its per-query complexity cap.** Linear documents a 10,000-point ceiling on any single query, a cost model of 0.1 per property and 1 per object, and a connection multiplying its children by its page size; a first design pass calculated the poll at roughly 1,050 points on that model and shaped the page sizes around it. A real tick has since been run, and **charged 7 points** for three issues each carrying a ten-comment connection. The documented model describes an upper bound, not the bill — the charge is consistent with counting rows returned rather than page size requested, though one sample does not establish that as the rule. What it does establish is that the cap is nowhere near binding and no page size needs reducing for cost.

  The hourly ceilings came back as **3,000,000 complexity and 2,500 requests**, not the documented 2,000,000 and 5,000. That is the personal-key tier — the run used a personal key, because that is the credential a person has to hand. The figures for the OAuth application identity the pipeline will actually run under remain unverified, and this design no longer rests on them: at two requests per tick, six ticks an hour, every published tier is irrelevant by three orders of magnitude. Exceeding a limit returns HTTP 400 with a `RATELIMITED` code, not a 429, which is why the client matches on the code rather than the status.
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

The tick needs two reads — the team's statuses, and the project's issues with their status, identifier, suggested branch name, and recent comments — and no writes. `@linear/sdk` brings a GraphQL client, a schema, and a generated document set to serve that, against a package whose entire dependency list today is one entry and whose tarball is asserted by test.

Node 20.19 is already the engine floor and has global `fetch`. Three hand-written queries against a documented, stable API is less code than the wiring the SDK would need, and it keeps the install cost of `jen run` at zero for adopters who never use it.

*Alternative rejected:* `@linear/sdk`. It earns its weight where an application makes many varied calls; this one makes three, forever, and the tick is deliberately the part that never grows.

*Not verified:* no raw query was run during design, because no tracker credential is available in a design session — the MCP server holds its own. The queries are written against the documented schema and are proved for the first time by task 5.5, which runs the tick against jen's own project by hand.

*Consequence accepted:* schema drift is ours to notice. The queries request named fields, so a removed field fails loudly at the tick rather than silently producing an empty candidate set — which is the failure mode that matters, since an empty set is indistinguishable from "no work" and would look like a healthy quiet pipeline.

### A session's announcement is a hidden marker inside a comment written for a human

A stage opens its session by commenting on the task. The comment is prose — what stage this is, that it has picked the task up — and carries a machine-readable marker the tick matches:

```
<!-- jen:run stage=design-task event=start -->
```

and its closing counterpart, `event=end`, in the comment every session already ends with.

The tick's in-flight test is then: **find the most recent comment carrying a `jen:run` marker; the task is in flight if that marker is `event=start`.** Nothing else about the comment is parsed, and comments without a marker — a stage's note to a human, a person's reply — are ignored entirely.

*The test does not filter by author*, and an earlier draft of this design said it did. Establishing the author would mean knowing which identity the tick is reading as, and the tick receives a team and a project and nothing else — so it would cost a third query for a `viewer` id on every tick, permanently, to defend against a person hand-pasting an HTML comment into a task. The marker is bookkeeping in a comment written for a human; someone who reproduces it exactly has, for practical purposes, announced a session. Not filtering is the decision, stated here so the spec and the code agree with it.

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

### A candidate must also be a task, and the `task` label is what says so

Status alone was the whole of candidacy in the first design pass, and the first live tick showed what that misses: of three issues dispatched, two were epics. ENG-136 and ENG-133 sit in stage statuses as a matter of course, because their children are moving through the pipeline and the epic's status reflects that. An epic has no design, no OpenSpec change, and no PR, so `implement-task` dispatched against one spends a full session discovering there is nothing to implement — and, since a session's first act is now to announce itself, marks the epic in flight while it does.

The fix is the same allow list applied one level up: an issue is a candidate only if it carries `task`. Requiring the label rather than excluding `epic` is the same argument the statuses already make — the set of things that are not tasks is open-ended and a deny list has to enumerate it, while the set of things that are is exactly one label that refinement applies and binding guarantees exists.

That guarantee was thinner than it looked. `refine-epic`'s prose said it labelled its output, and `project-binding` required the label to *exist* on the team — but no capability required a task to *carry* it, so the dispatcher would have been depending on a convention stated only in a skill's instructions. `task-pipeline`'s refinement requirement now states it, which is what makes this dependency real rather than borrowed.

**An issue carrying neither label never dispatches.** That is a real behaviour change for a human-created issue moved straight into `In Design`, and it is the right one — such an issue has not been refined, has no estimate, and usually has no parent. Under the old rule it would have been picked up and worked; under this one it waits for someone to refine it or label it.

*Where the check lives is a separate decision from what it says.* The label is **not** in the poll's server-side filter, though that would be free. Filtering server-side means the issue is never fetched, so it cannot appear in the report — and the whole point of the report is that running the tick answers what the pipeline would do right now. A person who moves an issue into `In Design` and sees nothing happen needs somewhere to find out why, and "not a task" is exactly the answer they need. Fetching a handful of epics per tick costs, against a measured 7-point poll, nothing worth naming.

### The poll is one query, with comments nested under the issues

Comments come back inside the issues query rather than through a request per candidate. The tick is therefore two requests total — the statuses check at startup and the poll — regardless of how many tasks are in the pipeline.

Both page sizes are bounded explicitly rather than left to the default 50 — the default applied at two levels is what a calculated budget put near the cap. A measured tick then charged 7 points for the whole poll, so the bound is no longer there for cost; it is there because an unbounded nested connection is the kind of thing that is fine until a task has four hundred comments.

**Comments are read newest-first, and the tick establishes that rather than assuming it.** The in-flight test only ever looks at the most recent marked comment, so a bounded page is only sound if it is the *newest* page. Linear documents `orderBy: createdAt` as descending and the client requests it explicitly — but no raw query proved it during design, and the consequence of being wrong is not a degraded result, it is a task whose every marker sits behind the bound, reading as never announced and re-dispatching forever.

So the page is made to carry its own evidence: the client compares the first and last `createdAt` in what came back. Descending, and a full page is the newest — done, at no cost. Ascending, and a full page is the *oldest*, so the tick pages that issue's comments through to the newest before testing it. The same fallback covers the case it was originally written for, a page of markerless comments. This is a comparison, not a judgment, so it costs the dispatch path none of its predictability, and it costs a request only where the assumption is actually violated.

*Alternative rejected:* verifying the ordering once against the live API and continuing to assume it. It settles the question for one identity at one moment, and re-opens it silently — the failure it guards against produces no error, just a task that gets picked up again and again.

*Alternative rejected:* a request per candidate for comments. It is simpler to write and it makes the tick's cost scale with the pipeline's width, which is the opposite of what a poll that runs unattended forever should do.

### The concurrency cap counts what the poll already returned

In-flight is established per candidate from its own comments, so the count of runs in flight is a count over the candidate set the tick already fetched. No extra query, and the ceiling holds across runners because every runner derives it from the same tracker state.

This misses a run in flight against a task whose status has since left the pipeline — a session that moved the task to `Done` and is still finishing up. That is a session on its way out, not one about to start work, so counting it would only make the cap more conservative than intended.

The cap is a flag with a default of 3. It is a spend control more than a correctness control; correctness is the per-task rule, which has no cap in it.

## Risks / Trade-offs

**A session that dies between dispatch and its first comment is dispatched again** → Accepted, and named in the spec rather than mitigated. The window is the time from process start to the first tracker write — seconds against a session that runs for minutes. Each repeat costs one session start, and the concurrency cap bounds how many can be in that window at once. Closing it would require the tick to write, which is the property being protected.

**A stage that forgets its announcement is dispatched repeatedly** → The announcement is what makes a task in flight, so a stage that never writes one is re-dispatched every tick, each time doing real work. This is the one failure the design has no backstop for, having removed the failure counter. Mitigation is that the announcement is the *first* thing a session does, before any work, and that all six skills are edited in this change rather than left to adopt it independently.

**A task with a long discussion since its last session costs an extra request** → The nested comment page is bounded, so a task carrying more recent comments than the page holds needs a follow-up read to find its marker. Bounded to that one issue and rare in practice. The alternative — a larger nested page — costs complexity on every tick against every issue to serve a case that affects one.

**The comment connection's ordering is still unproven** → Retired as a risk rather than accepted: the tick reads the direction off each page instead of trusting it, so being wrong costs a request rather than correctness. What remains is narrower — the detection needs at least two comments in a page to compare, and a page of one is trivially both orders. A single-comment page is also, necessarily, the whole record, so there is nothing behind a bound to miss.

**An issue is mislabelled or unlabelled and quietly never runs** → The cost of moving the label into candidacy. An issue nobody labelled `task` now sits in `In Design` forever with no session against it. Mitigated by the report naming it every tick rather than passing over it in silence, which is the reason the check is a gate and not a filter; not mitigated further, because the alternative is guessing what an unlabelled issue was meant to be.

**A hidden marker may render visibly in Linear's editor** → Unverified, deliberately not depended upon. The comment reads correctly either way. If it does render, the fallback is a visible one-line footer, which changes the marker's format and nothing about the design.

**`Pending` must exist before a tick can park anything** → It is an operator action on every project, jen's own included, and binding reports it as missing rather than creating it. A project that has not added it has stages that cannot park a blocked task, which is a worse failure than the tick refusing outright. The tick verifies `Pending` resolves on the team as part of its startup check and refuses the run if it does not — the same shape as a missing credential, and for the same reason.

## Open Questions

- **Where `jen watch` gets its interval and how it logs** are ENG-165's, and nothing here constrains them beyond the tick being safe to call repeatedly.
- **Whether the report should carry a stable machine-readable form too** — a person reads it today and ENG-165's operator surface may want to consume it. Deferrable: it is additive to stderr and changes no requirement here.
