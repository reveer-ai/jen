## Context

See proposal.md — Why. The constraints that shape the approach, all of them already true:

- **The payload declaration is the single source.** `cli/payload.ts` is read by `scripts/stage-payload.js` at pack time and by the CLI at install time; neither restates the file list.
- **Reconciliation is per variable set.** `reconcileCandidates` derives a set's search from its own `targetDir` and `memberShape`, and `planInstall` runs it once per set.
- **`.claude/skills/` is shared.** `openspec init` writes nine `openspec-*` skills into it, at exactly the depth reconciliation searches. They survive only because deletion is the stamp intersected with the shipped payload.
- **The eight statuses already have an owner.** `task-pipeline` names the status that triggers each stage, plus `Backlog` and `Todo`. This change adds no status and moves no authority.

## Goals / Non-Goals

**Goals:**

- Ship a seventh skill without making "the payload" and "the stages" the same list.
- Keep the binding step's state legible from the tracker and the registry, with nothing persisted to remember a previous run.
- Be honest about what is verifiable in CI and what is only reviewable.

**Non-Goals:**

- Any change to the six stage skills, `AGENTS.md`, `scaffold/`, or the install and reconcile logic in `plan.ts`/`apply.ts`. The payload declaration changes; the machinery reading it does not.
- Any second variable set, second target directory, or per-assistant output.

## Decisions

### The deliverable is mostly prose, and the test surface has to say so

`setup-jen` is a skill: instructions an agent reads, not code that runs. The consequence is worth stating plainly, because it determines what "done" can mean.

**Testable, and tested:** that the skill file exists, is tracked, parses as a valid Agent Skill with `name` matching its directory and a non-empty `description`; that its working copy carries no stamp; that staging stamps it and places it at `dist/templates/skills/setup-jen/SKILL.md`; that it appears in the tarball; that `jen init` writes it into a project and `jen update` refreshes it; that a stamped skill jen no longer ships is still deleted with a seventh member present.

**Not testable here, and reviewed instead:** that the skill actually confirms before overwriting a conflicting registry entry, that it reports rather than creates a status, that its report distinguishes "already correct" from "just done". These are properties of an agent following instructions. They are specified in `project-binding` because they are the contract; they are verified by reading the skill and by running it, which is test-task's job, not a unit test's.

No attempt is made to fake the second group with assertions on the skill's wording. A test that greps `SKILL.md` for the word "confirm" proves nothing and breaks on every edit.

### `setup-jen` joins the existing variable set, which is renamed

The set becomes `skills` with seven members, declared as a single list named for what it holds. No second list records which of them are stages.

Every existing consumer of `STAGE_SKILLS` wants the skills jen ships, not the pipeline's stages. The help text counts what `init` writes into a project; the tests assert that each shipped skill is written, stamped, tracked, valid as an Agent Skill, and obstructed by a symlinked ancestor. None of them asks which skills a status triggers. The help text is where keeping the old list would have been actively wrong rather than merely redundant: it would report six while `init` wrote seven.

Stage-ness is a workflow fact and already has two homes — the stage table in `AGENTS.md` and the `task-pipeline` capability. Recording it a third time in the payload declaration buys nothing and costs what `cli/AGENTS.md` already warns about: two statements of the file list are how the two drift.

*Alternative rejected — a second variable set.* Two sets declaring `.claude/skills` would derive the same `memberShape` and return identical `reconcileCandidates`, so one stamped orphan would be appended to `plan.deletions` once per set: a duplicated line in the run's report and a second `unlink` of a path already gone. Nothing in the current code guards against it, because until now there has only ever been one set. The `managed-payload` delta now forbids it outright rather than leaving it as a trap for whoever adds the next set.

*Alternative rejected — declare it a fixed path.* Fixed paths carry no stamp and are never deletion candidates, which is right for root `AGENTS.md` (jen always writes it) and wrong here: `.claude/skills/` is shared with the project and with OpenSpec, so a skill jen stops shipping must be removable, and removal is the stamp.

### Statuses: exact names, case folded, nothing else

The skill compares the team's statuses against the eight the workflow names, folding case and trimming surrounding whitespace, and treats any other difference as a different status. `In Design` matches `in design`; it does not match `In-Design`, `Design`, or `Designing`.

The line is drawn there deliberately. Every step past case folding is synonym matching, and synonym matching is the status map re-entering through the back door — the thing the proposal rejected. A near-miss the skill declines to accept costs the user one rename; a near-miss it silently accepts costs a stage a failed transition at run time, somewhere else entirely.

The skill cites the workflow document's stage table as the authority for the list rather than becoming a second copy of it, consistent with `stage-conventions` forbidding a skill from restating a shared convention. It enumerates them for legibility, but the table is what governs.

### A missing status does not abort the run

Recording the tracker and creating the labels do not depend on the statuses being complete, so the skill does all three and reports on all three. A run that finds `In Testing` missing still writes the registry and still creates `task`.

This is what makes the re-run cheap: the user adds the status, runs the skill again, and the second run finds the registry and labels already correct and the statuses now satisfied. The alternative — abort on the first missing status — turns one gap into a run that has to be repeated from the top, and makes the order of the checks matter.

### The registry is edited in place, not regenerated

`registry.yaml`'s stub is mostly comments documenting the resource shape. A YAML load-and-dump would strip them and reformat what it kept, which is a poor trade for filling in one list. The skill edits the `resources:` entry textually, leaving the surrounding comments intact.

This is natural for an agent with an editor and would be perverse for a program, which is another reason binding is a skill. `resources: []` is what "nobody has filled this in" looks like; the shape written matches the example the stub itself documents.

### Re-runnability needs no state, for the same reason the payload needs none

The tracker's statuses and labels, and the registry's contents, are the record of what a previous run did. Nothing needs to be written down to make the next run correct. `managed-payload` already forbids a state file for the payload's sake, and adding one here for binding's sake would undo that for no gain.

## Risks / Trade-offs

- **The eight status names drift between `AGENTS.md`'s table and the skill's prose.** → The skill names the table as the authority and enumerates only for readability. A drift is then a legible contradiction inside one shipped payload rather than two plausible sources.
- **Case folding hides a genuine near-miss.** → Accepted, and bounded: only case and surrounding whitespace are folded. Everything else is reported as missing, which fails toward the user's attention rather than toward a broken transition later.
- **Renaming the variable set and its member list touches six test files.** → Mechanical, and the compiler finds every import; `payload.test.ts` additionally looks the set up by name and asserts the six names literally, so it needs reading rather than renaming.
- **A project that adopted jen before this release has no `setup-jen`.** → That is what `jen update` is for. Deletion is the stamp intersected with the shipped payload, so an added member needs no migration — the next update writes it.
- **The skill is user-invoked and attended, but nothing structurally prevents an unattended stage from invoking it.** → No status triggers it and it is absent from the pipeline table, so no stage reaches it by the mechanism stages use. Left as a convention rather than an enforced boundary.

## Migration Plan

None. The change is additive to the payload: `jen update` writes the new skill into an installed project on the next release, and no existing file changes shape.

The change carries a changeset declaring a minor bump — it ships a new skill to adopters. `release-pipeline` makes a changeset optional in the sense that its absence is not a failure, but a payload addition nobody can install is not the intent.
