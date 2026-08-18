## Why

The stages do their pull-request work through the tracker's diff tools, and those tools return nothing to the identity an unattended run will hold. Linear's diffs come from its GitHub integration, which links a Linear *user* to a *GitHub account*; an app user has no GitHub account to link, so `list_diffs` is empty and `get_diff` is "not found" for pull requests a human token reads fine. This is structural — no scope widens it.

The tools still appear in `tools/list` under every token, so nothing fails loudly. A dispatched review reads no threads, anchors no comments, and submits no verdict, and the run looks like it worked. That is not a theoretical risk: this task's own review had to be posted through `gh` because the instructed tools could not carry it.

This is the last piece of ENG-166's scope, added after the rest shipped in `1280f80`. ENG-141's merge gate is explicitly blocked on it — the approving-review count stays at `0` while no stage can submit a verdict, because a gate nothing can satisfy leaves the human bypass as the only way to merge.

## What Changes

- **Pull-request work moves to `gh` in every stage that does any.** Reading threads (`design-task`), anchoring comments and submitting a verdict (`review-task`, `test-task`), and replying to and resolving a thread (the shared Threads convention) stop naming the tracker's diff tools and name the git host's client instead.
- **Issue work does not move.** Status, comments, and artifact attachments stay on the tracker, where an app identity works correctly. The split is the point: the tracker owns the task, the host owns the pull request.
- **The commands are named, not implied.** Resolving a thread exists only as the GraphQL `resolveReviewThread` mutation, and a review carrying inline comments has to be posted as a JSON body to `/pulls/{n}/reviews` — neither is reachable from `gh --help`, and an unattended run cannot afford to rediscover them by trial.
- **A review verdict checks authorship before it picks its event.** GitHub refuses `APPROVE` and `REQUEST_CHANGES` from a pull request's own author, so a stage compares the PR's author to the authenticated user and falls back to a `COMMENT` review carrying the verdict in its body when they match. The comparison is an equality test on two values the host reports, never a parse of an error string — a network fault and a self-review refusal are indistinguishable from the message alone.
- **`AGENTS.md`'s claim that the tracker can review and merge is corrected.** The "One PR per task" convention currently explains that the tracker's tools can do everything to a pull request *except* create it. Under an agent identity the truth is the inverse.
- **A guard in the payload tests**, scoped to the skills jen ships and the root workflow document, so a reintroduced diff-tool call fails a check rather than waiting for an unattended run to swallow it.
- **The permissions section corrects a claim it makes about itself.** It states that a project's own check commands are not among the ones jen writes, one line after stating that jen writes the standard `npm run` script names. Both cannot be true, and the same wording is in the `adoption-docs` spec, so the two move together. Its example is a whole file that drops those entries, so a reader on another stack who copies the shape loses permissions the section exists to establish — a failure that surfaces as denials mid-run rather than as an error.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `stage-conventions`: adds the division between the git host and the tracker, and how a review verdict is recorded when the reviewer is also the author; modifies the one-PR requirement, whose current wording asserts the tracker can review and merge.
- `adoption-docs`: modifies the permissions requirement, which states that the project's own check commands are never among the ones jen writes. Since ENG-166 also made `jen init` write the standard `npm run` names, that is now false for an npm project and silent for everyone else.

## Impact

- **`AGENTS.md`** — the Threads convention and the "One PR per task" convention.
- **`.claude/skills/design-task/SKILL.md`, `review-task/SKILL.md`, `test-task/SKILL.md`** — the three skills that name diff tools. `implement-task` and `deliver-task` name none and inherit the change through the shared conventions.
- **`openspec/specs/stage-conventions/spec.md`, `openspec/specs/adoption-docs/spec.md`** — via the deltas.
- **`README.md`** — section 4, the permissions section this task wrote and got wrong.
- **`test/payload.test.ts`** — one guard alongside the existing tooling-floor test.
- **In flight: ENG-141.** Its branch adds `.claude/skills/AGENTS.md`, which names these same tools deliberately, in order to explain that they are inert under an agent identity — so the guard is scoped to the shipped skills rather than grepping the tree, or ENG-141 can never pass it. Both branches also edit the root `AGENTS.md`; whichever merges second resolves the overlap.
- **Downstream: ENG-141's merge gate.** Unblocked by this, not done here.
