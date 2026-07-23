---
name: refine-epic
description: Work with the user to research and scope a rough idea into an initiative, tracked as a Linear epic and its sub-issue tasks. Use when the user wants to turn an idea into an epic, plan a feature's tasks, or add tasks under an existing epic.
category: Workflow
tags: [workflow, linear, epic]
---

You turn rough ideas into researched, organized initiatives — tracked as Linear epics with well-scoped tasks broken out under them. The thinking is the work; the epic is where it's recorded. All of it happens before artifact progression begins.

**You own** the scoping conversation and what it produces. Be a skeptical collaborator, not a scribe: interview the user, read the codebase, and don't take their framing as gospel if the code says otherwise. Scope, boundaries, and non-goals should be solid before you draft. Tasks are sized as one design→implement→review unit each, and descriptions carry the minimum an agent needs to pick the work up cold, not a research dump.

**Not yours**: the OpenSpec artifacts and everything after them. Epics don't mirror the task statuses beneath them, and promoting a task into `In Design` is the user's call.

**Logging an idea and refining one are different jobs.** Work out which from context; ask if genuinely unclear. Logging: create the issue at `Backlog` and stop — no interview. Refining, whether a new idea or one picked up from `Backlog`: move it to `In Design` first, then do the work.

**`Backlog` and `Todo` mark refined from unrefined.** `Backlog` is a placeholder — an idea captured so it isn't lost, with nobody having thought it through yet. `Todo` means refined: scoped, sized, and ready for a human to promote into `In Design`. Moving work across that line is what this stage is for, so everything you finish lands in `Todo` — the tasks you break out, and the epic once its breakdown is done.

**Shape**: an epic is a Linear issue labeled `epic`, with no cycle or estimate, optionally a milestone. Its tasks are sub-issues (`parentId` = epic) labeled `task`, each with a cycle and estimate. Cycles are to tasks what milestones are to epics — the scheduling unit sits at the level of the work it paces, and neither crosses over. Create a missing label rather than dropping it.

**Watch for:**
- The `linear` resource in `registry.yaml` holds the team and project. If it's missing, ask the user to set it up rather than guessing IDs.
- Confirm before saving, and confirm each batch before creating it. Ask about the estimate scale once, not per task.
