## Context

See `proposal.md` — *Why*. The three surfaces that shape the approach:

**The payload's two kinds.** `cli/payload.ts` declares fixed paths and variable sets. A variable set's members are stamped, and `cli/plan.ts` reconciles them: a stamped file inside a set's target directory that the current payload does not ship becomes a deletion. A fixed path is written unconditionally, carries no stamp, and is never a deletion candidate — a file jen always writes cannot be orphaned. `.github/workflows/jen.yml` is a fixed path, so removing its declaration leaves it in place with nothing in the project marking it as jen's.

**Two consumers of the registry.** `cli/plan.ts` reads it to fill `{{jen:team}}` / `{{jen:project}}` into the one substituted file as it writes it; `cli/watch.ts` reads it via `resolveFromRegistry` to know what to poll. Only the first goes.

**Symlinks are already the boundary problem.** `plan.ts` refuses to write behind a symlinked ancestor (`symlinkedAncestor` → `plan.obstructions`), `reconcileCandidates` skips symlinked slots and returns nothing for a symlinked target directory, and `apply` re-checks containment with `containedPath` before every `rmSync`. A new deletion path has to enter that discipline rather than sit beside it.

## Goals / Non-Goals

**Goals**

- Remove the scheduled workflow from jen, and from projects that already hold it.
- Leave one mechanism for deleting a former fixed path, reusable and no larger than it needs to be.
- Leave nothing behind that describes the runner as one of two, or the payload as carrying values.

**Non-Goals**

- A liveness bound on the runner. The job's `timeout-minutes: 120` had no counterpart and gets none here; `pipeline-runner`'s removal records the gap, and it is its own task.
- Overlapping ticks, and event-driven dispatch. Both named out of scope by the task, and neither is touched.
- A general "uninstall" or reconciliation-by-history. Retirement answers one question — *this path was mine and is not* — and answers it from the running version's declaration alone.

## Decisions

### Retired paths are a third payload kind, declared as data

`PayloadGroup` gains `{ kind: 'retired'; target: string }`. `payloadFiles()` continues to return only things that are written, so staging, installation, and the stamp rule are untouched; a separate accessor gives `plan.ts` the retired targets.

*Why a kind rather than a flag on the departing file*: a retired path has no source, no staged bytes, no format, and no stamp — every field of `ManagedFile` is meaningless for it. Modelling it as a `ManagedFile` with six empty fields invites code that reads one of them.

*Alternative — infer retirement from git history or a shipped manifest of past payloads*: rejected. It makes the payload declaration no longer the single statement of what jen owns, which `cli/AGENTS.md` names as the thing that must not drift, and it puts jen in the business of knowing its own past.

### Deletion is unconditional on content, and that is the contract the file already shipped under

No stamp check, no comparison against previously shipped renderings. The header of every fixed path says jen rewrites it wholesale, so an edit made there was already lost at the next update. Removing the file is that contract's last act, not a new claim.

*Alternative — spare a file whose content differs from a known rendering*: rejected. It requires carrying every historical rendering of every retired file forever, and it fails in the common direction: an adopter who tweaked the cron expression is exactly the adopter whose workflow is still billing them, and sparing it leaves the change half-done for the person it most needed to reach.

### A retired path joins `plan.deletions` rather than getting its own list

`Plan.deletions` becomes "paths this version removes", by either ground. Its doc comment moves off the stamp, and the retired targets are appended after the variable-set reconciliation.

*Why*: `apply` already deletes that list through `containedPath`, the report already prints it, and `isNoop` already counts it. A second list would need a second branch in each of those three for behaviour identical to the first.

*The one thing it must not inherit*: `reconcileCandidates` guarantees its candidates are regular files inside a real directory. A retired path is a bare string, so it needs its own guards before it joins the list.

### Three guards on a retired path, each matching an existing rule

1. **A symlinked ancestor is an obstruction, not a deletion.** `symlinkedAncestor` already answers this for writes; a retired path takes the same call and pushes to `plan.obstructions`, whose contract — the caller refuses the run — is exactly right. Deleting through a symlink would remove a file outside the project.
2. **Only a regular file is deleted.** `isRegularFile`, as `reconcileCandidates` does. A directory or a symlink at the target is left alone: `apply` calls `rmSync` without `recursive`, and a retired path must never remove a tree.
3. **Absent is silent.** No entry, no report. Most projects will never have held the file, and every update reporting a deletion that did not happen teaches an operator to skim the report.

