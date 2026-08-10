## Why

`jen init` leaves a project with the workflow installed but bound to nothing. `registry.yaml` is a stub, and nothing has checked that the tracker the stages drive actually holds the statuses and labels they name. The failure surfaces at the worst moment and in the least legible way: `refine-epic` asking for a team it cannot find, or `design-task` moving a task to a status that does not exist, halfway through a run.

Binding a project needs judgment, a conversation, and credentialed access to a tracker — all three of which `jen init` deliberately refuses to have. The CLI is a deterministic file manager with no API client, no prompt loop, and nothing to authenticate with, and that is worth keeping. So the other half of adoption goes where the Linear MCP already is: a skill, shipped with the payload, run by the user once after `jen init`.

## What Changes

- **A new shipped skill, `setup-jen`**, installed by `jen init` to `.claude/skills/setup-jen/SKILL.md` and run by the user afterward. It:
  - confirms it can reach the tracker at all, and says so plainly when it cannot, rather than failing further in;
  - identifies the Linear team and project this repository's work is tracked in, confirming with the user rather than inferring silently;
  - verifies the team carries every status the pipeline names, reporting precisely which are absent;
  - ensures the `epic` and `task` labels exist, creating any that do not;
  - writes the tracker resource into `registry.yaml` in the shape the stages read;
  - is safe to re-run, reporting what is already correct instead of duplicating it.

- **Statuses are verified, never created and never mapped.** The Linear MCP exposes no mutation for workflow states — it can read them and can create labels, but there is no create or update for a status. The alternatives were a raw GraphQL path needing an API key, which reintroduces the credential jen has avoided, or recording a per-project mapping from jen's status names onto whatever a team already calls them, which is inert unless every stage resolves its status names through `registry.yaml` at every transition. Both were rejected. A project's tracker is configured to jen's statuses; jen does not adapt to the project's. The skill's job at that boundary is to report the gap exactly, not to close it.

- **The payload's variable set stops being "the six stage skills"** and becomes the skills jen ships, of which six are stages. The set is extended rather than split: two variable sets sharing `.claude/skills` would derive the same member shape and the same reconciliation candidates, so a stamped orphan would be counted for deletion once per set.

Not in scope, and deliberately: no change to the six stage skills or to `AGENTS.md`; no verification that the team has cycles or estimates enabled, though `refine-epic` uses both; no support for a tracker other than Linear; and no adoption documentation, which is ENG-162's.

## Capabilities

### New Capabilities

- `project-binding`: what it means for an installed project to be bound to its tracker — what must be verified before the pipeline can run, what the setup step may create and what it may only report, what it records in `registry.yaml`, and why re-running it is safe.

### Modified Capabilities

- `managed-payload`: the variable set is the skills jen ships rather than the six stage skills specifically; a shipped skill need not be a stage.
- `npm-package`: staging places the shipped skills at `dist/templates/skills/<name>/SKILL.md`, no longer a fixed count of six.
- `repo-layout`: a fresh clone yields every shipped skill working without a build, not the six stage skills specifically.

## Impact

- `cli/payload.ts` — the variable set's name and membership; `STAGE_SKILLS` stays the six stages, with the shipped set derived from it plus the setup skill.
- `cli/cli.ts` — the help text counts stage skills.
- `.claude/skills/setup-jen/SKILL.md` — new, and jen's own working copy, so unstamped.
- `test/` — `payload`, `stage-payload`, `repo-layout`, `package`, `cli`, and `install` all assert against the set's name or its count.
- No change to `AGENTS.md`, the stage skills, `scaffold/`, or the install and reconcile logic in `plan.ts`/`apply.ts`.
