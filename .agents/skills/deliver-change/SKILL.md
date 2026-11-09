---
name: deliver-change
description: Ready a verified change for review, then close it out once approved. Brief the reviewer, bring the record and docs in line, then archive and merge. Use when a change's implementation is done and verified, and again once its pull request is approved.
---

# Deliver a change

Delivery happens twice. Before review, it makes the change understandable and leaves the project's record and docs true. After approval, it closes the change out.

## When the implementation is verified

1. **The record.** Read the record's index and update what this change made true or false: decisions and their reasons, conventions the maintainer set during the work, and new environment facts or quirks. Write only what the code, specs, pull request and issue tracker don't already say. Link to those instead.
2. **The docs.** Find every docs view that describes what the change touched, using the paths in its `<meta name="describes">`. Update each one, or confirm it still holds and bump its `<meta name="checked">` date. If a new component or interaction has no view to explain it, say so in the briefing.
3. **The briefing**, in the pull request's description. It's for someone who didn't write the code but will have to understand it and change it next. Keep it short:
   - **The model**: how the system works differently now, in a few sentences, as you'd explain it at a whiteboard. Not a list of files.
   - **Reading order**: the files that carry the change, and where to start in each.
   - **Subtleties**: what a careful reader could still get wrong, and the alternatives that were rejected.
   - **Verification**: which checks passed, which didn't run, and what those could still find.
   - **Friction**: anything done by hand that repeated earlier work, or that took longer than it should have. `tend` reads these to find skills worth writing. Leave it out if there was none.
4. Commit and push it all with the change, and mark the pull request ready for review as the project's conventions say.

## Once approved

1. Run the project's close-out. With OpenSpec, archive the change and sync its specs (the `openspec-archive-change` skill).
2. Record the work as done in the record's status, as one line linking the pull request.
3. Merge as the project's conventions say. If the issue tracker doesn't close the issue on merge, close it.
