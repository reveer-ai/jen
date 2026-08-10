## 1. The payload declaration

- [ ] 1.1 In `cli/payload.ts`, keep `STAGE_SKILLS` as the six pipeline stages and add a list of every skill the payload ships — the stages plus `setup-jen` — as the source of the variable set's members.
- [ ] 1.2 Rename the variable set from `stage-skills` to `skills` and build its members from the shipped list, leaving `targetDir`, `memberShape`, and the stamping rule untouched.
- [ ] 1.3 Update `cli/cli.ts`'s help text, which counts stage skills, so it describes what the payload writes without claiming the skills and the stages are the same list.

## 2. The skill

- [ ] 2.1 Write `.claude/skills/setup-jen/SKILL.md` with frontmatter whose `name` is `setup-jen` and whose `description` states when to use it, following the shape of the existing stage skills. No `metadata` key — staging inserts the stamp and refuses a file that already carries one.
- [ ] 2.2 Cover reaching the tracker: confirm access before changing anything, and on failure report what is missing and stop having changed nothing.
- [ ] 2.3 Cover identifying the team and project: confirm with the user rather than inferring, ask when there is no candidate, and never create a team or project.
- [ ] 2.4 Cover the statuses: compare against the workflow document's stage table plus `Backlog` and `Todo`, folding case and surrounding whitespace only; report exactly which are missing; create, rename, and map nothing; and do not report the project ready while any is absent.
- [ ] 2.5 Cover the labels: ensure `epic` and `task` exist, creating only what is absent and altering nothing that exists.
- [ ] 2.6 Cover the registry: edit `resources:` in place so the stub's comments survive, write the resource shape the stub documents, and confirm with the user before replacing an entry that names a different tracker.
- [ ] 2.7 Cover the run's report: distinguish what was already correct from what this run did, and end with what remains outstanding so a re-run resumes.

## 3. Tests

- [ ] 3.1 Update `test/payload.test.ts` for the set's new name and membership, and assert the rule the `managed-payload` delta adds: no two variable sets declare the same target directory.
- [ ] 3.2 Update `test/repo-layout.test.ts` to assert every shipped skill — not the six stages — is present, tracked, valid as an Agent Skill, and unstamped in the working copy.
- [ ] 3.3 Update `test/stage-payload.test.ts` for a staged tree holding one directory per shipped skill, each with a stamped `SKILL.md`.
- [ ] 3.4 Update `test/package.test.ts` so the tarball assertions cover the new skill in both directions — what must be there and what must not.
- [ ] 3.5 Update `test/cli.test.ts` and `test/install.test.ts` where they iterate `STAGE_SKILLS` to reach every installed skill instead.
- [ ] 3.6 Confirm reconciliation still deletes a stamped skill the payload does not ship with a seventh member present, and still spares the `openspec-*` skills sharing the directory.

## 4. Release and close-out

- [ ] 4.1 Add a changeset declaring a minor bump, describing the new skill in terms an adopter reading `CHANGELOG.md` can act on.
- [ ] 4.2 Run `npm test` and `npm run typecheck` and fix what they catch.
- [ ] 4.3 Record in `cli/AGENTS.md` that the shipped skills and the pipeline's stages are now different lists, and why a second variable set over `.claude/skills` is forbidden — the double-counted deletion candidate is not obvious from reading `plan.ts`.
- [ ] 4.4 Run `openspec validate eng-160-jensetup-skill-bind-a-project-to-linear --strict` and resolve anything it reports.
