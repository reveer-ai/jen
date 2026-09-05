## 1. The retired path

- [ ] 1.1 Add `{ kind: 'retired'; target: string }` to `PayloadGroup` in `cli/payload.ts`, with an accessor giving the retired targets. Leave `payloadFiles()` and `stagedFiles()` returning only files that are written, so staging, installation, and the stamp rule are untouched.
- [ ] 1.2 Plan retired paths in `cli/plan.ts`: for each declared target, push to `plan.obstructions` where `symlinkedAncestor` answers, skip anything that is not a regular file, skip an absent path silently, and otherwise append to `plan.deletions`. Retire the doc comment on `Plan.deletions` that says the stamp is the only ground.
- [ ] 1.3 Assert the declaration in `test/payload.test.ts`: a path declared both shipped and retired is rejected, in the same shape as the existing one-set-per-target-directory assertion.
- [ ] 1.4 Cover the guards in `test/plan.test.ts`: a retired path present is planned for deletion; absent is silent; an unstamped file at one is still deleted; a directory at one is left alone; a symlinked ancestor obstructs rather than deleting. Add an `test/install.test.ts` case proving `jen update` actually removes the file end to end.

## 2. Removing the workflow

- [ ] 2.1 Delete `payload/jen.yml`, drop its fixed-path declaration from `PAYLOAD`, and declare `.github/workflows/jen.yml` as the first retired path.
- [ ] 2.2 Delete `test/scheduled-workflow.test.ts`.
- [ ] 2.3 Confirm nothing else in the repository still writes, reads, or asserts the workflow — including `scripts/stage-payload.js` and `test/stage-payload.test.ts`, whose expectations are derived from the declaration and should follow it without editing.

## 3. Removing write-time substitution

- [ ] 3.1 Delete `substitute`, `PLACEHOLDER`, and `ManagedFile.substituted` from `cli/payload.ts`; move `SUBSTITUTIONS` and `SubstitutionName` to `cli/registry.ts` and update `watch.ts` and `registry.ts` to import them from there.
- [ ] 3.2 Delete the substitution branch in `cli/plan.ts`, together with `Plan.unresolved` and the `Unresolved` type, and the unresolved-value report in `cli/cli.ts`.
- [ ] 3.3 Leave `resolveFromRegistry` and every runner-side reader intact. Confirm `test/registry.test.ts` and `test/watch.test.ts` still pass unchanged — if either needed editing, the removal reached further than intended.

## 4. One runner, in the code and its prose

- [ ] 4.1 Rename the runner in `cli/` — `watch.ts`'s module comment, `cli.ts`'s help and usage text, and every comment describing the pair. `jen watch` keeps its name; this is prose only.
- [ ] 4.2 Confirm `resolveIdentity` and `impossible()` in `cli/watch.ts` already refuse an unresolvable team or project, naming what is absent and the checkout read. Add what is missing; add no new mechanism if nothing is.
- [ ] 4.3 Remove the post-binding refresh step and the disabled-schedule check from `.claude/skills/setup-jen/SKILL.md`, and anything else in the shipped skills describing the scheduled runner.

## 5. Adopter documentation

- [ ] 5.1 `README.md` ownership table: drop the workflow row and the claim that it is the one managed file outside `.claude/` and the root.
- [ ] 5.2 `README.md` environment passthrough: delete the scheduled-runner caveat, and state the mechanism unconditionally.
- [ ] 5.3 `README.md` runner chapter: one runner rather than a pair. Keep that the git host is still required; state that a runner jen does not ship is equally valid and that a scheduled git-host job is one; say why jen stopped shipping that one; supply no workflow file or example. Move the runner's own conditions — a session dying with its process, a hung session hanging the loop — into the chapter, and drop the schedule-disabled failure mode.
- [ ] 5.4 Update `test/adoption-docs.test.ts` to match: the workflow-ownership assertion, `says which runner the passthrough is available on today`, `presents both runners with what distinguishes them`, and `says the local runner does not remove the git host`. Add an assertion that the README supplies no Actions workflow example.

## 6. Release

- [ ] 6.1 Write the changeset as a **minor** bump (`0.3.x` → `0.4.0`), leading with the required action: updating deletes `.github/workflows/jen.yml`, and an adopter who ran the pipeline on it has no runner until they start one.
- [ ] 6.2 File the follow-up task for a liveness bound on the runner, referencing the `pipeline-runner` removal note that records the gap.

## 7. Verification

- [ ] 7.1 Run the full suite and the type check.
- [ ] 7.2 `openspec validate eng-188-remove-the-scheduled-git-host-runner-leaving-one-runner --strict`.
- [ ] 7.3 Prove the migration by hand: install a `0.3.x` payload into a scratch project, update to this build, and confirm `.github/workflows/jen.yml` is gone, the deletion was reported, and a sibling file in `.github/workflows/` is untouched.
