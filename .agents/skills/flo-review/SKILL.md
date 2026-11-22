---
name: flo-review
description: Have a fresh agent review an implementation, apply what it finds, then hand the work to the user. Use once you've finished implementing something, before you hand it to the user.
---

# Peer review

flo manages this file. `flo init` replaces it, so edits here are lost. To change how this project reviews or hands off work, say so in the project's own instructions, which this skill follows.

Before the user sees your work, an agent that didn't write it should try to find what's wrong with it. Then you fix what holds up and hand the work over.

## 1. Get a review

Start a reviewer: a subagent with a fresh context, on a model at least as capable as Claude Opus 5.5 or GPT Sol 6.1. Those are examples of the bar, not the only choices, and your own model is fine. What matters is the fresh context.

Give it what the work was meant to do in its original form: the user's request, and the issue, design and specs themselves if they exist, not your summary of them. Point it to the changes and to how the project checks its work. Leave out your reasoning and your case for why the work is right, so it judges what you built rather than what you meant.

Its job is to find out whether the work is right. Have it judge whether the work:

- does what it was meant to, and simply;
- holds up when things fail, and breaks nothing that worked;
- has tests that would fail without it.

It changes nothing. Every finding must be shown, not suspected: it runs the project's checks, reproduces each problem, and reports where it is and how to show it, along with any check it couldn't run. Where it disagrees with something the user decided, it asks instead of proposing a fix.

If you can't start a reviewer that meets the bar, never skip the review silently. Open the handoff by saying the work wasn't reviewed, or which weaker model reviewed it.

## 2. Apply what holds up

Treat each finding as a claim to check, not an order. Fix what holds up. Decline only what you can show is wrong, and mention it in a few words in the handoff. If a finding would change something the user decided, leave it and ask the user.

If your fixes changed more than wording, start a fresh reviewer with the same material and the earlier findings. It verifies each one, then reviews what changed since, without reopening what was settled. Stop when a review finds nothing new, or after three rounds, and hand off whatever is still open.

## 3. Hand off

If the project says how to hand off work, do that. Otherwise, end with a report as short as it can be while still telling the user what was done, what was and wasn't verified, and what needs their decision. The review gets a line: what it caught, and anything you declined.

The review goes in the handoff only, never into the project's files.
