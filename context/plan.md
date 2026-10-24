# Plan

Last updated 2026-10-24.

## Current project: Agent harness & UI engine

[Linear P-JEN-1](https://linear.app/reveer/project/agent-harness-and-ui-engine-46e7fa62626c). Target date: 2026-11-29, the Sunday after Thanksgiving.

This project builds the first working jen, end to end. Agents run in containers, delegate to sub-agents, and present themselves as the UI. It isn't a throwaway prototype: the agent architecture and UI generation both get designed in depth here.

| # | Milestone | Done when | Opening issue | Blocked by | Cycle |
|---|---|---|---|---|---|
| 1 | Agent container | A single jen agent runs in its own container and can be invoked | [JEN-1](https://linear.app/reveer/issue/JEN-1) Design and scope the jen agent | none | 1 (Oct 26 – Nov 1) |
| 2 | Agent delegation | A jen agent spawns and works with sub-agents, each a jen agent in its own container | [JEN-2](https://linear.app/reveer/issue/JEN-2) Design and scope agent delegation | JEN-1 | 2 (Nov 2 – 8) |
| 3 | UI engine | A jen agent presents itself to the user through UI it generates | [JEN-3](https://linear.app/reveer/issue/JEN-3) Design and scope the UI engine | JEN-1 | 3 (Nov 9 – 15) |
| 4 | Distribution and hosting | A user can install and run jen locally, or reach it where it's hosted | [JEN-4](https://linear.app/reveer/issue/JEN-4) Design and scope distribution and hosting | JEN-2, JEN-3 | 4 (Nov 16 – 22) |

Cycle 5 (Nov 23 – 29) is slack.

Each opening issue is done when its decisions are written down and every remaining issue in its milestone has been created and scoped. See "Planning" in [conventions.md](conventions.md).

## Status

- 2026-10-24: [JEN-5](https://linear.app/reveer/issue/JEN-5) initialized OpenSpec and this record. [JEN-6](https://linear.app/reveer/issue/JEN-6) scoped the project: its milestones, their opening issues and the cycles. All four opening issues are in Todo. JEN-5 and JEN-6 sit in the project with no milestone.

## Open questions, held for their tasks

These are recorded so they aren't lost. Don't settle them ahead of the task that owns them.

- **JEN-1:** the language and framework. This is the project's first real decision, and everything else builds on it. The agent's design should leave room for an agent being started by another agent, not only by a user, so JEN-2 doesn't force a redesign.
- **JEN-3:** where generated UI renders. This needs to be explored deliberately in the task. Keep in view that an agent and whatever renders it may end up on different machines, so JEN-4 doesn't force a redesign.
- **JEN-4:** how jen reaches a user (distribution, for example an npm package) is separate from where agents run (hosting) and from where the user meets them (the surface).
