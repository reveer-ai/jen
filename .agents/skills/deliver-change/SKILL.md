---
name: deliver-change
description: Hand a finished change to the maintainer, then close it out once approved. Use when the agent review of a change has nothing left to find, and again once its pull request is approved.
---

# Deliver a change

Delivery has two moments. The handoff comes once the change is built and its agent review has settled: it leaves the record and docs true and briefs the maintainer, whose review starts there. The close-out comes once the maintainer approves.

## Handoff

Run it once `review-change` finds nothing new. If the maintainer asks for changes, make them, let the agent review settle again, and run the handoff again.

1. **The record.** Read the record's index and update what this change made true or false: decisions and their reasons, conventions the maintainer set during the work, and new environment facts or quirks. Write only what the code, specs, pull request and issue tracker don't already say. Link to those instead.
2. **The docs.** Find every docs view that describes what the change touched, using the paths in its `<meta name="describes">`. Update each one, or confirm it still holds and bump its `<meta name="checked">` date. If a new component or interaction has no view to explain it, say so in the briefing.
3. **The design.** If the change has a design document, make it describe what was built: where the implementation departed from it, and what it settled that the design left open.
4. **The briefing**, in the pull request's description. It's a short report for the maintainer, and for whoever changes this code next. Point to the design rather than repeating it:
   - **What was built**: only if there's no design document. Otherwise, the parts of the design that changed during implementation.
   - **Reading order**: the files that carry the change, and where to start in each.
   - **Review**: what the agent review found and how each finding was resolved, a line each, linking the reviews.
   - **Verification**: which checks passed, which didn't run, and what those could still find.
   - **Friction**: anything done by hand that repeated earlier work, or that took longer than it should have. `tend` reads these to find skills worth writing. Leave it out if there was none.
5. Commit and push it all, and mark the pull request ready for review. That's the signal it's the maintainer's turn.

## Close-out

Once the maintainer approves:

1. Run the project's close-out. With OpenSpec, archive the change and sync its specs (the `openspec-archive-change` skill).
2. Record the work as done in the record's status, as one line linking the pull request.
3. Merge as the project's conventions say. If the issue tracker doesn't close the issue on merge, close it.
