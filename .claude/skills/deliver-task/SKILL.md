---
name: deliver-task
description: Finish a tested task — merge its PR, archive and sync the OpenSpec change, capture anything worth persisting in project docs, and close it out. Use when a task moves into delivery, or to continue delivery on one already there.
category: Workflow
tags: [workflow, linear, openspec, git]
---

You are the delivery agent, and the only stage that touches `main`. Design, implementation, review, and testing are all settled by the time you pick up — your job is wrap-up, not re-litigation.

**You own** closing the task out completely:

- **Syncing the OpenSpec specs and archiving the change.**
- **A backstop pass for anything uncaptured.** Implementation and testing write their notes as they go, so this isn't your main job — but you're the only stage that sees the whole record at once. Skim the artifacts, the diff, and the PR threads for a convention or gotcha that never made it into an AGENTS.md, and write it down if you find one. Most runs you won't, and manufacturing an entry is worse than leaving it.
- **Merging the PR and closing the task out.**
- **Rolling the epic up.** The task you're closing may be its parent epic's last one. If it has a `parentId`, list the epic's children and check them — every one `Done` or canceled means the epic is finished too, so move it to `Done` and comment on it with what shipped. Anything still open, leave it alone. No parent, nothing to do.

Everything you write rides in the task's existing PR — not a separate one, and not a separate review cycle.

**Assume you're resuming.** This stage can be re-entered after a partial run, so check what's already done before redoing it.

**Validate before archiving**: `openspec validate <name> --strict`. Archiving checks artifact and task completeness for you (below), but nothing checks validity, and a change that doesn't validate shouldn't be archived.

**Archiving is `openspec-archive-change`'s job, not yours to hand-roll.** It already verifies artifact completion, counts `tasks.md` checkboxes, works out which delta specs are genuinely unapplied before syncing, and refuses to overwrite an existing archive target — against the real resolved paths, not assumed ones. What it doesn't have is a user to answer its prompts, so decide them yourself:

- **Incomplete artifacts or unchecked tasks** — don't confirm through. Something is wrong this late in the pipeline: comment on the issue explaining what's incomplete, and stop.
- **The sync prompt** — take its recommendation. It has already compared the deltas against the main specs and knows what's applied; syncing applied deltas is prose editing over itself and corrupts them.
- **An archive target that already exists** — a collision, not something to retry around. Comment on the issue and stop.

**Merging**: resolve mechanical conflicts yourself by pulling `main` into the branch. If a conflict needs a real implementation decision, or checks still fail after resolving, that's a blocker — comment on the issue, move it back to `In Progress`, and stop.

**Done when** the PR is merged, the branch is deleted, the issue is `Done`, and its epic is rolled up if this closed the last of them.
