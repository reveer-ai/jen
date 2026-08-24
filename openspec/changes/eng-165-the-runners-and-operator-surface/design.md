## Context

See `proposal.md` — Why. What shapes the approach is what the tick already is and what it already refuses to be.

`jen run` takes a team and a project as input, reads its tracker credential from the environment, holds the status→skill table compiled in, and reads no file at all — `test/dispatch.test.ts` asserts that no module on its path imports `node:fs`. It polls, decides, launches a session per dispatched request, waits for them, and exits. `--dry-run` is the absence of a launcher rather than a branch around one.

Three constraints follow, and every decision below is downstream of them:

- **A runner supplies the project identity; the tick never discovers it.** Under Actions there is no checkout, so there is no file to read. A tick that read one when available and took input when not would be two code paths.
- **The tick writes nothing.** Anything this change adds that writes — a rendered file, a transcript — belongs to the installer or the executor, never to the deciding pass.
- **Neither runner may hold pipeline state the other cannot see.** In-flight state, the concurrency cap, and now the pause all live in the tracker, because that is the only place both runners look.

Two things about the install engine matter here. `plan.ts` reads and `apply.ts` writes, and that split is what makes `jen init`'s refusal leave no trace. And `managed-payload` states that jen writes into `.claude/` and no other directory, naming `.github/` — a rule written against assistant instruction directories, which this change has to narrow before it can ship a workflow file.

## Goals / Non-Goals

**Goals:**

- Two runners that are wrappers, provably: everything either one knows about the pipeline is read from the tracker.
- A poll whose cost does not grow with the repository, and whose billed cost an adopter can compute before turning it on.
- An operator surface that is the dispatcher's, so it reads identically under both runners with nothing added to either.
- A halt that does not require touching CI configuration, the daemon, or task statuses.

**Non-Goals:**

- Any spend accounting that spans ticks. See `proposal.md` — What Changes.
- A general template language. Substitution resolves a closed set of names and nothing else.
- Bounding how long a stage session may run. The operative limit is the installation token's hour, which `cli/AGENTS.md` records as unsolved and ENG-167 measures. This change bounds the *job*, which is a liveness concern, not that.
- Uploading transcripts anywhere. jen writes one where it is told to and stops there.

## Decisions

### The Actions job runs the poll and the sessions together

`jen run` launches its sessions and waits for them; that is already the specified behaviour, and it exists so no session is left with no process responsible for it. Splitting the poll from the sessions across two Actions jobs would need an entry point that executes a run request without deciding — `jen exec <request>` — which only the Actions runner would ever call. That is a piece of pipeline structure one runner has and the other does not, which is the divergence this task exists to prevent.

*Alternative considered:* the scheduled job polls and `workflow_dispatch`es a second workflow per request. It buys parallelism across runners and a per-session job ceiling, and costs the shared entry point. Rejected on that alone.

The 6-hour job ceiling is therefore the ceiling on a whole tick rather than on one session, and it is not the binding constraint: each session mints an installation token good for an hour, so a session that runs long is already broken before the job ceiling is anywhere near. The shipped workflow sets `timeout-minutes: 120` — comfortably above any plausible stage session, far below the ceiling, and there to stop a hung session from holding a runner for six hours. It is a liveness bound and makes no claim about the token.

### Ticks serialize, under both runners

The workflow carries a `concurrency` group with `cancel-in-progress: false`, so a scheduled tick that fires while one is running is queued rather than run beside it, and a third replaces the queued one. `jen watch` serializes naturally: it awaits the tick before sleeping.

Under both, the interval is a floor measured from the end of one tick to the start of the next, not a guarantee of when a poll happens. A tick waiting on a long session delays the next poll. This costs latency between stages — a task whose stage finished early waits for the tick's slowest session before its next stage is picked up — and buys a bound on how many billed jobs can be alive at once.

Overlapping ticks would have been safe for spend on *sessions*, because the concurrency cap is derived from announcements in the tracker and is therefore shared across runners. What overlap costs is idle poll minutes and a wider dispatch-to-announcement window, and neither is worth the second failure mode.

### The workflow performs no checkout

The decision half needs a tracker credential, a team, a project, and the status→skill table. The first arrives as a secret, the next two as substituted environment, and the last is compiled into the published CLI. So the job installs the CLI and runs it. The fresh clone ENG-164 makes is the only checkout in the pipeline, taken only when there is work and amortized against a session that runs for minutes.

This is what holds the poll's cost flat as the monorepo grows, and it is the constraint that forces substitution: with no checkout there is no `registry.yaml` to read at run time, so the values have to be in the file.

