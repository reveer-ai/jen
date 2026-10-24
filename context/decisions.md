# Decisions

Newest first. Each entry gives the decision and why. When an entry is superseded, mark it and link the entry that replaces it.

## 2026-10-24

- **The agent is the project's manager. The maintainer is its lead and customer.** The lead sets direction and makes the calls that shape jen. The agent owns everything else: Linear, the record, conventions, skills and prompts. *Why:* the maintainer works on the project only through agents. One general role statement covers duties nobody has listed yet, so the prompt doesn't have to enumerate them.
- **`context/` is the project's source of truth.** Agents keep it. `AGENTS.md` points to it, and `CLAUDE.md` imports `AGENTS.md`. *Why:* all work goes through agents. Any agent (Claude Code, Codex or another) or engineer who checks out the repo should get the full picture without depending on one tool's private memory.
- **OpenSpec is initialized in the repo** (1.15.0, `spec-driven` schema) for Claude Code and Codex, under [JEN-5](https://linear.app/reveer/issue/JEN-5). How it's used gets settled the first time a task needs it.
- **Fresh start.** A new Linear workspace (`reveer`), team `jen` and repo `reveer-ai/jen`, with no "v2" naming.
- **The first project is "Agent harness & UI engine"**, with four milestones in this order: Agent container, Agent delegation, UI engine, Distribution and hosting. *Why:* a project is a bounded effort, and the team already stands for the product. Delegation is its own milestone because a sub-agent is the same kind of agent; what's new is the relationship between agents. The UI engine comes before hosting because it's how a user uses jen at all. Local use falls out of building it, and hosting is mostly a question of transport.
- **Target date 2026-11-29, with one milestone per one-week cycle.** *Why:* that's about a week per milestone, plus a slack week. It errs on the safe side and can be pulled in.
- **Milestones get no separate target dates.** *Why:* a milestone's size isn't known until its design issue is done.
- **Each milestone is scoped by its own opening issue**, not in an up-front scoping session. *Why:* scoping before getting into the problem has gone wrong before.
