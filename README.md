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
| `registry.yaml` | you, from the moment it exists | Nothing. Written once when it is absent, then never rewritten or deleted. Read, though: it is where the workflow below gets your tracker project from. |
| `.claude/settings.json` | you, from the moment it exists | Nothing. Same once-only rule. |
| `.github/workflows/jen.yml` | jen | **Replaced wholesale.** The pipeline's scheduled runner. The two values in it that name your tracker project come from `registry.yaml`. |
| `src/`, your `openspec/` content, skills you write yourself | you | Nothing. jen does not touch them and never deletes an unstamped file. |
| your `.gitignore` | you | Nothing. jen writes no ignore rules and imposes no arrangement on what you track. |

`.github/workflows/jen.yml` is the only managed file jen writes outside `.claude/` and the repository root, and it is there because the git host fixes the path — a workflow is configuration its consumer reads from somewhere specific, not an instruction with anywhere else to live. jen claims that one path and nothing else in `.github/`; your own workflows sit beside it untouched.

**Change which project the pipeline polls in `registry.yaml`, never in the workflow file.** jen resolves the team and project into it as it writes, so an edit there survives exactly until your next `jen update` — the same loss as editing a skill, reached through a file that reads like configuration you own. Edit the registry and run `jen update`.

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

Writes the workflow document, the seven skills, the pipeline's scheduled workflow, and a scaffold your project owns from then on, then initializes OpenSpec in the project. It prompts for nothing, is safe to re-run, and is safe in CI. It reports every path it wrote, refreshed, or left alone.

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

## Running the pipeline

Everything above installs the workflow and points it at your tracker. This is the step that makes it act on its own.

A **runner** drives one thing: `jen run`, a single pass over the tracker — poll, decide which tasks are ready for which stage, run a session for each, exit. It never loops. Driving that pass on a schedule is the runner's whole job, and jen ships two of them.

### Which one

They are peers, not a default and a fallback. Pick on where you would rather the process live:

| | Scheduled workflow | `jen watch` |
|---|---|---|
| Runs on | GitHub Actions, from `.github/workflows/jen.yml` | a machine you own — a VPS, a home server, a laptop |
| Keeps up | nothing | one process |
| Costs | Actions minutes: every poll bills a whole minute, free on a public repository | nothing beyond the machine |
| Interval | 30 minutes, in the workflow's `cron` | 60 seconds, `--interval` |
| Configured with | eleven repository secrets | the same eleven variables, exported |
| Conditions it carries | a schedule the host disables on an inactive public repository; a job ceiling of two hours | sessions die with the process; restarts and logging are yours |

**Choosing the local runner does not remove GitHub from the pipeline.** The stages still open pull requests, push branches, submit review verdicts, and depend on the branch's merge gate to make that review load-bearing — so the three registered applications are exactly as necessary under `jen watch` as under Actions. What you are choosing is where the *poll* runs, nothing more.

A runner jen does not ship is equally valid. Anything that can invoke `jen run` on a schedule — a systemd timer, a cron entry, a container, a scheduler jen has never heard of — is a runner, and needs nothing added to jen.

### What both need

Eleven values, the same names either way. Three per role, for the three applications `setup-jen` walked you through registering:

```
JEN_GH_APP_ID_DESIGN         JEN_GH_APP_ID_DEV         JEN_GH_APP_ID_DELIVER
JEN_GH_INSTALLATION_DESIGN   JEN_GH_INSTALLATION_DEV   JEN_GH_INSTALLATION_DELIVER
JEN_GH_PRIVATE_KEY_DESIGN    JEN_GH_PRIVATE_KEY_DEV    JEN_GH_PRIVATE_KEY_DELIVER
```

plus `LINEAR_API_KEY` — your tracker agent's key, shared by all three roles — and `ANTHROPIC_API_KEY`.

jen writes none of these anywhere. A run reads them from its environment at the point of use, mints a short-lived installation token per session, and the run's working directory goes when the run does.

### Starting the scheduled runner

1. Put the eleven values in **Settings → Secrets and variables → Actions**, under exactly the names above. The workflow reads them by name; a secret stored under any other name reaches nothing.
2. Make sure `.github/workflows/jen.yml` is committed and pushed. `jen init` writes it; `jen update` refreshes it after you bind the project.
3. That is all. The schedule takes it from there, every 30 minutes.

`gh workflow run jen.yml` polls immediately rather than waiting for the next half hour — which is what to reach for right after binding.

