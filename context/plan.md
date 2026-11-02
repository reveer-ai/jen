# Plan

Last updated 2026-11-01.

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

**After this project:** communication between agents that aren't parent and child, such as two root agents or two siblings, is a milestone of its own. The protocol and the runtime's grants already leave room for it (see [decisions.md](decisions.md), 2026-11-01), but nothing builds it until that milestone is scoped.

Each opening issue is done when its decisions are written down and every remaining issue in its milestone has been created and scoped. See "Planning" in [conventions.md](conventions.md).

## Status

- 2026-10-24: [JEN-5](https://linear.app/reveer/issue/JEN-5) initialized OpenSpec and this record. [JEN-6](https://linear.app/reveer/issue/JEN-6) scoped the project: its milestones, their opening issues and the cycles. All four opening issues are in Todo. JEN-5 and JEN-6 sit in the project with no milestone.
- 2026-10-26: [JEN-1](https://linear.app/reveer/issue/JEN-1) recorded the agent's core design (see [decisions.md](decisions.md)) and scoped the Agent container milestone at 8 points in cycle 1: JEN-1 (1), [JEN-7](https://linear.app/reveer/issue/JEN-7) Build the agent loop and model port (3), [JEN-8](https://linear.app/reveer/issue/JEN-8) Run the agent in a container (2), and [JEN-9](https://linear.app/reveer/issue/JEN-9) Design and build agent invocation (2). JEN-8 is blocked by JEN-7, and JEN-9 by both.
- 2026-10-26: [JEN-7](https://linear.app/reveer/issue/JEN-7) built the TypeScript project, the model port, the scripted model, the OpenAI Responses adapter and the agent loop, through the OpenSpec change `add-agent-loop-and-model-port` (archived; its specs are in `openspec/specs/`). The loop passes its live check against `openai/gpt-6-luna` through OpenRouter. JEN-7 is done, which unblocks JEN-8.
- 2026-10-27: [JEN-8](https://linear.app/reveer/issue/JEN-8) packaged the agent as an OCI image, with its conversation in SQLite on a `/state` volume and a one-message-per-run entrypoint, through the OpenSpec change `run-agent-in-container` (archived 2026-10-28; its specs are in `openspec/specs/`). The persistence check (two messages in two containers on one volume) passes against `openai/gpt-6-luna` through OpenRouter. JEN-8 is done, which unblocks [JEN-9](https://linear.app/reveer/issue/JEN-9).
- 2026-10-28: [JEN-9](https://linear.app/reveer/issue/JEN-9) replaced the one-shot entrypoint with a long-running server that speaks jen's protocol over HTTP and SSE on port 8080, guarded by a bearer token, through the OpenSpec change `serve-agent-over-http` (archived 2026-10-28; its specs are in `openspec/specs/`). The container check (a message to one container, recalled by a new container on the same volume, with the event stream read back) passes against `openai/gpt-6-luna` through OpenRouter. The [re-review on PR #6](https://github.com/reveer-ai/jen/pull/6#pullrequestreview-5683773737) verified all three original findings fixed at `599bc3f`, with no additional actionable issues. OpenSpec validation, typecheck, all 60 unit tests and CI pass. JEN-9 is done, which completes the Agent container milestone and unblocks [JEN-2](https://linear.app/reveer/issue/JEN-2) and [JEN-3](https://linear.app/reveer/issue/JEN-3).
- 2026-11-01: [JEN-2](https://linear.app/reveer/issue/JEN-2) recorded how delegation is shaped (see [decisions.md](decisions.md)) and scoped the Agent delegation milestone at 6 points in cycle 2: JEN-2 (1), [JEN-10](https://linear.app/reveer/issue/JEN-10) Build the agent runtime (3), and [JEN-11](https://linear.app/reveer/issue/JEN-11) Build delegation into the agent (2). JEN-11 is blocked by JEN-10.

## Open questions, held for their tasks

These are recorded so they aren't lost. Don't settle them ahead of the task that owns them.

- **JEN-3:** where generated UI renders. This needs to be explored deliberately in the task. Keep in view that an agent and whatever renders it may end up on different machines, so JEN-4 doesn't force a redesign.
- **Auth, after JEN-9's single shared token:** scoped or rotating tokens, more than one user, how agents authenticate to each other, and how a browser's `EventSource` gets the token. It belongs with hosting (JEN-4) and the agent runtime ([JEN-10](https://linear.app/reveer/issue/JEN-10)).
- **Model access isn't narrowable yet.** From [JEN-10](https://linear.app/reveer/issue/JEN-10) on, every agent gets the owner's raw API key, so any agent can call any model the key allows, spend without limit, and leak the key if compromised. The fix is a model proxy in the runtime: agents call models through it, never see the key, and model access becomes a grant (which models, how much spend). Spend as a recursion bound waits on it too. It needs its own issue once scoped.
- **Organizing and cleaning up agents.** Persistent sub-agents are kept until a parent deletes them, and every agent counts toward the runtime's limit until deleted. How agents stay organized and get cleaned up over time needs more thought once real trees exist.
- **JEN-4:** how jen reaches a user (distribution, for example an npm package) is separate from where agents run (hosting) and from where the user meets them (the surface). Each account gets its own runtime ([JEN-10](https://linear.app/reveer/issue/JEN-10)). That isolates accounts only if each runtime also has its own Docker engine, typically one VM per account, because controlling an engine means controlling everything on it.
