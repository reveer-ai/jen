## Why

The dispatcher is finished and nothing drives it. `jen run` performs one poll-map-gate pass and runs what passed (ENG-163), each dispatch becomes an isolated session (ENG-164), and the three identities those sessions act under are registered (ENG-141). A person still has to type the command. An unattended pipeline is one nobody types anything into, so the missing piece is a schedule — and, once it is running while nobody watches, some way to see what it did and some way to stop it that is not deleting the schedule.

jen ships two runners rather than one because the choice is an adopter's, not jen's: a scheduled GitHub Actions workflow for a project that wants nothing to stay up, and `jen watch` for one that would rather own the box. Both are thin wrappers over the same tick. The whole risk in this change is that they stop being thin — the moment either holds pipeline state the other cannot see, they are two implementations of the dispatcher and they will drift.

## What Changes

**The scheduled GitHub Actions workflow.** A managed file on a cron schedule that invokes the published CLI directly. It performs no checkout: the tick's decision half needs a tracker credential, a team, a project, and the compiled status→skill table, and the first three arrive as environment and the fourth is compiled in. The team and project are substituted into the file from `registry.yaml`, so the pipeline's target is versioned and diffable rather than living in repository settings where nothing reviews it.

- **BREAKING** (to jen's own rule, not to adopters): jen writes into `.github/workflows/`. The managed payload today says jen writes into `.claude/` and no other directory, naming `.github/` explicitly. That rule was written against *assistant instruction* directories — fanning byte-identical copies of the same skills into every assistant's folder — and it is narrowed to say that. The CI workflow is a new declared fixed path.
- The payload gains **substitution**: a managed file may carry named placeholders resolved from `registry.yaml` when it is written. A fixed, closed set of names, resolved totally, with no template language. This is the only way a file jen owns can carry a value the project authored.
- Polling ticks are **serialized** by a workflow concurrency group, and the job is **guarded off** until the project is bound, so an installed-but-unbound project runs a skipped job rather than a failing one every half hour.
- The stage sessions run **in the same job as the poll that dispatched them**, because `jen run` launches and waits and splitting them would need an execute-this-request entry point that only one runner has.

**`jen watch`.** A subcommand that calls the same tick on an interval until it is stopped. It takes a project path, resolves the team and project by reading `registry.yaml` from that checkout, and passes them into the tick — `jen run` still reads no file. Ticks serialize: the interval is a floor measured from the end of one tick to the start of the next, so a tick that waits on a long session delays the next poll rather than overlapping it. A signal stops scheduling and forwards to the sessions in flight, which `jen run` already does. It holds no lock, no ledger, and no record of what it launched: a restart re-reads the tracker like any other runner, and two instances behave exactly as two runners do.

**The operator surface.**

- Every finished dispatch emits a **run record** — the task, the stage, the role, whether it succeeded, what it cost, its session id — as a line of JSON on stdout beside the run request, and gains its cost in the human-readable report on stderr. It belongs to the dispatcher, so it reads identically under both runners with nothing added to either.
- A session's **transcript is kept only where the operator asks**, by naming a directory. Unasked, it goes with the run directory as it does today. The record says which happened rather than leaving a reader to guess.
- The **kill switch is the tracker's own project status.** A project whose status type is `paused` halts dispatch: the tick refuses before it polls, reports why, and launches nothing. Both runners read it from the check they already make before polling, it needs no new concept, and toggling it is two clicks where the operator already is. `canceled` and `completed` halt for the same reason.

**Out of scope, deliberately: a spend ceiling.** It needs spend accumulated across ticks, and a scheduled job is a fresh process with no memory of the last one. Every place to put that memory is either state one runner has and the other cannot see, which this change's central rule forbids, or a much wider tracker read on every tick. The failure it was meant to catch — a task circling the pipeline and billing each lap — is already the stage skills': they read the record before routing a task backward and park it at `Pending` when it has been sent back for the same objection before. That is a ledger a person reads, on the task itself.

**Docs.** Which runner to pick and why, what each needs configured, that the local runner drops Actions and not GitHub, and what the pipeline will do while nobody is watching.

## Capabilities

### New Capabilities

- `pipeline-runner`: what drives the tick on a schedule. The two runners jen ships, the parity rule that keeps them wrappers rather than implementations, which side of the seam resolves the project identity, and what each runner owns that the other does not — billed minutes, dormancy, and a job ceiling on one; interval, signals, and restart on the other.

### Modified Capabilities

- `managed-payload`: the `.claude/`-only rule narrows to assistant instruction directories, and the CI workflow becomes a declared fixed path. Managed files gain substitution of a closed set of values resolved from `registry.yaml`.
- `task-dispatch`: a paused project halts dispatch before the poll, beside the existing `Pending` check. Every finished dispatch is reported as a run record carrying its cost.
- `stage-execution`: a run's transcript may be preserved where the operator names a directory, and is discarded with the run directory otherwise.
- `project-binding`: binding finishes by refreshing the values jen substitutes into managed files, so a project that has just been bound has a runner configured to poll it.
- `adoption-docs`: the documentation covers choosing a runner and what the pipeline does unsupervised, and the ownership boundary it states ahead of the instructions now includes the workflow file.

## Impact

- `cli/payload.ts` — the workflow as a fixed path; substitution declared per file.
- `cli/plan.ts` / `cli/apply.ts` — rendering at write time; the planner still writes nothing.
- `cli/cli.ts` — `jen watch` and its flags; the transcript directory; cost in the report.
- `cli/run.ts` — the paused-project refusal; the run record. The tick still writes nothing.
- `cli/exec.ts` — where a transcript goes when one is kept.
- `cli/linear.ts` — the project's status, read in the pre-poll check.
- New: the workflow template in the payload.
- `README.md` — the runner chapter and the widened ownership boundary.
- Adopters take a new managed path, `.github/workflows/`, on their next `jen update`.
