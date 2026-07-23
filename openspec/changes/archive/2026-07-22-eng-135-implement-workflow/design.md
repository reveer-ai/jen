## Context

The repository states a workflow and supplies no one to run it. `AGENTS.md` names an artifact progression driven by task status; ENG-132 designed the mechanism around it — branch per task matching Linear's `gitBranchName`, a single PR, a Linear sync mapping, a review pass, and a merge that archives the change and closes the task. This change turns that design into skills that actually run.

Three constraints shaped how:

- **The actor is an agent with no session memory.** Everything a stage needs must be readable at the moment it starts — from the issue, the branch, the PR, or a file in the repo. Nothing carries over from the last run, so any state the pipeline depends on has to live somewhere durable or not exist.
- **Only the first stage has a user.** Design is a conversation. Everything after it is triggered by a status change that nobody is necessarily watching, which makes "ask the user" not a fallback but an unavailable operation.
- **Six skills are six chances to disagree.** Anything true of every stage has to be stated somewhere none of them owns, or the copies drift and the drift is silent.

## Goals / Non-Goals

**Goals:**

- Make moving a task the only trigger the pipeline needs.
- Give each stage a boundary stated in terms of what it does *not* own, so the seams are explicit.
- Keep specs and code reviewable together, in one place, for the life of a task.
- Let an unattended stage stop without stranding the work or waiting on anyone.

**Non-Goals:**

- Enforcement. Nothing validates that a stage ran, or that the status it left behind is the one the pipeline says it should have. The workflow is a convention the skills follow.
- Automation of the trigger itself. A status change starts a stage because a human or an agent invokes the skill; no webhook, watcher, or scheduler is built here.
- Re-implementing OpenSpec. The stages orchestrate the vendored `openspec-*` skills — `openspec-continue-change` writes artifacts, `openspec-apply-change` implements tasks, `openspec-archive-change` archives — and add only the task, git, and PR mechanics around them.
- Proving it works. ENG-138 runs a real task through end to end.

## Decisions

### The status is the trigger, and the status is also the state

A stage begins because the task reached its status, and ends by moving the task to the next one. There is no run record, no queue, and no field tracking pipeline position separately from the issue's own status.

*Why:* the task is already the source of truth, and a second place recording where a task is in its pipeline is a second place to be wrong. Statuses are also what a human already reads, so the pipeline's state is legible without any tool built to show it.

*What it costs:* the status is the only handle, so an interrupted run leaves a task sitting in the status it was already in, indistinguishable from one that never started. Every stage is therefore written to assume it may be resuming and to check what already exists before redoing it. That assumption is load-bearing and appears in each skill.

### The PR opens at design, not at implementation

ENG-132 put the PR at the `In Progress` → `In Review` transition, covering artifacts and code together. It opens at design instead, as a draft holding nothing but the OpenSpec artifacts, and stays open until delivery merges it.

*Why:* the artifacts are the part of a change most worth reviewing and the part that arrives first. Opening the PR at design makes them a diff for their entire life, gives every later stage somewhere to anchor a comment at the moment it has something to say, and means implementation lands on a PR that already exists rather than deciding when to create one. Draft status carries the same "not ready" signal ENG-132 was getting from the PR's absence, without the absence.

*What it costs:* a PR can sit open through a long design with nothing but markdown in it, and a task abandoned during design leaves a stale draft that nothing cleans up.

### Artifacts sync as file attachments, and the description stays the human's

ENG-132 mapped the proposal onto the issue description and the remaining artifacts onto sequential comments. Neither survived contact. Every finalized artifact uploads as a file attachment instead, titled with the artifact's name.

*Why:* the description holds the original ask — it is what the artifacts are answering, and overwriting it destroys the question. Comments are the running narrative of blockers and handoffs, and burying three long artifacts in that stream is where the narrative goes to die. An artifact is a file; attachments hold files, keep their formatting, and stay identifiable by name.

*The mechanism, and its sharp edge:* `prepare_attachment_upload` with the file's exact byte size, a PUT of the raw bytes to the signed URL replaying every returned header verbatim, then `create_attachment_from_upload` with the `assetUrl`. The URL expires in 60 seconds, so preparing several up front expires the early ones — the upload is strictly one artifact at a time. There is no update call, so revising a finalized artifact means deleting the stale attachment and uploading the replacement in the same run. Missing that step leaves two copies and no way to tell which shipped.

*Why it matters more than it looks:* the change is archived at delivery. After that the task is the durable record of what was designed, so a stale attachment is not untidiness — it is a false account of what shipped.

### Review is a stage, not a manual pass

ENG-132 scoped the PR review loop as a manually-triggered pass that reads unresolved comments and pushes fixes. That reading half became `review-task`, a full stage between implementation and testing; the fixing half became implement-task's first order of business on re-entry.

