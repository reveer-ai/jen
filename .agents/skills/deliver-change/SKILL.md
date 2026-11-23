---
name: deliver-change
description: Hand a finished change to the maintainer, then close it out once approved. Use as flo-review's handoff, once its review of a change has settled, and again once its pull request is approved.
---

# Deliver a change

Delivery has two moments. The handoff comes once the change is built and its agent review has settled: it leaves the project record and docs true and briefs the maintainer, whose review starts there. The close-out comes once the maintainer approves.

## Handoff

Run it as `flo-review`'s handoff. If the maintainer asks for changes, make them, run `flo-review` again, and run the handoff again.

1. **The project record.** Make sure it reflects this change, following its own rules for keeping it. In particular, check that decisions recorded during design still hold now that it's built.
2. **The docs.** Find every docs view that describes what the change touched, using the paths in its `<meta name="describes">`. Update each one, or confirm it still holds and bump its `<meta name="checked">` date. If a new component or interaction has no view to explain it, say so in the briefing.
3. **The design.** If the change has a design document, make it describe what was built: where the implementation departed from it, and what it settled that the design left open.
4. **The briefing**, in the pull request's description. It's a short report for the maintainer, and for whoever changes this code next. Point to the design rather than repeating it:
   - **What was built**: only if there's no design document. Otherwise, the parts of the design that changed during implementation.
   - **Reading order**: the files that carry the change, and where to start in each.
   - **Review**: a line on what the agent review caught, and anything declined.
   - **Verification**: which checks passed, which didn't run, and what those could still find.
   - **Evaluation**: the comparison's report from `evals/`, quoted as `npm run eval -- report` prints it, or the reason the change has none.
   - **Friction**: anything done by hand that repeated earlier work, or that took longer than it should have. `tend` reads these to find skills worth writing. Leave it out if there was none.
5. Commit and push it all, and mark the pull request ready for review. That's the signal it's the maintainer's turn.

## Close-out

Once the maintainer approves:

1. Run the project's close-out. With OpenSpec, archive the change and sync its specs (the `openspec-archive-change` skill).
2. Record the work as done in the project record's status, as one line linking the pull request.
3. Merge as the project's conventions say. If the issue tracker doesn't close the issue on merge, close it.
