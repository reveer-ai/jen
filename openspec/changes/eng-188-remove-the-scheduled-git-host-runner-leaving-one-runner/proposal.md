## Why

jen ships two runners as peers: a scheduled GitHub Actions workflow and a long-running local process. The scheduled one costs more than it is worth, in three ways.

**It bills for the sessions, not the polls.** `jen run` waits for every session it launches, so the Actions job holds a paid runner for the whole life of every stage session. The workflow's own "~1,440 job-minutes a month" estimate counts empty polls only. At roughly five stages of ~15 minutes, one task consumes ~75 runner-minutes — a private repository's free allowance covers about 25 tasks a month, and past that it is ~$0.60 of GitHub compute per task, paid to run agent sessions on 2-vCPU hardware.

**A quiet project turns it off.** GitHub disables scheduled workflows after 60 days of repository inactivity. The pipeline's ordinary state *is* quiet, so the trigger and the symptom are the same thing, and the failure surfaces only when somebody finally promotes work and nothing happens. This is the exact failure `pipeline-runner` refuses elsewhere in its own words: *"a poll that quietly does nothing is indistinguishable from a pipeline with nothing to do — which is the one state this pipeline must never be confused with."*

**A schedule is best-effort.** Delayed under load, with a five-minute floor. Least of the three, and the one that prompted this.

An event-driven trigger — a tracker webhook into `repository_dispatch` — was considered and rejected. It fixes the delay and the auto-disable and changes nothing about the job holding a runner for the length of the sessions. The trigger was never the expensive part.

## What Changes

One runner, not two-minus-a-leg.

- **`payload/jen.yml` is deleted**, and with it the payload's only file outside `.claude/` and the repository root. `.github/` stops being a managed location.
- **BREAKING — installed copies must be removed, and today nothing removes them.** The workflow is declared a *fixed path*, and fixed paths deliberately carry no ownership stamp: a file jen always writes can never be orphaned, so it is never a deletion candidate. That reasoning ends the moment jen stops writing it. Dropping the declaration alone would leave a live workflow in every adopted repository, polling every 30 minutes and billing indefinitely, dispatching beside whatever runner the adopter moved to. The payload therefore gains a **retired path**: a declared former target that an update deletes on sight. One entry today, and a mechanism the next retirement does not have to reinvent.
- **The surviving runner is called "the runner".** With one shipped runner the qualifier has no work to do, and *local* was misleading anyway — in the spec it means "not the git host", never "your laptop", and the runner is expected to live on a host. `jen watch` is unchanged. Where a sentence must distinguish jen's runner from one an adopter drives, it is "the runner jen ships".
- **Substitution leaves the payload.** The workflow was the only managed file carrying registry-resolved values, so `{{jen:team}}` / `{{jen:project}}` resolution at write time goes with it. Reading those values from the registry stays — the runner does it, at startup, from the checkout it was pointed at.
- **Binding stops refreshing derived files.** Nothing is derived from the registry at write time any more, so the post-binding `jen update` step exists to refresh nothing. Binding ends at recording the tracker.
- **The unbound-project safety survives, in a better place.** It existed because a failed scheduled run is mailed to the repository's owner. The runner already refuses to start against a registry that names no tracker, and reports it to an operator who is present — which the schedule's failure mail was a poor substitute for.
- **Actions is still possible and jen no longer ships a recipe for it.** Any scheduler that can invoke `jen run` is a runner and needs nothing added to jen. The documentation says so and stops there: a paste-ready workflow would walk an adopter straight back into the cost this change removes.
- **The scheduled/local pairing loses its illustrative use.** Several specs prove runner-independence with a scenario contrasting the two shipped runners. That contrast is now between the runner jen ships and one an adopter drives, which is still a real pair and still tests the same invariant.

## Capabilities

### New Capabilities

None. Every change lands on capabilities that already exist.

### Modified Capabilities

- `pipeline-runner`: removes *jen ships two runners, and neither is the fallback*, *the scheduled workflow polls without checking the repository out*, *the scheduled runner bounds how long a tick may hold a runner*, and *an unbound project's scheduled poll fails and names what is missing*. *Polls do not overlap* loses its git-host half. The local-runner requirements are renamed to the runner and gain the refusal the deleted binding check was carrying.
- `managed-payload`: deletion stops being the stamp alone — a declared retired path becomes the second and only other ground for removing a file. The requirement that a managed file may carry registry-resolved values is removed with its last member, and the `.claude/`-and-nowhere-else rule keeps its general form while losing the workflow as its worked example.
- `adoption-docs`: the ownership statement drops the workflow and the "one managed file outside `.claude/`" claim; the runner-choice section documents one runner rather than a pair; the per-runner conditions and the quiet-disable failure mode go; and the environment-passthrough requirement *gains* capability — its "not available on the scheduled runner" caveat has no runner left to apply to.
- `project-binding`: *binding refreshes what jen derives from the registry* is removed, along with the schedule-disabled check that binding performed.
- `openspec-integration`, `task-dispatch`, `stage-execution`: each proves that a stage runs identically under any runner by contrasting the two shipped ones. The requirement is unchanged; the scenarios are restated against the runner jen ships and one it does not.

## Impact

**Deleted**: `payload/jen.yml`; the payload's fixed-path declaration for `.github/workflows/jen.yml`; write-time substitution (`substitute`, `PLACEHOLDER`, the `substituted` field, and the resolution branch in the install plan); `test/scheduled-workflow.test.ts`.

**Changed**: `cli/payload.ts` (retired paths declared), `cli/plan.ts` (retired paths deleted; substitution branch removed), `cli/cli.ts` (help text and the unresolved-value report), `.claude/skills/setup-jen/SKILL.md` (the refresh step and the disabled-schedule check), `README.md` (ownership table, runner choice, passthrough caveat, starting the pipeline).

**Kept**: `cli/registry.ts` resolution and `cli/watch.ts`, which is where reading the tracker team and project moves to being the only reader.

**Adopters**: an update after this version deletes `.github/workflows/jen.yml` from the repository. An adopter running only the scheduled workflow has no runner until they start one, which the release notes must say plainly.
