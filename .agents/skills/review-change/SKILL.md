---
name: review-change
description: Review a change's design or implementation, post the review on its pull request, and re-review after fixes. Use when asked to review or re-review a change.
---

# Review a change

A review answers one question: should this go ahead as it is?

First read what the change is for: its issue, proposal, design and spec deltas. Then read what the project record says about reviews and about the decisions this change touches.

## What to judge

1. **The decisions.** Each one should solve the actual problem with the simplest mechanism that solves it completely, and fit the project's principles and earlier decisions. This matters most in a design review, before specs and code depend on it. In an implementation review, look again only where building it showed a decision was wrong. If you disagree with a decision the maintainer aligned on, raise it as a question for them with your reason. Don't change it yourself.
2. **The implementation.** It does what the design and specs say, holds up when things fail, and breaks no existing requirement. A requirement that stays silent where it needed to say something is a finding.
3. **What it leaves behind.** The project record, docs and specs say what is now true.

Reproduce each finding before you report it, and drop what you can't show. Run the project's checks yourself, and say which ones you couldn't run.

## Posting

Post on the pull request: a summary with the verdict and what you did and didn't verify, plus each finding inline at its line.

## Re-review

Verify each earlier finding at the new commit with its original reproduction, and resolve its thread. Then review what changed since. Don't reopen what was settled.

The review lives on the pull request. Don't copy it into the project record.
