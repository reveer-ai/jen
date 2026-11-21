# Project record: index

Read this file first. Then read only the files your task needs.

| File | Holds | Read when |
|---|---|---|
| [product.md](product.md) | What jen is and its core concept | You need to understand the product; once per fresh context for any design work |
| [plan.md](plan.md) | Current project, milestones, Linear map, cycles, status, open questions | You're starting or finishing work, or need to know what's next |
| [conventions.md](conventions.md) | How work is done here | Always, before acting |
| [decisions.md](decisions.md) | Dated decision log with reasons, newest first | Before re-opening a question, or when you need the reason behind something |
| [ideas.md](ideas.md) | The maintainer's ideas, not yet planned or decided | You're scoping a milestone or designing in an area an idea touches |
| [environment.md](environment.md) | Repo, code layout and commands, Linear workspace, OpenSpec, tool quirks | You're touching code, git, GitHub, Linear, OpenSpec or the harness |

`docs/` explains how jen works, for anyone who needs to understand a part of it. Nothing loads it by default; [environment.md](environment.md) lists its views.

## Skills

The project's own skills live in `.agents/skills/<name>/`, where Codex finds them, and `.claude/skills/<name>` links to each one for Claude Code. OpenSpec's generated skills are described in [environment.md](environment.md).

| Skill | Use it |
|---|---|
| `review-change` | To review a pull request, or re-review it after fixes |
| `deliver-change` | When the agent review of a change finds nothing new, to hand it to the maintainer, and again once it's approved |
| `tend` | At the end of each cycle, to keep the project record, docs and skills accurate and propose code cleanups |

When you catch yourself doing the same workflow by hand a second time, capture it as a skill and add it here.

## Keeping the record

- **Only what this project established.** Record what came out of work on this project, including every convention the maintainer sets, wherever it was first noted. Something a tool kept in its private memory belongs here once you've checked it still holds. Don't import knowledge from earlier versions of jen.
- **Only jen.** The repo and its record are public. They hold jen, the open-source harness, and nothing about reveer's products beyond it: their plans, features, customers or business. An idea that belongs to such a product goes to the maintainer, not into `ideas.md`. When something could be either, ask.
- **Only what the primary source can't tell.** If the code, a spec, git history, a pull request or Linear already says it, link there or leave it out. A copy costs every reader tokens and is one more thing to drift. The record holds intent, decisions, conventions and facts no file shows.
- **Each fact lives in one place.** Link to it rather than copying it.
- **Write for an agent with no context.** Use absolute dates. Give things their full name the first time they appear.
- **Write in the project's voice.** Preferences are this project's conventions and apply to anyone working on it.
- **Keep it lean.** Every fresh agent pays to read this, and what it reads steers what it does. Say each thing once, in as few words as carry it, and keep each file quick to scan for what its reader came for.
- **Retire, don't accumulate.** When something is superseded, mark it superseded in `decisions.md` and delete it from where it was.
- **Reorganize when the shape stops fitting**: when new knowledge has no natural home, a file mixes topics read for different reasons, or a reader has to wade through more than they came for. Split a file, turn it into a directory with its own index, merge files too thin to stand alone, or archive a finished project's detail. Don't wait to be asked, mention it in your report, and update this index in the same change. `tend` looks for this every cycle, but anyone who notices should act.