The two values naming your tracker project are resolved into the file from `registry.yaml` when jen writes it, so **run `jen update` after binding**. Until they are filled in, the scheduled run fails naming the missing team — deliberately, because GitHub emails you about a failed scheduled run and a job that quietly skipped would look exactly like a pipeline with nothing to do.

### Starting the local runner

```bash
export LINEAR_API_KEY=… ANTHROPIC_API_KEY=…   # and the nine JEN_GH_* values
npx jen watch
```

Pointed at a checkout, it reads that checkout's `registry.yaml` for the team and project, so there is nothing else to configure. `--team` and `--project` override it, `--interval <seconds>` changes the pace, and every flag `jen run` takes works here too.

It writes no pidfile, keeps no log file, and rotates nothing — its output is stdout and stderr, and where that goes is yours to decide. Run it under whatever supervises processes on that machine.

### What each one costs you when it goes wrong

**A schedule GitHub disabled.** On a **public** repository, GitHub disables a scheduled workflow after 60 days without repository activity. This is a real failure mode for a pipeline whose ordinary state is quiet: nobody promotes work for two months, the schedule stops, and you find out when you finally do promote something and nothing happens. GitHub emails the repository owner before it happens, and `gh workflow enable jen.yml` turns it back on. A pipeline that dispatched anything in that window pushed commits, which is activity — so this only bites a genuinely idle project.

**A local session dies with its process.** Stop `jen watch`, or lose the machine, and every session it launched stops too. The task keeps the announcement its session wrote and never gets the closing comment, which every later tick reads as *a session is still working this* — so that task will not be picked up again until a person moves it. That is deliberate: nothing writes to the tracker on a dead session's behalf, because the alternative is a stage that reports completion while its commits go with the discarded run directory. When you kill a runner, check what it was working.

The scheduled runner has a bound the local one does not: its job ends after two hours, so a session that hangs releases the runner instead of holding it. That is a liveness bound on the job, not a limit on how long a stage may take. On `jen watch`, a hung session hangs the loop, and stopping it is yours.

### What it does while nobody is watching

- **Two transitions stay yours.** `Todo` → `In Design` starts a task's design, and `Pending` → `In Progress` starts its implementation. No runner makes either. From `In Progress` onward the pipeline drives itself: design → implement → review → test → deliver → merged.
- **Any stage can hand a task back to you.** `Pending` is where a stage parks anything only a person can settle — a decision it cannot make, a blocker it cannot clear, work that is finished and needs your eye, or a task it judges is circling. The comment the stage leaves says which. A task sitting in `Pending` is waiting for you and will not move on its own.
- **Three tasks at a time.** `--concurrency` caps how many sessions may be in flight, and it defaults to 3. The cap is derived from the announcements on the tasks themselves rather than from anything a runner remembers, so two runners pointed at one project share one ceiling.
- **Ticks do not overlap.** Under both runners the interval is a floor between the *end* of one pass and the start of the next. A tick waits for the sessions it launched, so a long session delays the following poll.
- **Each run leaves a record.** Every dispatch and every finished session is a line of JSON on stdout — task, stage, role, outcome, cost, session id — beside a readable report on stderr. `jen run | recorder` works with no flag. Session transcripts are discarded unless `--transcripts <dir>` names somewhere to keep them.

### Stopping it

Move the **tracker project** to a paused, completed, or cancelled status. The next tick reads that before it polls, reports it, and dispatches nothing.

That is the halt under both runners, and it is deliberately not a runner-level switch: no schedule to delete, no process to stop, no task's status to edit, and nothing to redeploy when you want it back. Move the project to an active status and the next tick carries on. Sessions already running are not interrupted — a session that has announced itself owns its task until it reports.

For a preview rather than a stop:

```bash
npx jen run --dry-run
```

which polls and reports exactly what the pipeline would do right now, launching nothing, cloning nothing, and writing nothing anywhere.

## Which assistants this reaches

The instructions jen ships — the workflow document and the skills — go into `.claude/` and the repository root, and into no other assistant's directory. Claude Code picks the skills up with no further configuration. (The scheduled workflow is not an instruction; it is configuration GitHub reads from a path GitHub fixes, which is why it is the one exception in the table above.)

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

The same holds for a project that already has its own `.github/workflows/jen.yml`: jen owns that path outright, cannot tell your file from one it wrote, and refuses adoption naming it. Move yours aside, or run `--force` to replace it.

`jen init` also refuses a project that reaches a managed path through a symlinked directory, `--force` included. Everything below such a link belongs to wherever it points, possibly outside your project entirely.

## Changing jen itself

See [`CONTRIBUTING.md`](CONTRIBUTING.md).

## License

[Apache-2.0](LICENSE).