*Why:* a review nobody triggers is a review that does not happen, and the pipeline had no stage whose job was judging whether the code was worth merging. Splitting it also puts the two halves where they belong — the reviewer never edits code and never pushes, the implementer never grades its own work. `test-task` follows for what a diff cannot answer: whether the thing runs.

*What it costs:* two more statuses and two more handoffs on the way to `Done`, on a pipeline that already had four.

### Everything shared is stated once, in `AGENTS.md`

Naming, the single PR, artifact sync, commit format, thread etiquette, the non-blocking rule, and the churn budget live in a `Conventions` section. The skills are written assuming them and do not restate them.

*Why:* six copies of a rule are six things to edit and six chances to disagree, and the disagreement is invisible because each stage only reads its own file. `AGENTS.md` is already the document every agent is bound to read, so it costs nothing to put them there.

*What it costs:* a skill read in isolation is incomplete — it presumes conventions stated elsewhere. That is the deliberate trade, and it is why the skills are short.

### Naming derives from Linear's suggested branch name

The branch is the issue's `gitBranchName` verbatim; the OpenSpec change name is that string lowercased with any leading `<username>/` stripped.

*Why verbatim for the branch:* Linear's GitHub integration matches on exactly that string, and matching is what auto-links the branch and PR back to the issue. Any deviation silently costs the link.

*Why transformed for the change name:* OpenSpec requires lowercase, and a slash left in the name nests the change directory a level down — after which every `--change` lookup fails to find it. Both failures are quiet, which is why the transformation is written down rather than left to judgment.

### Unattended stages route instead of asking

Design confirms with the user before each artifact. Every stage after it treats "needs a human" as a routing decision: write the truth where it will be read — the issue, or a diff comment anchored to what it concerns — and stop.

*Why:* the alternative is a run that blocks on a reply nobody is waiting to give, holding a task in a status that claims work is happening. Stopping cleanly with the reason recorded is strictly better than hanging, and it is the only option that leaves the task honest.

*What it costs:* the vendored `openspec-*` skills are built to pause and ask. A stage delegating to them has to answer their prompts itself, which means each stage must decide in advance what its answers are. The skills state those answers rather than leaving them to the moment.

### One churn budget, shared by every stage

Before starting, a stage counts backward transitions in the issue's `stateHistory` — every move to a status earlier in the table than the one it was in. On the third, it comments with what sent the task back each round and what looks unresolvable, leaves the status alone, and does not start.

*Why one budget rather than one per stage:* a task can oscillate between any pair of stages, and per-stage counters each stay under their limit while the task goes around forever. The failure being guarded against is the pipeline not converging, which is a property of the whole pipeline.

*Why three:* one backward move is the pipeline working — that is what review and testing are for. Two is bad luck. Three is evidence that the thing sending it back cannot be fixed by sending it back again.

*Why leave the status alone:* moving it would erase the evidence of where the task actually stalled, and add another transition to the history that the next count would read as churn.

### `settings.json` is shared, `settings.local.json` is not

The tracked `.claude/settings.json` carries the permissions every install needs. `.claude/settings.local.json` is excluded and drops out of tracking.

*Why:* the local file holds MCP server ids, which differ from one install to the next and are meaningless in anyone else's clone — but the permissions the stages depend on are identical everywhere and should not have to be re-granted per install. Splitting them is the only way to share the half that is shareable.

## Risks / Trade-offs

- **A stage runs against a task in the wrong status.** Nothing checks, so a skill invoked out of order does its work anyway and moves the task from wherever it was. → Not mitigated. Each stage instead states its own preconditions loudly enough to notice — review and testing both stop on a PR that is missing or still a draft.
- **An interrupted run is indistinguishable from one that never began.** The status is the only state. → Every stage is written to assume it is resuming and to check for its own partial output before producing more.
- **A stale artifact attachment outlives the change.** There is no update call, so a revision that forgets to delete the old copy leaves two, and after archiving nothing in the repo contradicts the wrong one. → Stated as a convention with the reason attached, which is the strongest available lever; nothing verifies it.
- **The conventions and the skills drift apart.** The skills assume rules stated in `AGENTS.md`; nothing ties them together. → Accepted. The alternative is restating the rules in every skill, which is the drift this avoids.
- **The churn budget miscounts.** `stateHistory` records human moves alongside agent ones. A task reorganized by hand can look like a task that will not converge. → Accepted. The budget's failure mode is stopping a run that might have succeeded and asking a human to look, which is the cheap direction to be wrong in.
- **Six skills is a lot of surface for an unproven pipeline.** None of this has run end to end. → ENG-138 is the test, and the seams are the parts most likely to move.

## Open Questions

- Whether refinement belongs in the pipeline at all. `refine-epic` has no status of its own, produces tasks rather than advancing one, and is listed in the table with a dash where the trigger goes.
- What happens to a task abandoned mid-pipeline. Nothing closes the branch, the draft PR, or the change directory, and no stage is responsible for noticing.
- Whether a stage should be able to run against a task whose status it does not own, and whether refusing would help or only make partial recovery harder.
