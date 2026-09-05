## Context

See `proposal.md` — *Why*. Three facts about the current code shape the approach.

**The payload's two kinds.** `cli/payload.ts` declares fixed paths and variable sets. A variable set's members are stamped, and `cli/plan.ts` reconciles them: a stamped file inside a set's target directory that the current payload does not ship becomes a deletion. A fixed path is written unconditionally, carries no stamp, and is never a deletion candidate — a file jen always writes cannot be orphaned. `.github/workflows/jen.yml` is a fixed path.

**Two consumers of the registry.** `cli/plan.ts` reads it to fill `{{jen:team}}` / `{{jen:project}}` into the one substituted file as it writes it; `cli/watch.ts` reads it via `resolveFromRegistry` to know what to poll. Only the first goes.

**Nothing has the file installed.** jen has no adopters, and jen's own repository has never carried the rendered workflow — `cli/AGENTS.md` records why, and `.github/workflows/` holds only `ci.yml` and `release.yml`. This is what decides the migration question below, so it is a premise rather than an aside.

## Goals / Non-Goals

**Goals**

- Remove the scheduled workflow from jen.
- Leave nothing behind that describes the runner as one of two, or the payload as carrying values — in the specs, the code, the shipped skills, or the contributor notes.

**Non-Goals**

- A mechanism for removing installed copies. Nothing has one; see the decision below.
- A liveness bound on the runner. The job's `timeout-minutes: 120` had no counterpart and gets none here; `pipeline-runner`'s removal records the gap, and it is its own task.
- Overlapping ticks, and event-driven dispatch. Both named out of scope by the task, and neither is touched.

## Decisions

### No retirement mechanism, because there is nothing to retire

The workflow is a fixed path, so removing its declaration leaves any installed copy in place: fixed paths carry no stamp, and `cli/plan.ts:327` only ever considers stamped files for deletion. That would matter if an installed copy existed. None does — jen has no adopters, and jen is not an installation of itself.

*Alternative — declare a retired path the payload deletes on sight*: designed, then dropped. It was machinery for a population of zero, and designing it without a real migration to test it against produced a design with a flaw the real case would have caught: a retirement entry never expires, so once the documentation tells adopters to write their own scheduled job — and `.github/workflows/jen.yml` is the obvious name for it — every later `jen update` would silently delete the file they wrote. Not claiming the path again is strictly safer than claiming it forever and warning about it.

*The tail risk*, that someone installed a previous version unknown to us, is covered by one sentence in the changeset telling them to delete the file by hand. That is a complete mitigation for the actual exposure, at no cost in code, spec, or future constraint.

*When a real retirement arrives*, it is designed then, against a migration that can be tested and a lifetime that can be reasoned about.

### Substitution comes out, and its vocabulary moves to where it is still true

Deleted: `substitute`, `PLACEHOLDER`, `ManagedFile.substituted`, `Plan.unresolved`, the `render` substitution branch and the `resolveFromRegistry` call in `plan.ts`, and the unresolved-value report in `cli.ts`.

Moved from `cli/payload.ts` to `cli/registry.ts`, and renamed there: `SUBSTITUTIONS` and `SubstitutionName` become `REGISTRY_VALUES` and `RegistryValueName`. They name the two values the registry can answer for, which is now a fact about the registry and its one reader — `watch.ts`, which already imported the type for exactly that purpose. Leaving names built on "substitution" in a payload that substitutes nothing is the residue this change exists to avoid.

The rename was not in the original design, which said move rather than rename; review took it on the argument that the sentence above argues one step further than the design went — the moved names described the deleted mechanism, contradicted the doc comment they sat under, and typed the runner's refusal state in `watch.ts`. The screaming-snake form follows `REGISTRY_FILE` and `TRACKER_KIND` beside them rather than the `RegistryValues` spelling first floated on the thread.

**`Unresolved` and `Resolution` in `cli/registry.ts` stay.** They look like substitution's types and are not: `watch.ts:115` iterates `registry.unresolved` to say *why* a value is missing, which is the message the runner's refusal is required to carry. After this change the runner is their only consumer, which is what makes them registry types rather than payload ones.

