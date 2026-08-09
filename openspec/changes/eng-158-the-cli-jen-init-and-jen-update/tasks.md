## 1. Extend the declaration

- [ ] 1.1 Add a `SCAFFOLD` declaration to `cli/payload.ts` for `registry.yaml` and `.claude/settings.json` — same `ManagedFile` shape, separate from `PAYLOAD`, with no stamping and no reconciliation
- [ ] 1.2 Expose each variable set's member shape (the path relative to `targetDir`), so reconciliation can derive candidate locations instead of hardcoding `SKILL.md`
- [ ] 1.3 Author the scaffold content: a `registry.yaml` stub whose unfilled state is distinguishable from a filled-in registry, and a `.claude/settings.json` seeded with the stages' permissions
- [ ] 1.4 Stage the scaffold in `scripts/stage-payload.js` under a role-named path, unstamped; assert staging still refuses a JSON file in a variable set
- [ ] 1.5 Update `test/stage-payload.test.ts` and `test/package.test.ts` for the new staged tree, keeping `npm-package`'s "exactly six skill directories" and "no assistant-named path" assertions intact

## 2. Read the project

- [ ] 2.1 Resolve the staged payload from the module (`new URL('./templates/', import.meta.url)`), with a clear failure when it is absent — the git-URL install case
- [ ] 2.2 Implement stamp detection as a frontmatter scan for `metadata.jen: true`, reusing the frontmatter-scanning approach already in `test/helpers.ts`
- [ ] 2.3 Unit-test detection against: a stamped skill, an unstamped skill, no frontmatter, unterminated frontmatter, a `metadata` block without `jen`, and flow-style `metadata: {jen: true}` (asserted unrecognized, per design)
- [ ] 2.4 Enumerate reconciliation candidates from each variable set's declared shape, one level under `targetDir`, and unit-test that deeper and sibling paths are never candidates

## 3. The planner

- [ ] 3.1 Define the plan: paths to write, paths already current, paths to delete, scaffold to create, and fixed-path conflicts
- [ ] 3.2 Plan payload writes, classifying each path as write or already-current by comparing staged bytes against disk
- [ ] 3.3 Plan deletions — stamped, inside a declared target directory, absent from the shipped payload
- [ ] 3.4 Plan scaffold creation for absent paths only, and never for existing ones regardless of `--force`
- [ ] 3.5 Detect fixed-path conflicts: the path exists and differs from what is shipped
- [ ] 3.6 Assert the planner performs no writes — a test that plans against a fixture and verifies the tree is byte-identical afterward

## 4. The executor

- [ ] 4.1 Apply a plan: create directories, write files, delete reconciled paths
- [ ] 4.2 Report completed paths when a write fails partway, then exit non-zero without attempting rollback
- [ ] 4.3 Verify the executor writes nothing outside the plan it was given

## 5. OpenSpec delegation

- [ ] 5.1 Resolve the OpenSpec binary via the bare specifier, walking up to the package root for `bin.openspec` — `@fission-ai/openspec/package.json` is not exported and will throw
- [ ] 5.2 Spawn `openspec init --tools claude --no-animation --force` with `process.execPath`, cwd set to the target project, only when `openspec/` is absent
- [ ] 5.3 Report a non-zero exit from OpenSpec as a jen failure, naming the command that failed
- [ ] 5.4 After initialization, check whether the OpenSpec CLI resolves from the project and report the exact install command when it does not

## 6. The commands

- [ ] 6.1 Parse arguments: optional project path defaulting to the working directory, `--force` on `init`, and `--help` / `--version` unchanged
- [ ] 6.2 Wire `jen init` — plan, refuse on conflict without `--force`, otherwise execute with scaffold and OpenSpec initialization
- [ ] 6.3 Wire `jen update` — plan and execute without scaffold, refusal, or OpenSpec initialization
- [ ] 6.4 Render the plan as the run's report: written, refreshed, removed, unchanged; results to stdout, failures to stderr, exit non-zero on failure or refusal
- [ ] 6.5 Report any managed path the project's ignore rules exclude, via `git check-ignore`, skipping silently when git or the repository is absent
- [ ] 6.6 Remove the "not implemented yet" stubs and the payload-declaration-only paragraph from `USAGE` in `cli/index.ts`

## 7. The messy fixture

- [ ] 7.1 Build a fixture project that diverges deliberately: a project-authored skill beside managed ones, a hand-edited managed skill, a stamped skill this version no longer ships, a copied skill with its stamp deleted, a stamped file outside any target directory, and an `AGENTS.md` of the project's own
- [ ] 7.2 Init on an empty project: payload written, scaffold created, OpenSpec initialized, exit zero
- [ ] 7.3 Init on the fixture: refused, exit non-zero, and assert the tree is byte-identical afterward — no skill, no scaffold, nothing
- [ ] 7.4 Init with `--force` on the fixture: `AGENTS.md` replaced, `registry.yaml` and `.claude/settings.json` untouched
- [ ] 7.5 Update on the fixture: hand-edited skill restored, dropped skill removed, and the project's skill, the claimed copy, and the outside-the-boundary file all untouched
- [ ] 7.6 Update on a project that never ran init: payload written, exit zero, no missing-installation error
- [ ] 7.7 Idempotency: run each command twice and assert the second run reports nothing to do and changes no file's content or mtime
- [ ] 7.8 Non-interactivity: run both commands with stdin closed and assert neither blocks

## 8. Close out

- [ ] 8.1 Run the full suite, build, and typecheck
- [ ] 8.2 Record in `cli/AGENTS.md` what a future session would otherwise rediscover: the OpenSpec `exports` gotcha, and why the planner must stay write-free
- [ ] 8.3 `openspec validate eng-158-the-cli-jen-init-and-jen-update --strict`
