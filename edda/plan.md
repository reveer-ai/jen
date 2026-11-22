# Plan

Last updated 2026-11-22.

## Current project: Agent harness & UI engine

[Linear P-JEN-1](https://linear.app/reveer/project/agent-harness-and-ui-engine-46e7fa62626c). Target date: 2026-11-29, the Sunday after Thanksgiving.

This project builds the first working jen, end to end. Agents run in containers, delegate to sub-agents, and present themselves as the UI. It isn't a throwaway prototype: the agent architecture and UI generation both get designed in depth here.

| # | Milestone | Done when | Opening issue | Blocked by | Cycle |
|---|---|---|---|---|---|
| 1 | Agent container | A single jen agent runs in its own container and can be invoked | [JEN-1](https://linear.app/reveer/issue/JEN-1) Design and scope the jen agent | none | 1 (Oct 26 – Nov 1) |
| 2 | Agent delegation | A jen agent spawns and works with sub-agents, each a jen agent in its own container | [JEN-2](https://linear.app/reveer/issue/JEN-2) Design and scope agent delegation | JEN-1 | 2 (Nov 2 – 8) |
| 3 | Agent workspace | A jen agent has a workspace that survives its restarts, and runs commands and reads and writes files in it, without holding its owner's model key or reaching the internet | none: scoped on 2026-11-10 while aligning [JEN-18](https://linear.app/reveer/issue/JEN-18)'s proposal | JEN-1 | 3–4 (Nov 9 – 22) |
| 4 | UI engine | A jen agent presents itself to the user through UI it generates | [JEN-3](https://linear.app/reveer/issue/JEN-3) Design and scope the UI engine | JEN-1; JEN-18 by [JEN-19](https://linear.app/reveer/issue/JEN-19) | 3 (Nov 9 – 15) |
| 5 | Distribution | A user installs jen from npm and uses it through the `jen` command | [JEN-4](https://linear.app/reveer/issue/JEN-4) Design and scope distribution | JEN-2, JEN-3 | 4 (Nov 16 – 22) |
| 6 | Foundation | jen's first iteration is cleaned up so the next project builds on it: how it installs, how it displays and the commands it offers, how its agents work together and the prompts they get, and its correctness and performance | [JEN-27](https://linear.app/reveer/issue/JEN-27) Design and scope cleaning up jen's first iteration | none | 5 (Nov 23 – 29) |

The maintainer added the Foundation milestone on 2026-11-20, in cycle 5, which had been slack, and on 2026-11-22 widened it to a self-contained install in one command ([JEN-31](https://linear.app/reveer/issue/JEN-31)) and hardening how agents, sub-agents and their workspaces work together ([JEN-32](https://linear.app/reveer/issue/JEN-32)). JEN-27 sized it at 15 points against about 9 for the 30 hours the maintainer has that week, and the maintainer kept the target date (see [decisions.md](decisions.md), 2026-11-22).

**After this project:** communication between agents that aren't parent and child, such as two root agents or two siblings, is a milestone of its own. The protocol and the runtime's grants already leave room for it (see [decisions.md](decisions.md), 2026-11-01), but nothing builds it until that milestone is scoped. So is the UI work after JEN-18, a data layer for agents' apps and jen's shell (see [ideas.md](ideas.md) and [decisions.md](decisions.md), 2026-11-14), which likely needs a project of its own. So is hosting: where agents that several people share run, with login and TLS (see [decisions.md](decisions.md), 2026-11-16).

Each opening issue is done when its decisions are written down and every remaining issue in its milestone has been created and scoped. See "Planning" in [conventions.md](conventions.md).

## Status

Finished work, newest first. The pull request holds the briefing, the maintainer's review and verification, and the archived OpenSpec change the design; the decisions are in [decisions.md](decisions.md). Points and cycles are in Linear.

| Done | Issue | Pull request | What it delivered |
|---|---|---|---|
| 2026-11-22 | [JEN-29](https://linear.app/reveer/issue/JEN-29) | [#24](https://github.com/reveer-ai/jen/pull/24) | The record moved from `record/` to `edda/`, with edda's pointer in `AGENTS.md`. clare is adopted, and flo's `flo-review` replaces `review-change`: only an implementation gets an agent review, and it goes in the handoff. |
| 2026-11-21 | [JEN-28](https://linear.app/reveer/issue/JEN-28) | [#23](https://github.com/reveer-ai/jen/pull/23) | jen is open source under Apache-2.0, with `NOTICE` in the package and the images, and its repo is public, taking outside pull requests. `main` takes changes only by a squash-merged pull request whose CI passed, with no bypass, and a release tag can't be moved or deleted. |
| 2026-11-20 | [JEN-26](https://linear.app/reveer/issue/JEN-26) | [#22](https://github.com/reveer-ai/jen/pull/22) | jen ships as the npm package `jen-ai`: `jen` checks Node and Docker, starts Docker Desktop, and pulls its version's images from GHCR. Every merge to `main` that changes what ships releases the images, the package, a tag and a GitHub release. The first release, `0.1.0`, passed the maintainer's hand check from an npm install. |
| 2026-11-19 | [JEN-25](https://linear.app/reveer/issue/JEN-25) | [#21](https://github.com/reveer-ai/jen/pull/21) | The `jen` command: it keeps its settings in Docker, starts the runtime on demand, creates, lists, stops and opens named roots, follows a query's progress to its reply, and uninstalls everything of jen's. Publishing it to npm is [JEN-26](https://linear.app/reveer/issue/JEN-26). |
| 2026-11-16 | [JEN-21](https://linear.app/reveer/issue/JEN-21) | [#20](https://github.com/reveer-ai/jen/pull/20) | The runtime holds the model key and proxies agents' model calls, accepting only the Responses adapter's request, and agents sit on an internal network that reaches only the runtime and each other. Completed the Agent workspace milestone. |
| 2026-11-16 | [JEN-4](https://linear.app/reveer/issue/JEN-4) | [#19](https://github.com/reveer-ai/jen/pull/19) | Recorded that an agent is jen's unit and that jen ships as the `jenai` npm package, and scoped the Distribution milestone, the package only, into [JEN-25](https://linear.app/reveer/issue/JEN-25). |
| 2026-11-15 | [JEN-22](https://linear.app/reveer/issue/JEN-22) | [#17](https://github.com/reveer-ai/jen/pull/17) | A click's ask reaches the agent in Safari: the bridge keeps focus in a text field during a press, and the sandbox check runs in Chromium and WebKit. Completed the UI engine milestone. |
| 2026-11-14 | [JEN-18](https://linear.app/reveer/issue/JEN-18) | [#16](https://github.com/reveer-ai/jen/pull/16) | The web shell's foundation: a root with `workspace` publishes `ui/index.html` with `publish_ui`, and its page runs it in a sandboxed frame, swaps in each version live, and sends a click's `jen.ask` to the agent. |
| 2026-11-12 | [JEN-19](https://linear.app/reveer/issue/JEN-19) | [#15](https://github.com/reveer-ai/jen/pull/15) | Agents with the `workspace` grant read, write and edit files in their workspace through `read_file`, `write_file` and `edit_file`, on a runtime route that moves a file's bytes as the agent. |
| 2026-11-12 | [JEN-20](https://linear.app/reveer/issue/JEN-20) | [#14](https://github.com/reveer-ai/jen/pull/14) | Agents with the `workspace` grant run commands in a sandboxed workspace container with no network, through `run_command`; the boundary check runs in CI. |
| 2026-11-10 | [JEN-3](https://linear.app/reveer/issue/JEN-3) | [#13](https://github.com/reveer-ai/jen/pull/13) | Recorded how agents present themselves and scoped the UI engine milestone. |
| 2026-11-09 | [JEN-15](https://linear.app/reveer/issue/JEN-15) | [#11](https://github.com/reveer-ai/jen/pull/11) | Skills to review, deliver and tend changes; `context/` renamed `record/` and kept by intent; conventions moved in from private memory. |
| 2026-11-09 | [JEN-12](https://linear.app/reveer/issue/JEN-12) | [#10](https://github.com/reveer-ai/jen/pull/10) | Agents answer by ending their turn and wait with a `wait` tool; the behavior check holds them to it on Luna. |
| 2026-11-05 | [JEN-11](https://linear.app/reveer/issue/JEN-11) | [#9](https://github.com/reveer-ai/jen/pull/9) | Delegation: saved steps, the inbox, urgent messages, recovery and the runtime's notices. |
| 2026-11-03 | [JEN-10](https://linear.app/reveer/issue/JEN-10) | [#8](https://github.com/reveer-ai/jen/pull/8) | The agent runtime: its own image, the tree in Docker labels, grants, bounds and the relay. |
| 2026-11-02 | [JEN-2](https://linear.app/reveer/issue/JEN-2) | [#7](https://github.com/reveer-ai/jen/pull/7) | Recorded how delegation is shaped and scoped the Agent delegation milestone. |
| 2026-10-28 | [JEN-9](https://linear.app/reveer/issue/JEN-9) | [#6](https://github.com/reveer-ai/jen/pull/6) | A long-running agent serving jen's protocol over HTTP and SSE. Completed the Agent container milestone. |
| 2026-10-28 | [JEN-8](https://linear.app/reveer/issue/JEN-8) | [#5](https://github.com/reveer-ai/jen/pull/5) | The agent as an OCI image, its conversation in SQLite on a `/state` volume. |
| 2026-10-27 | [JEN-7](https://linear.app/reveer/issue/JEN-7) | [#4](https://github.com/reveer-ai/jen/pull/4) | The model port, scripted model, OpenAI Responses adapter and agent loop. |
| 2026-10-26 | [JEN-1](https://linear.app/reveer/issue/JEN-1) | [#3](https://github.com/reveer-ai/jen/pull/3) | Recorded the agent's core design and scoped the Agent container milestone. |
| 2026-10-24 | [JEN-6](https://linear.app/reveer/issue/JEN-6) | [#2](https://github.com/reveer-ai/jen/pull/2) | Scoped this project: its milestones, opening issues and cycles. |
| 2026-10-24 | [JEN-5](https://linear.app/reveer/issue/JEN-5) | [#1](https://github.com/reveer-ai/jen/pull/1) | Initialized OpenSpec and this record. |

## Open questions, held for their tasks

These are recorded so they aren't lost. Don't settle them ahead of the task that owns them.

- **Auth, beyond the runtime's tokens:** [JEN-10](https://linear.app/reveer/issue/JEN-10) built an owner token and a per-agent token renewed on every start (see [decisions.md](decisions.md), 2026-11-02). Still open: human login, TLS on the runtime's port, and how a browser's `EventSource` gets a token, which wait for hosting, after this project. [JEN-18](https://linear.app/reveer/issue/JEN-18) needs a browser to reach an agent's UI, but only locally (see [decisions.md](decisions.md), 2026-11-10). Agents call the runtime with their own tokens since [JEN-11](https://linear.app/reveer/issue/JEN-11).
- **Model access isn't narrowable yet.** Since [JEN-21](https://linear.app/reveer/issue/JEN-21), the key stays in the runtime, which checks and proxies every agent's model call, and agents are offline. Still open: model access as a grant (which models, how much spend) and spend as a recursion bound, which would extend the proxy's check.
- **Whether the Luna-class requirement covers generative UI** (see [decisions.md](decisions.md), 2026-11-10). Evidence so far: on 2026-11-13 the maintainer tried [JEN-18](https://linear.app/reveer/issue/JEN-18)'s UI by hand on `openai/gpt-6-sol` and `openai/gpt-6-luna`, and found their UIs very similar in quality and generation time, Luna perhaps a little slower. The UI live check runs only on Sol.
- **Organizing and cleaning up agents.** Persistent sub-agents are kept until a parent deletes them, and every agent counts toward the runtime's limit until deleted. How agents stay organized and get cleaned up over time needs more thought once real trees exist. Since [JEN-25](https://linear.app/reveer/issue/JEN-25), `jen` can't delete, rename or organize roots either: a root made by mistake stays until it's deleted through the API by hand.
- **Hosting, after this project:** each account gets its own runtime ([JEN-10](https://linear.app/reveer/issue/JEN-10)). That isolates accounts only if each runtime also has its own Docker engine, typically one VM per account, because controlling an engine means controlling everything on it. Hosting must also leave any application able to connect to jen as a service (see [product.md](product.md)), and decide how.