### Managed files gain substitution, resolved in the planner

A managed file may declare that it carries placeholders. The syntax is `{{jen:name}}` over a closed set of names — `team` and `project` today — chosen so it collides with neither Actions' `${{ }}` nor shell expansion, and so it greps.

Resolution reads `registry.yaml` from the project root and takes the single `kind: project-management` resource's `team` and `project`. It happens in `plan.ts`, which already reads and never writes, so `apply.ts` writes rendered bytes and the plan's report can name what did not resolve. `jen init`'s refusal path is untouched: rendering is part of building the plan, and a refused plan is still not written.

**Unresolved renders empty, never as the literal placeholder.** A literal `{{jen:team}}` surviving into the YAML would have the runner poll a project by that name — a wrong answer that looks like a configured one. Empty makes `jen run` refuse with the message it already has.

Zero or several `project-management` resources both resolve to empty, and the report says which it was. Polling several projects from one tick would be a change to the tick's input, which takes one team and one project; it is not attempted here.

*Alternative considered:* hand-parsing the two values out of `registry.yaml` with a line reader, to avoid a runtime dependency. Rejected — the file is hand-authored by adopters, and a narrow parser's failure mode is a confidently wrong value. `yaml` moves from a devDependency to a dependency; it is already in the lockfile.

*Alternative considered:* having `setup-jen` write the values into the workflow directly. Rejected — the file would then be written by a skill and overwritten by `jen update`, which is the conflict the ownership model exists to avoid.

### An unbound project's workflow fails loudly rather than being guarded off

At `jen init` there is nothing to resolve — the registry is scaffold written in the same run — so a freshly installed project has a workflow that polls nothing. Binding, then `jen update`, is what renders the values in, which is why `project-binding` gains the requirement that binding finishes by refreshing them.

Between those two points the scheduled job runs and `jen run` refuses, naming the missing team. GitHub emails the repository owner about the failed scheduled run. That is the correct outcome for a state that should last minutes: it is loud, it names its own fix, and it clears itself the moment the project is bound.

*Alternative considered:* a job-level `if` guard so the job skips instead. It cannot be written — the `env` context is not available in a job-level conditional, so the guard would have to be a step inside a job that has already started and already billed its minute. Identical cost, quieter failure, more machinery.

### The kill switch is the tracker's project status

A project whose status type is `paused`, `completed`, or `canceled` halts dispatch: the tick refuses before it polls, reports why, and launches nothing. It is read by `type` rather than by name, so a workspace that renamed the status still halts.

This needs no new concept, both runners read it in the pre-poll check they already make, and it is two clicks where the operator already is. It is a deny list over three named types rather than an allow list over `started`, deliberately: jen's own project sits in `Backlog` while its pipeline runs, and an allow list would have halted it silently.

The project lookup this requires also closes a hole. The tick filters issues by project *name* today and never resolves the project itself, so two projects sharing a name would have their issues silently merged into one poll. Asking for two and refusing on the second makes that ambiguity an error.

*Alternatives considered:* a project label (works, but invents a convention where a built-in status already says exactly this); an environment variable or repository variable (runner-local, and toggling it means touching the CI configuration the switch exists to avoid).

### The run record is a second kind of line on the same stream

Every finished dispatch emits one JSON line on stdout carrying the task, skill, role, whether it succeeded, the cost where the session reported one, the session id, whether it was terminated, whether its session started at all, and where its transcript went or that it was not kept. The human-readable report on stderr gains the cost beside each line.

Requests and records share stdout, so both gain an `event` discriminator — `dispatch` and `outcome`. A consumer cannot otherwise tell them apart, and the alternative of a second file descriptor is worse for `jen run | recorder`.

A record carries no credential, on the same principle as a run request: it may be logged, printed, or piped anywhere.

### A transcript is kept only where the operator names a directory

`--transcripts <dir>` writes each session's stream there, and the record names the file. Unasked, the transcript goes with the run directory as it does today and the record says so. The default is not to keep one because a transcript is a session's entire stream — repository content, tool output, whatever a stage read — and durable copies of that are the operator's decision to make, not jen's.

The shipped workflow does not upload transcripts as artifacts. The stderr report is already in the job log; adding an upload step would put full session streams into artifact storage by default for everyone.

### `jen watch` is a loop, an interval, and a registry read

`jen watch [project] [--interval <seconds>]`, with `--team`/`--project` overriding what the registry says. It resolves the project identity by reading `registry.yaml` from the checkout it was pointed at — the parity with a human's working copy that makes the local runner worth having — and passes the values into the tick.

