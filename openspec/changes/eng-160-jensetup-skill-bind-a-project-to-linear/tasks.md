## 1. The payload declaration

- [x] 1.1 In `cli/payload.ts`, replace `STAGE_SKILLS` with one list of every skill the payload ships — the six stages plus `setup-jen` — named for what it holds. Record nowhere in the declaration which of them are stages: nothing consumes it, and `AGENTS.md`'s stage table and the `task-pipeline` capability already say.
- [x] 1.2 Rename the variable set from `stage-skills` to `skills` and build its members from that list, leaving `targetDir`, `memberShape`, and the stamping rule untouched.
- [x] 1.3 Update `cli/cli.ts`'s help text to count the shipped skills rather than the stages — as written it would report six while `init` writes seven — and to describe them without implying every shipped skill is a stage.

## 2. The skill

- [x] 2.1 Write `.claude/skills/setup-jen/SKILL.md` with frontmatter whose `name` is `setup-jen` and whose `description` states when to use it, following the shape of the existing stage skills. No `metadata` key — staging inserts the stamp and refuses a file that already carries one.
- [x] 2.2 Cover reaching the tracker: confirm access before changing anything, and on failure report what is missing and stop having changed nothing.
- [x] 2.3 Cover identifying the team and project: confirm with the user rather than inferring, ask when there is no candidate, and never create a team or project.
- [x] 2.4 Cover the statuses: compare against the workflow document's stage table plus `Backlog` and `Todo`, folding case and surrounding whitespace only; report exactly which are missing; create, rename, and map nothing; and do not report the project ready while any is absent.
- [x] 2.5 Cover the labels: ensure `epic` and `task` exist, creating only what is absent and altering nothing that exists.
- [x] 2.6 Cover the registry: edit `resources:` in place so the stub's comments survive, write the resource shape the stub documents, and confirm with the user before replacing an entry that names a different tracker.
- [x] 2.7 Cover the run's report: distinguish what was already correct from what this run did, and end with what remains outstanding so a re-run resumes.

## 3. Tests

- [x] 3.1 Update `test/payload.test.ts` for the set's new name and membership — it looks the set up by `'stage-skills'` and asserts the six names literally, so it needs rewriting rather than renaming — and assert the rule the `managed-payload` delta adds: no two variable sets declare the same target directory.
- [x] 3.2 Update `test/repo-layout.test.ts` to assert every shipped skill — not the six stages — is present, tracked, valid as an Agent Skill, and unstamped in the working copy.
- [x] 3.3 Update `test/stage-payload.test.ts` for a staged tree holding one directory per shipped skill, each with a stamped `SKILL.md`.
- [x] 3.4 Update `test/package.test.ts` so the tarball assertions cover the new skill in both directions — what must be there and what must not.
- [x] 3.5 Update `test/cli.test.ts`, `test/install.test.ts`, and `test/plan.test.ts` where they iterate `STAGE_SKILLS` to reach every shipped skill instead — `plan.test.ts` builds the expected obstruction paths from it, so a missing seventh entry fails there rather than where the skill was added.
- [x] 3.6 Confirm reconciliation still deletes a stamped skill the payload does not ship with a seventh member present, and still spares the `openspec-*` skills sharing the directory.

## 4. Release and close-out

- [x] 4.1 Add a changeset declaring a minor bump, describing the new skill in terms an adopter reading `CHANGELOG.md` can act on.
- [x] 4.2 Run `npm test` and `npm run typecheck` and fix what they catch.
- [x] 4.3 Record in `cli/AGENTS.md` that the shipped skills and the pipeline's stages are now different lists, and why a second variable set over `.claude/skills` is forbidden — the double-counted deletion candidate is not obvious from reading `plan.ts`.
- [x] 4.4 Run `openspec validate eng-160-jensetup-skill-bind-a-project-to-linear --strict` and resolve anything it reports.
