## Context

See proposal.md — Why. What shapes the approach:

- **The stages are prose.** Nothing in a skill is enforced by code. The only two forces acting on a run are the harness's permission mode and what the text tells the agent to do, so every decision here is a decision about what a skill says and what the harness allows.
- **A run is a fresh clone, discarded at the end** (ENG-164). Work that was never committed does not survive the session that made it. This is the single fact most of the resumption design follows from.
- **`dontAsk` denies `AskUserQuestion` outright, plus anything outside `permissions.allow` and the read-only set** (ENG-164). Denial is not a prompt the agent can wait out.
- **A killed run leaves the task's status untouched**, so the next poll picks it up again at the same stage. Re-entry is the normal case, not the exception.
- **`agent-instructions` already forbids a stage from restating a shared convention.** That requirement is the test for what comes out of each skill, so the cut needs no new rule to justify it.
- **Two files here are not editable in place after install.** Root `AGENTS.md` is replaced wholesale by `jen update`, and `.claude/settings.json` is written once and owned by the project from then on. Anything that has to reach an existing install reaches it through documentation.

## Goals / Non-Goals

**Goals:**

- Every stage survives being killed mid-run and resumes without redoing or corrupting completed work.
- No stage waits on a human, including design.
- Each skill says only what that stage alone needs to be told.
- The permission surface a stage needs is stated, and granted wherever it can be granted.

**Non-Goals:**

- The dispatcher's gates — churn ceiling, repeat-failure budget, leases (ENG-163).
- The invocation itself — flags, MCP config, permission mode on the command line (ENG-164).
- How a change reaches a live environment. Removed here, and owed its own task.
- The set of statuses, the stages, or the artifact order. Design's handoff changes; nothing else about the pipeline's shape does, and no status is added or removed.

## Decisions

### Attendedness is discovered, not configured

`design-task` states both paths and takes the unattended one when confirmation isn't available to it. The skill does not read a flag, an environment variable, or an invocation mode.

*Alternative considered:* the dispatcher sets `JEN_UNATTENDED=1` and the skill branches on it. Rejected — it creates a contract between ENG-164's invocation and this skill's prose with nothing keeping the two in sync, and it is wrong in exactly the cases that matter: a hand-run session in a shell that happens to export it, or a dispatched run where the variable didn't get through. Discovery is self-correcting because the signal *is* the condition — if the stage can confirm, there is someone to confirm with.

### Design ends at `In Design`, and the user promotes

Design does not advance the task when it finishes. It writes its artifacts, opens the draft PR, comments, and stops — leaving the task where it found it.

`In Progress` is what triggers implementation, and implementation is user-led. A stage that advances the task is a stage deciding the next stage should run, which is not design's decision to make while a human owns that call. This makes the promotion out of `In Design` the second user-owned transition, alongside `Todo` → `In Design`; the claim in `AGENTS.md` and `task-pipeline` that the latter is "the only transition none of them owns" is no longer true and is corrected here.

The review that per-artifact confirmation would have provided still happens on the draft PR, which is open from the first artifact. Feedback arriving while the task is parked re-enters design; feedback arriving after promotion is picked up by `implement-task`, whose order of work puts unresolved threads ahead of `tasks.md` and which routes back to `In Design` when a thread is a design problem rather than an implementation one.

*Alternative considered:* a `Design Complete` status that nothing polls, with the user promoting from there. Rejected — it buys the dispatcher an unambiguous level at the cost of a seventh status and a stage-table row that exists only to work around how the trigger is read.

### The trigger is the transition, not the status

Design ending without advancing breaks a requirement `task-pipeline` states today: that no stage needs a trigger beyond the status, and that the pipeline records a task's position nowhere but the status itself. A task parked at `In Design` is indistinguishable, by status alone, from one an agent is actively designing and one nothing has ever run against.

The fix is to read the trigger as the *edge* rather than the *level*, which is what `AGENTS.md` already describes — "moving a task to its next status is the trigger." A transition into a stage's status is unambiguous where residence in it is not.

The edge stays observable without abandoning polling. A tracker's status history carries each transition and its timestamp, so a dispatcher can poll and still trigger on edges by comparing a candidate's latest transition against what it has already dispatched. This matters for a reason outside this change: ENG-163's tick is a single poll-map-gate pass so that a scheduled CI job and a long-running local process share one code path, and a scheduled job cannot receive a webhook. Event semantics, poll transport.

Two things this is not:

- **Not the in-flight lease.** ENG-163 plans a lease with a TTL to stop a second session starting against a task a live run already holds. That answers concurrency; it does not answer parking, because the lease expires and the parked task looks actionable again.
- **Not this change's to build.** ENG-166 states the requirement and corrects the spec that contradicts it. Detecting the edge, and recording what has been dispatched, is ENG-163's.

What this change owes the dispatcher is the distinction being *observable*, which the end-of-session comment below provides: design is the one stage that deliberately ends without advancing, so for design a task resting at its own status is a valid terminal state, while for every other stage it means a run crashed or is still going.

### Evidence outranks bookkeeping

This is the general rule the per-stage resumption notes are instances of, and the reason they can be short.

Every marker that says work is finished — a `tasks.md` checkbox, `openspec status` reporting `isComplete`, a change directory that exists, an artifact file with content in it — records an *intent* that was true at some moment. A killed run can die between doing the work and recording it, or between recording it and committing it. Because the clone is discarded, the second case means the work is gone while the marker survives in whatever was already pushed.

