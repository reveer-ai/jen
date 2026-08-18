## Why

The stage skills claim to run unattended. Read against a session that actually has no human — no `AskUserQuestion`, nothing outside the allow rules, and a kill signal that can arrive mid-turn — several of them don't hold up.

`test-task` stops the pipeline over a missing staging routine, which is a setup gap rather than a defect in the change under test. `design-task` is written as an explicitly interactive stage and has no answer for a run with nobody to confirm with. Only `deliver-task` accounts for being re-entered, though every stage can be killed and picked up again on the next poll. Every stage is told to count backward transitions and enforce a churn ceiling — arithmetic that the dispatcher is about to own for real, and that reads the task's history for one narrow purpose while ignoring everything else it says. And the allow list the stages run under permits `git`, `gh`, and `openspec` but not the project's own typecheck, lint, build, or test commands, which is most of what implementation and testing are told to do.

Underneath all four, one pattern: the skills carry instructions that don't survive contact with an unattended run, and instructions that were never theirs to carry. This is the pass that makes the unattended claim true, before ENG-167 tries to prove it end to end.

## What Changes

- **Staging leaves `test-task` entirely.** The stage runs everything it can — the full suite, integration, e2e, and the spec's scenarios worth confirming end to end — and routes what only a human can judge. How a change reaches a live environment is a real question, and it gets its own task rather than a half-answer embedded in a stage that stops the pipeline when the answer is missing. ENG-140 stays closed; the question it deferred is deferred deliberately, not settled here.

- **Every stage becomes re-enterable.** Each skill states what a killed run can leave behind and what to check before producing more: design's partially written artifact set and possibly-open PR, implementation's drift between `tasks.md` checkboxes and what's actually committed, review's saved-but-unsubmitted diff comments, delivery's partial archive, refinement's already-created issues.

- **`design-task` becomes bimodal.** Attended, it confirms before each artifact as it does today. Unattended, it writes the artifact set and lets the draft PR carry the confirmation asynchronously — a human comments on the draft, the task re-enters `In Design`, and design resolves the threads. The stage already treats unresolved threads as normal re-entry; this makes the PR the review surface rather than inventing a second one.

- **Design stops advancing the task.** It finishes at `In Design` and leaves it there. `In Progress` is what triggers implementation, and implementation is user-led, so promoting out of design is a person's call — the second such transition, alongside `Todo` → `In Design`. Both `AGENTS.md` and the pipeline spec currently claim there is only one, and both are corrected.

- **The trigger is the transition, not the status.** A task parked at `In Design` is indistinguishable, by status alone, from one being actively designed and one nothing has run against — so the pipeline can no longer claim, as the spec does today, that a task's position is recorded nowhere but its status. The trigger is a move *into* a stage's status rather than residence in it. That stays pollable, since a tracker's status history carries every transition; building the detection is ENG-163's, and this change fixes the requirement that contradicts it.

- **The churn ceiling leaves the skills.** The instruction to count backward transitions and stop on the third is removed from `AGENTS.md` and from the pipeline spec. Enforcement belongs to the dispatcher (ENG-163), where it is a mechanical gate rather than something six skills are trusted to compute consistently.

- **Reading the task's record replaces it.** Every stage begins by reading the issue's history — its status trail, its comments, its PR — as context. That is what tells a stage whether it is resuming an interrupted run, picking up work a later stage routed back, or starting fresh, and it is what lets a stage notice a task that is circling. One act serving the judgment the counting rule was a poor proxy for.

- **Every session ends with a comment on the task.** Whatever the outcome — finished, stopped early, or blocked — the stage says so on the issue before it exits. The convention today asks for a comment when there is a blocker or a handoff to report, which lets a stage finish silently and makes a completed run indistinguishable from a crashed one. The comment is also what a re-entering stage reads to tell those apart.

- **Each skill is cut back to what only it can say.** `agent-instructions` already requires that a stage's instructions not restate a shared convention — six copies of a rule being six chances to disagree — and several of them do restate one. Removing staging and the churn ceiling exposes more: most of what `test-task` says about writing down what it learns is the shared "notes as you work" convention with staging examples attached, and `deliver-task`'s resumption paragraph becomes shared once every stage has one. This is compliance with a requirement already on the books, applied across all six.

- **The permission surface covers what the stages are told to do.** A stage instructed to run the project's checks must be permitted to run them. `scaffold/settings.json` seeds the shape, and the adopter's documentation states that the project's own check commands have to be added — the assistant settings are written once and owned by the project from then on, so documentation is what reaches an existing install.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `task-pipeline`: design's attendedness becomes conditional on whether a run has a user rather than absolute; the shared backward-routing budget stops being a rule stages enforce and becomes one the dispatcher enforces.
- `stage-conventions`: adds that a stage reads the task's record before acting, that a stage is resumable after an interrupted run, that every session ends with a comment on the task, and that a stage's permitted command set covers what its instructions tell it to run.
- `adoption-docs`: adds that the documentation states which permissions the adopter must grant for the pipeline's stages to run unattended.

## Impact

- **The six stage skills** — `.claude/skills/{design,implement,review,test,deliver}-task/SKILL.md` and `refine-epic/SKILL.md`. `test-task` changes most; every one of them gets shorter.
- **Root `AGENTS.md`** — the stages table's note on attendedness, and the conventions list, where the churn bullet is replaced.
- **`scaffold/settings.json`** and **`.claude/settings.json`** — the allow list.
- **`README.md`** — the adopter-facing statement of what to permit.
- **Testing loses its live-environment story until staging gets its own task.** That is a real reduction in what the pipeline verifies, taken deliberately: a stage that halts on a missing setup routine was not delivering that verification either, it was blocking on it.
- **Work already in flight.** These are shipped skills the manual workflow depends on, and ENG-133 is still running against them. One handoff moves — design's — and no status is added or removed, so a session mid-stage stays valid; a session that re-reads a skill mid-task sees the new instructions, which is the intended behavior. A task sitting in `In Design` when this lands is simply one whose promotion is now expected of a person.
- **ENG-163** inherits the churn ceiling as its own scope, and is the reason removing it here leaves no permanent gap.
