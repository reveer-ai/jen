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

### The stamp, and what it does and does not protect

`.claude/skills/` is shared: jen's skills sit in it beside any you write. Every skill jen put there carries an ownership stamp in its frontmatter, which is how it tells the two apart:

```yaml
metadata:
  jen: true
```

The stamp marks a file as **jen's to remove**. It governs deletion, not overwriting, and the difference is the one thing worth knowing before you edit anything:

- **A skill jen still ships is overwritten on every update, stamped or not.** Deleting the stamp does not claim it. The next `jen update` rewrites the file and puts the stamp back, and your edit is gone either way.
- **A skill jen has stopped shipping is deleted only if it still carries the stamp.** Deleting the stamp keeps it, which is how you hold on to a skill a later version dropped.
- **A skill jen never shipped is never touched.** Unstamped and not in the payload means jen leaves it exactly where it is.

So there is no supported way to keep an edit to a skill jen currently ships. If you want different behaviour, write your own skill under its own name — that file is yours, permanently, and no update will look at it.

The same goes for the workflow document. Root `AGENTS.md` carries no stamp at all — jen owns that path outright and replaces it on every update. Project notes go in an `AGENTS.md` nearer the code they describe, at or below `src/`, which jen never touches.

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

### 4. Grant the permissions the stages need — also yours

The pipeline's stages run with nobody watching, and a denied permission is not a prompt an unattended run can wait out. A stage told to run your typecheck, lint, build, or tests, in a session that isn't permitted to run them, cannot finish: implementation can't hand off a change it was unable to check, and testing can't verify one.

`jen init` writes `.claude/settings.json` with the permissions that are the same in every project — `git`, `gh`, and `openspec`, the tooling the workflow itself runs — plus `npm run build`, `npm run lint`, `npm run typecheck`, and `npm test`, a starting shape that assumes one ecosystem's conventional names.

**What jen cannot know is your project's own commands.** It has no way to tell whether your tests run under `pytest`, `cargo test`, `make check`, or something else. If your project is outside the ecosystem that starting shape assumes, you hold four entries that do nothing for you and lack every one that matters. Add yours to the `allow` list already there:

```json
"Bash(pytest:*)",
"Bash(ruff:*)",
"Bash(mypy:*)"
```

Entries to add, not a file to paste over the one jen wrote — replacing it drops the permissions above, and that loss surfaces as denials in the middle of a run rather than as an error.

The tracker's own tools are granted where the pipeline is invoked rather than here, since their identifiers differ per install.

**This is a file you have to edit by hand, including on a project installed before this guidance existed.** `.claude/settings.json` is yours from the moment it exists — `jen update` never rewrites it, so no version you take will add these for you, and a project that predates this section will keep whatever list it was given until you change it.

### 5. Take a later version

```bash
npm i -D @reveer/jen@latest && npx jen update
```

`update` refreshes every managed file and removes the ones jen no longer ships. It writes no scaffold — `registry.yaml` and `.claude/settings.json` stay yours, untouched, however many times you run it.

## Which assistants this reaches

jen writes into `.claude/` and nowhere else. Claude Code picks the skills up with no further configuration.

For another assistant, symlink the directory it reads to jen's — substituting whatever directory yours actually uses:

```bash
mkdir -p .agents && ln -s ../.claude/skills .agents/skills
```

That symlink is yours. jen neither creates it nor reads it, and it survives every update because nothing jen ships knows it exists. Whether your assistant picks skills up that way is between you and it.

Point the link *at* `.claude/`, never the other way around. jen refuses to write through a symlinked directory on the way to one of its own paths, so making `.claude` itself a link stops `init` and `update` outright.

## What adoption does not cover

**A project that already has its own root `AGENTS.md` cannot be adopted as it stands.** `jen init` refuses it and writes nothing at all — no skills, no scaffold, nothing partial. jen owns that path wholesale and cannot tell your file from one it wrote earlier, and merging the two is a migration jen does not perform.

You have two ways forward, and both are decisions rather than workarounds:

- Move your file aside, run `jen init`, and fold what you need back into the workflow document knowing an update replaces it.
- Run `npx jen init --force`, which replaces your root `AGENTS.md` wholesale with jen's. `--force` applies to `init` only, and only to this one ambiguity — it never overrides a scaffold file that already exists, and it never makes jen delete something it did not write.

`jen init` also refuses a project that reaches a managed path through a symlinked directory, `--force` included. Everything below such a link belongs to wherever it points, possibly outside your project entirely.

**Running the pipeline unattended is not part of adoption yet.** `jen run` performs one pass over the tracker — it polls, decides which tasks are ready for which stage, and runs a session for each one that passed, exiting when those sessions have finished. It never loops; driving it on a schedule is the runner's job and is still being built.

What it needs beyond `jen init` is a registered identity per role on the git host, an agent on the tracker, and their credentials in the environment — none of which adoption sets up for you. Until that exists, the useful invocation is:

```
npx jen run --dry-run
```

which polls and reports what the pipeline would do right now, launching nothing, cloning nothing, and writing nothing anywhere. It is also the flag to reach for if you want a running pipeline to stop acting without redeploying anything.

## Changing jen itself

See [`CONTRIBUTING.md`](CONTRIBUTING.md).

## License

[Apache-2.0](LICENSE).