*Alternative — keep the substitution mechanism with no member*: settled against with the user. `plan.ts` already tolerates a payload where nothing is substituted, so it costs nothing to run; what it costs is a spec requirement and a code path describing something no file does, which the next reader has to disprove.

### The binding refusal is already where it belongs

`An unbound project's scheduled poll fails and names what is missing` existed because a failed scheduled run is mailed to the repository owner. `watch.ts` already refuses on an unresolvable team or project (`resolveIdentity`, and `impossible()` exiting non-zero for what cannot change while the process runs). So this needs **no new behaviour** — the spec restates the safety on the runner, and the work is to confirm the existing refusal names what is absent and the checkout it read.

*This is worth stating because it looks like a gap and is not.* A reader comparing the removals against the additions will expect new code here and should not go looking for it.

### The prose is part of the removal, not a follow-up

The two-runner split is load-bearing in more places than the specs. `cli/AGENTS.md` carries three sections that exist only for the workflow — why its source is `payload/` rather than its own target path, why substitution renders empty rather than the placeholder, and why a job-level `if` cannot read the `env` context — plus a fourth, *the local runner holds no lock*, whose argument is built on there being a second runner that cannot see one. Comments in `run.ts`, `exec.ts`, `stages.ts`, and `cli.ts` reason from the pair the same way.

These are removed and rewritten with the code, in this change. A contributor note explaining a file that no longer exists is worse than no note: it is read as current, and `cli/AGENTS.md` is the first thing a session working in `cli/` is told to trust.

*The lock section survives in rewritten form.* Its conclusion holds — the tracker is the record, and a restart re-establishes everything — but the reason changes from *the other runner cannot see a lock* to *a second instance cannot*, which is the case the code actually faces now.

### `jen watch` keeps its name

The rename is prose — spec, README, comments, help text — not the command. `watch` describes what the process does and never carried the misleading word; renaming a published command to fix documentation would break every adopter's service file for no gain.

## Risks / Trade-offs

**An install exists that nobody knows about, and keeps polling and billing.** → Mitigated by the changeset sentence. Deliberately not mitigated in code: the mechanism that would do it is the retirement design dropped above, whose own failure mode is worse and permanent. Accepted on the user's judgment that there are no adopters, and bounded by the fact that such an install would be someone's own repository, where a `.github/workflows/` file is discoverable.

**The pipeline loses its only liveness bound.** → Accepted for this change, recorded in the `pipeline-runner` removal's migration note and in the adopter documentation, and filed as follow-up work. An operator watching a process they started is a materially different situation from an unattended scheduled job, which is why this is a deferral rather than a regression to hide.

**`.github/` stops being a managed location, and the rule permitting one survives with no member.** → Deliberate, and stated in the `managed-payload` delta: the rule governs what happens when such a file is declared again, not whether one exists today. The scenario that used the workflow as its worked example is rewritten generically, and a new scenario asserts that every path jen currently writes is under `.claude/` or at the root — so the absence is tested rather than assumed.

**README documents an adoption refusal that stops being true.** → `jen init` currently refuses a project holding its own `.github/workflows/jen.yml`, because jen owned that path and could not tell its file from the project's. After this change jen does not own the path, so there is nothing to refuse and the paragraph is simply deleted rather than rewritten. Named as a task because it reads as unrelated to the runner and is easy to miss.

## Migration Plan

1. One release, no ordering constraint — nothing is being cleaned up, so no version exists in which jen has stopped writing the file but cannot remove it.
2. The changeset is a **minor** release (`0.3.x` → `0.4.0`), pre-1.0's breaking bump, and carries the manual-cleanup sentence for any install we do not know about.
3. Rollback is a version pin. A project that reverts to `0.3.x` has the workflow written by the next `jen update`, since it is a fixed path and fixed paths are written unconditionally.

## Open Questions

None. The naming, the absence of a migration mechanism, the Actions guidance, the extent of the substitution removal, and the deferral of the liveness bound were all settled with the user before this was written.
