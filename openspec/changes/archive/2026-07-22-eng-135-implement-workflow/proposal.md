## Why

ENG-131 wrote the workflow down — the task as source of truth, the project as a fork, OpenSpec's artifact progression driving the work. What it did not write down is who does any of it. The progression names stages and names no actor for them, so a change still advances because a person decided it should and remembered how the last one went. Nothing about that is forkable, and nothing about it runs while nobody is watching.

ENG-132 designed the mechanism to close that gap. This change builds it: one skill per stage, each triggered by the task reaching that stage's status. Moving a task is what starts the work, so the pipeline is driven by the same artifact that was already the source of truth, rather than by a second control surface invented to sit beside it.

The stages also need to agree on things no single stage owns — what a branch is called, where an artifact goes, what a commit message looks like, when a thread may be resolved. Stating those six times is how six copies drift. They are stated once, in `AGENTS.md`, and every skill is written assuming them.

## What Changes

- **Six stage skills** land in `.claude/skills/`: `refine-epic`, `design-task`, `implement-task`, `review-task`, `test-task`, `deliver-task`. Each is scoped by what it owns and what it explicitly does not, so the seams between them are stated rather than inferred.
- **`AGENTS.md` gains a `Stages` table** mapping each Linear status to the skill it triggers, the work that stage does, and where it hands off. The table is the pipeline's definition; the skills are its implementations.
- **`AGENTS.md` gains a `Conventions` section** holding the rules shared by every stage — input, naming, one PR per task, artifact sync, whose text the issue's description is, commits, threads, notes, non-blocking, and the churn budget. Stated once so no skill restates them.
- **The PR opens during design, not at implementation.** ENG-132 put it at the `In Progress` → `In Review` transition. Opening it at design instead means the artifacts are reviewable as a diff for their whole life, and implementation lands on a PR that already exists rather than creating one. Merging it is the pipeline's last act, and what closes the task out.
- **Artifacts sync to the task as file attachments**, not into the description and comments as ENG-132 specified. The description holds the original ask and stays the human's; comments carry the running narrative. An artifact is a file, and Linear can hold files.
- **The artifact progression is decoupled from the PR.** ENG-131 stated that merging a stage's PR is what advances the task. With one PR per task that is no longer true: a stage advances the task by moving its status, and only delivery merges.
- **Design is attended and every stage after it is not.** Design confirms with the user before each artifact. The rest run with nobody there, so what needs a human is written to the issue or the PR and the run stops cleanly, never waiting on a reply.
- **Backward routing is budgeted across the whole pipeline.** Any stage can send a task back. Once is the pipeline working; a third backward move means it is not converging, and the run stops rather than spending another round on it. One budget shared by all stages, counted from the issue's own `stateHistory`.
- **`.claude/settings.json` is added and tracked**, carrying the permissions every install needs, while `.claude/settings.local.json` becomes per-install and is excluded — its MCP server ids differ from one install to the next and are meaningless in a fork.

## Capabilities

### New Capabilities

- `task-pipeline`: the pipeline itself — the ordered stages, the status that triggers each, how a stage hands off, which stages run attended, and the budget that governs backward routing.
- `stage-conventions`: the rules every stage obeys and none of them owns — how a branch and change are named, the single PR that carries a task, how a finalized artifact reaches the task, what belongs in the description versus a comment, commit format, thread etiquette, and where a stage records what it learned.

### Modified Capabilities

- `agent-instructions`: `AGENTS.md` gains the stages and the shared conventions, and the rule that it is the only place they are stated. Its exclusivity is narrowed at the same time — a nested `AGENTS.md` at or below `src/` holds project notes, which are not the workflow and were previously unaddressed.
- `repo-scaffold`: assistant configuration splits into a tracked shared file and an excluded per-install one.

## Impact

- **Added**: six `.claude/skills/*/SKILL.md`, `.claude/settings.json`.
- **Modified**: `AGENTS.md` (new `Stages` and `Conventions` sections; artifact progression reworded away from PR-per-stage), `.gitignore` (excludes `/.claude/settings.local.json`).
- **Removed**: `.claude/settings.local.json` from tracking. Anyone with a working copy keeps their own; it is no longer shared.
- **Dependencies**: Linear's MCP tools for everything the stages read and write on the task, and `gh` for the one thing they cannot do — Linear can read, comment on, review, and merge a PR, but not create one, so opening it is `gh pr create --draft`.
- **Downstream**: ENG-138 runs a task through all six stages end to end, which is the first real evidence any of this holds. Until then the pipeline is specified and unproven.
- **Known limitation**: nothing enforces the pipeline. A status can be moved by hand with no stage running, a stage can be invoked against a task in the wrong status, and neither is detected. The workflow is a convention the skills follow, not a state machine that constrains them.
- **Known limitation**: the churn budget is counted from `stateHistory`, which records every transition including ones a human made for reasons unrelated to churn. A task shuffled by hand can exhaust its budget without an agent ever having failed to converge.
