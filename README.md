# jen

The workflow layer for automated, agentic software development — task-anchored, spec-driven, and git-reviewed.

jen installs a workflow into your project's repository: a workflow document every agent working there is bound to, and a set of skills that carry it out. Work is anchored to a task in your tracker, specified before it is written, and reviewed as a pull request that holds the specs and the code together. Each stage runs when its task reaches that stage's status.

jen does not host your project or point at it from somewhere else. It installs *into* your repository — the root becomes jen's (`AGENTS.md`, `.claude/`, `openspec/`, `registry.yaml`), and your own sources live under `src/`, tracked right there beside the workflow that governs them.

## What jen owns, and what you own

Read this before you install. jen overwrites its own files on every update, and an edit to one of them is gone the next time you take a version — so where the boundary falls decides where it is safe to work.

| Path | Who owns it | What an update does |
|---|---|---|
| `AGENTS.md` (root) | jen | **Replaced wholesale.** This is the workflow document. Notes you write here are lost. |
| `.claude/skills/<stage>/SKILL.md` (the seven shipped skills) | jen | **Replaced wholesale.** A skill jen stops shipping is deleted. |
| `registry.yaml` | you, from the moment it exists | Nothing. Written once when it is absent, then never read, rewritten, or deleted. |
| `.claude/settings.json` | you, from the moment it exists | Nothing. Same once-only rule. |
| `src/`, your `openspec/` content, skills you write yourself | you | Nothing. jen does not touch them and never deletes an unstamped file. |
| your `.gitignore` | you | Nothing. jen writes no ignore rules and imposes no arrangement on what you track. |

Every file jen owns in a shared directory carries an ownership stamp in its frontmatter:

```yaml
metadata:
  jen: true
```

**Deleting that stamp claims the file.** An unstamped file in `.claude/skills/` is yours: jen will not overwrite it and will not delete it. That is the supported way to keep an edit to a shipped skill — fork the file by unstamping it, and accept that it no longer tracks jen's version of it. Editing a stamped file and hoping is not.

## Adopting jen

### 1. Install

```bash
npm i -D @reveer/jen
```

A devDependency rather than a bare `npx`, so that jen and the OpenSpec version it drives are both pinned in your project's lockfile. Every stage of the workflow runs OpenSpec, and it has to resolve from your project rather than from wherever `npx` cached it.

### 2. Initialize

```bash
npx jen init
```

Writes the workflow document, the seven skills, and a scaffold your project owns from then on, then initializes OpenSpec in the project. It prompts for nothing, is safe to re-run, and is safe in CI. It reports every path it wrote, refreshed, or left alone.

### 3. Bind the project to its tracker — your step, not a command

`jen init` leaves the workflow pointing at nothing. `registry.yaml` is a stub, and nobody has checked that your tracker carries the statuses the stages move tasks through. Binding closes that gap.

**No subcommand does this.** It is a conversation: which team, which project, and a look at whether the statuses and labels the pipeline needs are actually there. The CLI never reaches your tracker. Ask your assistant to run the `setup-jen` skill:

```
Run the setup-jen skill
```

It confirms the team and project with you, verifies that the pipeline's statuses exist (`Backlog`, `Todo`, `In Design`, `In Progress`, `In Review`, `In Testing`, `In Delivery`, `Done`), ensures the `epic` and `task` labels, and records the result in `registry.yaml`. It creates no status and renames nothing — a missing one is reported for you to add. Re-run it as often as you like; it holds no state and every step is idempotent.

Once it reports the project bound and the statuses satisfied, the pipeline can run.

### 4. Take a later version

```bash
npm i -D @reveer/jen@latest && npx jen update
```

`update` refreshes every managed file and removes the ones jen no longer ships. It writes no scaffold — `registry.yaml` and `.claude/settings.json` stay yours, untouched, however many times you run it.

## Which assistants this reaches

jen writes into `.claude/` and nowhere else. Claude Code picks the skills up with no further configuration.

For another assistant, symlink its directory to jen's:

```bash
ln -s ../.claude/skills .agents/skills
```

That symlink is yours. jen neither creates it nor reads it, and it survives every update because nothing jen ships knows it exists. Whether your assistant finds skills that way is between you and it.

## What adoption does not cover

**A project that already has its own root `AGENTS.md` cannot be adopted as it stands.** `jen init` refuses it and writes nothing at all — no skills, no scaffold, nothing partial. jen owns that path wholesale and cannot tell your file from one it wrote earlier, and merging the two is a migration jen does not perform.

You have two ways forward, and both are decisions rather than workarounds:

- Move your file aside, run `jen init`, and fold what you need back into the workflow document knowing an update replaces it.
- Run `npx jen init --force`, which replaces your root `AGENTS.md` wholesale with jen's. `--force` applies to `init` only, and only to this one ambiguity — it never overrides a scaffold file that already exists, and it never makes jen delete something it did not write.

`jen init` also refuses a project that reaches a managed path through a symlinked directory, `--force` included. Everything below such a link belongs to wherever it points, possibly outside your project entirely.

## Changing jen itself

See [`CONTRIBUTING.md`](CONTRIBUTING.md).

## License

[Apache-2.0](LICENSE).
