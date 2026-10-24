# Project record: index

Read this file first. Then read only the files your task needs.

| File | Holds | Read when |
|---|---|---|
| [product.md](product.md) | What jen is and its core concept | You need to understand the product; once per fresh context for any design work |
| [decisions.md](decisions.md) | Dated decision log with reasons, newest first | Before re-opening a question, or when you need the reason behind something |
| [environment.md](environment.md) | Repo, Linear workspace, OpenSpec, tool quirks | You're touching git, GitHub, Linear, OpenSpec or the harness |

Skills and prompts: so far only OpenSpec's generated ones, described in [environment.md](environment.md). When a workflow repeats, capture it as a skill. Put it where every agent in use can discover it: `.claude/skills/` for Claude Code, `.agents/skills/` for Codex. Then add it to this table.

## Keeping the record

- **Only what this project established.** Record what came out of work on this project. Don't import knowledge from a tool's private memory or from earlier versions of jen.
- **Each fact lives in one place.** Link to it rather than copying it. Linear holds issue-level detail, so link the issue instead of mirroring it.
- **Write for an agent with no context.** Use absolute dates. Give things their full name the first time they appear.
- **Write in the project's voice.** Preferences are this project's conventions and apply to anyone working on it.
- **Keep it lean.** Every fresh agent pays the tokens to read this. Keep this index to about 40 lines and each file to about 150.
- **Retire, don't accumulate.** When something is superseded, mark it superseded in `decisions.md` and delete it from where it was.
- **Reorganize when the shape stops fitting.** Restructure without being asked when any of these happens:
  - a file passes its size budget
  - new knowledge has no natural home
  - a file mixes topics that agents read for different reasons
  - an agent had to read more than it needed to find something

  Typical moves: split a file, or turn it into a directory with its own index (for example `decisions/` by month, or one design doc per milestone); merge files that are too thin to stand alone; archive a finished project's detail out of `plan.md`. Mention any restructure in your report, and update this table in the same change.