### The declaration is checked, not trusted

A path declared both shipped and retired is a contradiction jen can hold — it would be written and then deleted in the same run — so it is rejected. This follows *at most one variable set per target directory*, which is likewise a property of the declaration asserted by a test over `PAYLOAD` rather than a runtime check on a value that cannot vary at runtime.

### Substitution comes out, and its vocabulary moves to where it is still true

Deleted: `substitute`, `PLACEHOLDER`, `ManagedFile.substituted`, `Plan.unresolved`, `Unresolved`, the substitution branch in `plan.ts`, and the unresolved-value report in `cli.ts`.

Kept and **moved from `cli/payload.ts` to `cli/registry.ts`**: `SUBSTITUTIONS` and `SubstitutionName`. They name the two values the registry can answer for, which is now a fact about the registry and its one reader — `watch.ts`, which already imports `SubstitutionName` for exactly that purpose. Leaving names built on "substitution" in the payload after the payload substitutes nothing is the residue this change exists to avoid; renaming them for what they are (the registry's resolvable names) is part of the removal rather than a follow-up.

*Alternative — keep the mechanism with no member*: settled against with the user. `plan.ts` already tolerates a payload where nothing is substituted, so it costs nothing to run; what it costs is a spec requirement and a code path describing something no file does, which the next reader has to disprove.

### The binding refusal is already where it belongs

`An unbound project's scheduled poll fails and names what is missing` existed because a failed scheduled run is mailed to the repository owner. `watch.ts` already refuses on an unresolvable team or project (`resolveIdentity`, and `impossible()` exiting non-zero for what cannot change while the process runs). So this needs **no new behaviour** — the spec restates the safety on the runner, and the work is to confirm the existing refusal names what is absent and the checkout it read.

*This is worth stating because it looks like a gap and is not.* A reader comparing the removals against the additions will expect new code here and should not go looking for it.

### `jen watch` keeps its name

The rename is prose — spec, README, comments, help text — not the command. `watch` describes what the process does and never carried the misleading word; renaming a published command to fix documentation would break every adopter's service file for no gain.

## Risks / Trade-offs

**An adopter running only Actions is left with no runner, silently.** → The failure is invisible by construction: nothing happens, on a project whose ordinary state is nothing happening. Mitigated by a changeset that leads with the required action rather than describing the change, and by the new `adoption-docs` requirement that binds the release note as well as the README. Not fully mitigable — an adopter who updates without reading gets a stopped pipeline. That is still strictly better than the status quo, where they get a *billing* pipeline they also did not read about.

**A retired-path deletion is the first time jen removes a file it cannot prove it wrote.** → Bounded by the three guards, by the requirement that only a former fixed path may be retired, and by the file's own shipped header. The blast radius is one declared path per entry, never a directory.

**A future retirement is now cheap enough to do carelessly.** → The spec restricts retirement to paths jen previously declared as fixed, and the declaration test refuses a path that is both shipped and retired. What it cannot prevent is retiring a path jen never owned; that is a review question, and the declaration is one file.

**The pipeline loses its only liveness bound.** → Accepted for this change, recorded in the `pipeline-runner` removal's migration note and in the adopter documentation, and filed as follow-up work. An operator watching a process they started is a materially different situation from an unattended scheduled job, which is why this is a deferral rather than a regression to hide.

**`.github/` stops being a managed location, and the rule permitting one survives with no member.** → Deliberate, and stated in the `managed-payload` delta: the rule governs what happens when such a file is declared again, not whether one exists today. The scenario that used the workflow as its worked example is rewritten generically, and a new scenario asserts that every path jen currently writes is under `.claude/` or at the root — so the absence is tested rather than assumed.

## Migration Plan

1. Ship the retired-path declaration and the workflow's deletion in the same release. An adopter who updates gets both, and there is no version in which jen has stopped writing the file but cannot remove it.
2. The changeset is a **minor** release (`0.3.x` → `0.4.0`), pre-1.0's breaking bump, and leads with what the adopter must do.
3. Rollback is a version pin. A project that reverts to `0.3.x` has the workflow rewritten by the next `jen update`, since it is a fixed path and fixed paths are written unconditionally — the retirement leaves nothing behind that would prevent it.

## Open Questions

None. The naming, the migration mechanism, the Actions guidance, the extent of the substitution removal, and the deferral of the liveness bound were all settled with the user before this was written.