It defaults to a 60-second interval where the workflow's cron defaults to 30 minutes. The defaults differ because the constraint differs: a tick is a handful of tracker requests and costs a local process nothing, while Actions bills every poll rounded up to a whole minute. Nothing about the pipeline diverges — only how often each runner asks.

It holds no lock file, no ledger, and no memory of what it launched. A restart re-reads the tracker like any other runner; two instances on one project behave exactly as two runners do, which `task-dispatch` already covers. A lock would be state one runner has and the other cannot see, which is the rule this change is built around.

**A failed tick does not end the loop; an impossible one does.** A tracker error, a rate limit, or a paused project is reported and retried next tick — the pipeline's answer to a failed tick is the next tick, and a pause is meant to be waited out. A refusal that cannot change while the process runs — a missing credential, no team or project resolvable — ends the loop non-zero, because the environment a tick reads cannot change underneath a running process and looping on it would only print the same error forever.

Signals are the loop's rather than the tick's: `jen watch` installs its own handlers for the length of the process, stops scheduling, forwards to the sessions in flight, waits, and exits. `jen run` installs handlers per invocation and removes them on the way out, so the two must not both install.

Its log is stdout and stderr, exactly as `jen run`'s. Where that goes is the operator's — a redirect, a unit file, a supervisor. jen manages no log file, rotates nothing, and writes no pidfile.

## Risks / Trade-offs

**Scheduled workflows are disabled after 60 days without repository activity, on public repositories.** Verified at design time; `reveer-ai/jen` is public, so it applies to jen itself. The symptom is silence, and quiet is what triggers it — a project nobody promotes work into for two months goes dormant, and the failure surfaces at the moment somebody finally does promote something and nothing happens. → GitHub emails the repository owner before disabling, and `gh workflow enable` re-enables it. Documented as a condition of the Actions runner, and named as a reason an adopter might prefer `jen watch`. A pipeline that dispatched anything in that window pushes commits, which is activity, so this only bites a genuinely idle project.

**jen now writes into `.github/workflows/`.** Every adopter takes a new managed path on their next `jen update`, and a project that already has a file at that path has it overwritten. → The path is specific enough (`.github/workflows/jen.yml`) that a collision is unlikely, the ownership boundary in the adopter docs states it ahead of the instructions, and `jen update`'s report names every file it writes.

**Serialized ticks bound pipeline throughput.** A task cannot advance to its next stage until the tick holding its previous stage's session has finished all of them. → Accepted; within a tick, up to `--concurrency` tasks still run in parallel, and the alternative was overlapping billed jobs.

**A hung session holds the Actions runner up to `timeout-minutes`, and holds `jen watch` forever.** The job bound is the scheduled runner's; the local runner has no equivalent and its answer is the operator's. → Named as a difference in what each runner owns rather than papered over. A per-session timeout in the executor would be the runner-agnostic answer and belongs to `stage-execution`, not here.

**A session killed by a job timeout leaves an open announcement.** The task stays in flight until a human moves it, because an announcement does not expire. → That is the specified behaviour and the safer of the two failures: the alternative is a stage that reports completion while its commits go with the swept run directory.

**Substitution makes a managed file's contents depend on a project-owned file.** A malformed `registry.yaml` now affects what `jen update` writes rather than only what a stage reads. → Resolution is total and its failure is an empty value, which makes the tick refuse rather than act; the report names it.

## Migration Plan

No data migration. The change lands as an ordinary release, and adopters take it on their next `jen update`, which writes the new workflow path and re-renders the substituted values from whatever their registry already says.

Turning the pipeline on is an adopter's deliberate act in either case: the Actions runner needs eleven secrets set before it can do anything — three per role for `design`, `dev`, and `deliver`, plus `ANTHROPIC_API_KEY` and `LINEAR_API_KEY` — and `jen watch` needs the same values exported. Until then the workflow fails its scheduled run, which is the loud state described above.

Rolling back the Actions runner is `gh workflow disable`, or the project status, which is the point of the switch. Rolling back the change itself is a normal version pin.

## Open Questions

- **What cron interval to ship as the default.** 30 minutes is the working answer: ~1,440 job-minutes a month, inside both the Free (2,000) and Pro (3,000) allowances, and free outright on a public repository's standard runners. 15 minutes clears Pro but not Free. This changes one line and no requirement, and the real input is how long a stage session actually takes — which ENG-167 measures.
- **Whether `jen watch` should also be shipped as a unit file or launchd plist.** Out of scope here; the subcommand is what a supervisor supervises, and adding one is additive.
