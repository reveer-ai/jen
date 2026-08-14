## 1. The shared conventions

Root `AGENTS.md` comes first: every skill defers to it, and the cuts in section 2 depend on these being in place to defer to.

- [ ] 1.1 Change the stages table so `design-task` hands off to nothing — the task stays at `In Design` and the user promotes — leaving every other row as it is.
- [ ] 1.2 Rewrite the paragraph below the table: `Todo` → `In Design` and `In Design` → `In Progress` are both the user's, and the pipeline drives itself from `In Progress` onward.
- [ ] 1.3 Rewrite the attendedness sentence: design confirms before each artifact when it can, writes the set and lets the draft PR carry the confirmation when it cannot, and no stage waits on a reply.
- [ ] 1.4 Remove the **Churn is budgeted** convention entirely.
- [ ] 1.5 Add a **Read the record** convention: read the task's status history, comments, and PR threads before acting — context for resuming, for work routed back, and for a task that is circling, but never a reason to refuse the work.
- [ ] 1.6 Add a **Resume, don't restart** convention: assume you may be resuming; treat any completion marker as a claim and check it against the commits, the PR, and the threads; where they disagree the evidence wins. Say why — a run is a fresh checkout, discarded at the end, so uncommitted work does not survive the session that made it.
- [ ] 1.7 Add a **Comment at the end of every session** convention: what the stage did, what it decided, where it stopped and why, what the next stage picks up. Never finish silently, including when nothing went wrong.
- [ ] 1.8 Re-read the conventions list as a whole for ordering and duplication now that three have been added and one removed.

## 2. The stage skills

Each skill keeps only what that stage alone needs to be told. Before cutting a line, check whether `AGENTS.md` now carries it — that is the test, not length.

- [ ] 2.1 `test-task`: remove every mention of staging, deploy routines, and live environments. What remains is running the full suite, the integration and e2e checks the project defines beyond unit scope, and the spec's scenarios worth confirming end to end.
- [ ] 2.2 `test-task`: cut the paragraph on writing down what it learned — it is the shared notes convention with staging examples attached. Keep only what is specific to this stage: its notes land after review has already passed.
- [ ] 2.3 `test-task`: rewrite the three endings without the staging premise, and add what a killed run can leave behind.
- [ ] 2.4 `design-task`: state the two modes — confirm before each artifact when confirmation is available, otherwise write the set and let the draft PR carry it — and that which one applies is discovered from whether asking works, not read from a flag or an environment variable.
- [ ] 2.5 `design-task`: change **Done when** so the stage stops at `In Design` and does not move the issue. Say that promotion is the user's, and that the end-of-session comment is what distinguishes a finished design from an interrupted one.
- [ ] 2.6 `design-task`: name what a killed run leaves behind — a partial artifact set, an artifact written but not committed, a PR that may or may not be open — and that the last artifact is read before its completion status is trusted.
- [ ] 2.7 `implement-task`: name its own hazard — a checked box in `tasks.md` with no commit behind it is work to redo, not work to skip — and fold the existing `isComplete` warning into it as the same rule rather than a separate curiosity.
- [ ] 2.8 `review-task`: name its own hazard — diff comments saved but never submitted. Read the existing threads before commenting, so a re-entered run submits the pass it already wrote instead of duplicating it.
- [ ] 2.9 `deliver-task`: cut **Assume you're resuming** now that it is shared, keeping only what is specific to delivery — a partial archive, a sync already applied, a merge already made.
- [ ] 2.10 `refine-epic`: name its own hazard — issues created by a run that died before finishing. Check the epic's existing children before creating more.
- [ ] 2.11 Remove the churn-counting instruction from every skill that carries one.
- [ ] 2.12 Read all seven skills end to end in one pass, checking that none restates a convention `AGENTS.md` now carries and that each still reads as instructions to one stage.

## 3. Permissions

- [ ] 3.1 Add jen's own check commands to `.claude/settings.json` so its stages can run typecheck, lint, build, and the test suite unattended.
- [ ] 3.2 Add the same shape to `scaffold/settings.json`, so a new install starts with the workflow's own tooling permitted and an obvious place for the project's commands.
- [ ] 3.3 Confirm the tests that read `.claude/settings.json` and the scaffold still pass, since the fixture supplies its own and the assertions are about paths rather than contents.

## 4. The adopter's documentation

- [ ] 4.1 Add a section to `README.md` stating which permissions the pipeline needs, that jen writes the ones common to every project, and that the project's own typecheck, lint, build, and test commands are the adopter's to add.
- [ ] 4.2 State what fails without them — the stages that run those checks cannot complete an unattended run — and that an existing install has to be edited by hand, since the assistant settings are written once and never rewritten.

## 5. Verification

- [ ] 5.1 Run `openspec validate eng-166-harden-the-six-stages-for-unattended-runs --strict`.
- [ ] 5.2 Run the project's checks and the full test suite.
- [ ] 5.3 Re-read each spec delta against what was actually written, particularly the three requirements removed from `task-pipeline`, and confirm nothing still refers to what they said.
- [ ] 5.4 Add a changeset describing the change for the release notes.