So a re-entering stage checks the marker against the evidence: the commits on the branch, the state of the PR, the threads on it, the comments on the issue. Where they disagree, the evidence wins. A checked box with no commit behind it is work to redo, not work to skip.

`implement-task` already carries one instance of this — its warning that `isComplete: true` only means the artifact files exist. Generalizing it means that warning stops being a curiosity about one OpenSpec command and becomes the reason every stage can be re-entered safely.

### Reading the record replaces counting, and is context rather than a gate

Every stage begins by reading the task's record — its status trail, its comments, its PR and threads. That single act answers what the counting rule answered and more: whether this is a resumption, whether a later stage routed the work back and why, what a human has already said about it, and whether the task is circling.

It is explicitly not a gate. A stage does not stop because of what it reads there; the dispatcher owns stopping (ENG-163). Removing the ceiling from the skills while the dispatcher doesn't yet exist leaves a window with no enforcement — accepted, because an unenforced ceiling that six skills compute inconsistently is worth less than one mechanical gate, and a stage that reads the record can still say so on the issue when a task is obviously circling.

### Every session ends with a comment on the task

A stage comments on the issue at the end of every session, whatever the outcome — finished, stopped early, or blocked. Not only when it has a blocker or a handoff to report, which is what the existing convention asks for and which lets a stage finish silently.

The reason this is more than observability is that two earlier decisions depend on it.

It completes "evidence outranks bookkeeping." That rule tells a re-entering stage to trust commits over markers, but a run killed before it committed anything leaves no evidence at all — the task looks identical whether the last run did nothing, did work it never pushed, or was never dispatched. A terminating comment is the one artifact that distinguishes them: its presence says the run reached its own end and what it concluded, and its absence says the run died mid-work and every marker on the task is suspect.

It also carries the distinction that design's parking creates. A task resting at `In Design` is either a finished design awaiting promotion or a design run that died; a task resting at any other stage's status is either a live run or a dead one. Status cannot tell those apart and is not supposed to — the comment is where the difference is written down, for a re-entering stage and for whatever the dispatcher eventually reads.

That sets the bar for content. The comment carries what the stage did, what it decided, where it stopped and why, and what the next stage is picking up. A bare "done" satisfies the letter of the rule and is worth nothing as evidence.

*Trade-off accepted:* a task re-entered several times accumulates a long comment thread. That is the intended cost. Silence reads the same whether a stage succeeded, stopped, or died, and an unattended pipeline cannot afford an outcome that is indistinguishable from a crash.

### The cut is tested against `AGENTS.md`, not against length

A line comes out of a skill when the shared conventions already carry it. Applied to the six, that takes out: `test-task`'s account of writing down what it learns, which is the shared "notes as you work" convention with staging examples attached; `deliver-task`'s resumption paragraph, which becomes shared the moment every stage has one; and the churn instructions wherever they appear. What stays is what only that stage needs — its endings, its handoffs, the specific thing it can leave half-done.

The risk being managed is cutting something load-bearing because it reads as boilerplate. The test protects against that: if the convention isn't stated in `AGENTS.md`, it isn't shared, and it stays.

### The permission grant splits by what is stable

A stage told to run the project's checks must be permitted to run them, and the grant lands in two places because the two halves have different lifetimes:

- **Stable across installs** — `git`, `gh`, `openspec`, and the project's own check commands. These go in tracked `.claude/settings.json` for jen's own repository and in `scaffold/settings.json` for a new install. jen cannot know an adopter's commands, and the scaffold is write-once, so the adopter's documentation is what carries this to an existing install.
- **Per-install** — the tracker's MCP tools, which every stage writes through. Their names carry the connector id, which differs per install (`mcp__<connector-id>__save_issue`), so no shared, tracked rule can name them. The grant belongs with the invocation that also supplies the MCP config, which is ENG-164's.

This change states the requirement and does the first half. The second half is named as ENG-164's so it isn't discovered again as a surprise.

## Risks / Trade-offs

- **Testing has no live-environment story until staging gets its own task** → The stage was blocking on a missing routine rather than verifying anything with it, so what is lost is the block, not the coverage. The follow-up task is the mitigation and should be filed with this change.
- **The pipeline no longer runs unbroken from `In Design` to `Done`** → A human promotes out of design, so ENG-167's end-to-end proof covers `In Progress` onward with a person starting it. Deliberate: implementation is user-led for now, and this is what that means in practice rather than an oversight to work around.
- **A parked task and a crashed design run look alike until something reads the comment** → The comment is required of every session, so the evidence exists; consuming it is ENG-163's, and until that lands a task parked in design can be re-dispatched. Wasteful rather than harmful — a re-entering design run finds a complete artifact set and exits.
- **Discovery-based attendedness misfires** → The two failure directions aren't equal. Proceeding unattended when a human was present costs a review comment on a draft PR. Waiting when nobody is there costs the run. The skill states the unattended path as the one to take under any doubt.
- **No churn enforcement until ENG-163 lands** → Bounded by that task, and visible in the meantime because every stage now reads the history it would have counted.
- **Cutting something load-bearing** → The `AGENTS.md` test, applied per line rather than per paragraph.
- **Skills changing under ENG-133, which is mid-flight** → Nothing in the pipeline's shape moves; a session mid-stage stays valid, and one that re-reads a skill sees instructions that are strictly less likely to stall it.
