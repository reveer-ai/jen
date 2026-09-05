## 1. Removing the workflow

- [x] 1.1 Delete `payload/jen.yml` and drop its fixed-path declaration from `PAYLOAD` in `cli/payload.ts`, including `WORKFLOW_TARGET` and the comment block explaining where it lands.
- [x] 1.2 Delete `test/scheduled-workflow.test.ts`.
- [x] 1.3 Confirm nothing else writes, reads, or asserts the workflow — including `scripts/stage-payload.js` and `test/stage-payload.test.ts`, whose expectations derive from the declaration and should follow it without editing. Confirm `format: 'yaml'` still has a member (`scaffold/registry.yaml`) before assuming it is dead.

## 2. Removing write-time substitution

- [x] 2.1 Delete `substitute`, `PLACEHOLDER`, and `ManagedFile.substituted` from `cli/payload.ts`; move `SUBSTITUTIONS` and `SubstitutionName` to `cli/registry.ts` and update every importer.
- [x] 2.2 Delete the `render` substitution branch, the `resolveFromRegistry` call, and the `Plan.unresolved` field from `cli/plan.ts`, and the unresolved-value report from `cli/cli.ts`.
- [x] 2.3 Keep `Unresolved` and `Resolution` in `cli/registry.ts` — `cli/watch.ts:115` iterates `registry.unresolved` to carry *why* a value is missing into the runner's refusal. They look like substitution's types and are the runner's.
- [x] 2.4 Confirm `test/registry.test.ts` and `test/watch.test.ts` still pass unchanged. If either needed editing, the removal reached further than intended.

## 3. One runner, in the code

- [x] 3.1 Rename the runner through `cli/` — `watch.ts`'s module comment and `DEFAULT_INTERVAL_SECONDS` doc, `cli.ts`'s help and usage text, and the two-runner reasoning in the comments at `run.ts:6`, `run.ts:271`, `run.ts:320`, `run.ts:554`, `exec.ts:14`, `exec.ts:606`, `exec.ts:907`, `stages.ts:7`, `cli.ts:420`, and `watch.ts:241`. `jen watch` keeps its name; this is prose only.
- [x] 3.2 Confirm `resolveIdentity` and `impossible()` in `cli/watch.ts` already refuse an unresolvable team or project, naming what is absent and the checkout read. Add what is missing; add no new mechanism if nothing is.

## 4. Contributor notes

- [x] 4.1 Delete the three `cli/AGENTS.md` sections that exist only for the workflow: *The shipped workflow's source is `payload/`, not `.github/workflows/`*, *Substitution renders empty, never the placeholder*, and *A job-level `if` cannot read the `env` context*.
- [x] 4.2 Rewrite *The local runner holds no lock, deliberately*. The conclusion survives — the tracker is the record and a restart re-establishes it — but the argument moves from *the other runner cannot see a lock* to *a second instance cannot*.
- [x] 4.3 Sweep the rest of `cli/AGENTS.md` for the two-runner framing (`:112`, `:245`, `:413`) and correct what is no longer true.
- [x] 4.4 Remove the post-binding refresh step and the disabled-schedule check from `.claude/skills/setup-jen/SKILL.md`, and the "same under both runners" phrasing at `:134`.

## 5. Adopter documentation

- [x] 5.1 `README.md` ownership table: drop the workflow row, and the paragraph at `:23` claiming it is the only managed file outside `.claude/` and the root.
- [x] 5.2 `README.md:263`: delete the paragraph saying `jen init` refuses a project holding its own `.github/workflows/jen.yml`. jen no longer owns that path, so there is nothing to refuse.
- [x] 5.3 `README.md` environment passthrough (`:102`): delete the scheduled-runner caveat and state the mechanism unconditionally.
- [x] 5.4 `README.md` runner chapter (`:136`–`:230`): one runner rather than a pair — the comparison table, both *Starting* sections, the disabled-schedule failure mode, the two-hour bound, and the "under both runners" phrasing. Keep that the git host is still required. State that a runner jen does not ship is equally valid and that a scheduled git-host job is one; say why jen stopped shipping that one; supply no workflow file or example. Move the runner's own conditions — a session dying with its process, a hung session hanging the loop — into the chapter.
- [x] 5.5 Update `test/adoption-docs.test.ts` to match: the workflow-ownership assertion, `says which runner the passthrough is available on today`, `presents both runners with what distinguishes them`, and `says the local runner does not remove the git host`. Add an assertion that the README supplies no Actions workflow example.

## 6. Release

- [x] 6.1 Write the changeset as a **minor** bump (`0.3.x` → `0.4.0`): the scheduled runner is gone and `jen watch` is the runner, plus one sentence telling anyone who installed an earlier version to delete `.github/workflows/jen.yml` by hand.
- [x] 6.2 File the follow-up task for a liveness bound on the runner, referencing the `pipeline-runner` removal note that records the gap. → ENG-189.

## 7. Verification

- [x] 7.1 Run the full suite and the type check.
- [x] 7.2 `openspec validate eng-188-remove-the-scheduled-git-host-runner-leaving-one-runner --strict`.
- [x] 7.3 Grep the whole repository for `jen.yml`, `scheduled`, `local runner`, `two runners`, and `both runners` outside `openspec/changes/archive/`, and confirm every survivor is either jen's own CI (`ci.yml`, `release.yml`) or a deliberate reference to a runner an adopter drives.
