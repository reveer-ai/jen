## 1. Workflow document

- [x] 1.1 Add a `Stages` section to `AGENTS.md`: a table mapping each status to the skill it triggers, the work that stage does, and where it hands off — `refine-epic`, `design-task`, `implement-task`, `review-task`, `test-task`, `deliver-task`
- [x] 1.2 State in the same section that `Backlog` holds unrefined placeholders, `Todo` holds refined tasks, and that promoting a task from `Todo` into `In Design` is the user's call and belongs to no stage
- [x] 1.3 State that design is attended and every stage after it runs unattended, routing what needs a human to the issue or the PR rather than waiting
- [x] 1.4 Add a `Conventions` section holding the rules shared by every stage: input, naming, one PR per task, artifact sync, the description being the humans', commits, threads, notes, non-blocking, and the churn budget
- [x] 1.5 Reword the artifact progression: one branch and one PR per task, opened at design and merged at delivery, replacing ENG-131's "merging that PR is what advances the task"
- [x] 1.6 Update the `src/` line in `Resources` to describe it as the project's own sources rather than live checkouts

## 2. Stage skills

- [x] 2.1 Write `.claude/skills/refine-epic/SKILL.md`: the scoping conversation, epic and sub-issue shape, everything landing in `Todo`, and the distinction between logging an idea and refining one
- [x] 2.2 Write `.claude/skills/design-task/SKILL.md`: artifacts one at a time with confirmation, the branch, the draft PR opened once the first artifact lands, and `openspec validate --strict` before handing off to `In Progress`
- [x] 2.3 Write `.claude/skills/implement-task/SKILL.md`: unresolved threads before remaining tasks, project checks and unit tests before handoff, the PR marked ready for review, and stopping as a routing decision rather than a pause
- [x] 2.4 Write `.claude/skills/review-task/SKILL.md`: the diff read against the change's own artifacts, comments anchored to file and hunk, no edits and no pushes, and a verdict that routes to `In Testing` or back to `In Progress`
- [x] 2.5 Write `.claude/skills/test-task/SKILL.md`: exercising the change for real against the project's documented staging routine, and the three ways it ends — mechanically broken, needs a human, clean
- [x] 2.6 Write `.claude/skills/deliver-task/SKILL.md`: validate, archive through `openspec-archive-change` with its prompts answered in advance, merge the PR, close the task, roll the epic up
- [x] 2.7 Check each skill states what it does *not* own, so the seams between stages are explicit rather than inferred
- [x] 2.8 Check no skill restates a convention from `AGENTS.md`

## 3. Assistant configuration

- [x] 3.1 Add `.claude/settings.json` with the permissions every install needs
- [x] 3.2 Exclude `/.claude/settings.local.json` in `.gitignore` and drop it from tracking
- [x] 3.3 Confirm the shared file survives a fresh clone and the local one does not

## 4. Handoff

- [x] 4.1 Confirm the pipeline is walkable on paper: every stage's handoff status is another stage's trigger, and `Done` is reachable from `In Design` with no gap
- [x] 4.2 Record any convention or gotcha this change established beside the code it applies to, not in the root `AGENTS.md` — nothing cleared the bar, since the change is the workflow document itself
