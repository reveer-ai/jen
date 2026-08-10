## 1. The repository model

Everything else describes this, so it settles first.

- [x] 1.1 Rewrite the two passages in root `AGENTS.md` that state the fork model — the "template every project forks from" opener and the "A project starts as a fork" paragraph — as the installed model: a project installs jen into its own repository, the root is jen's (`AGENTS.md`, `.claude/`, `openspec/`, `registry.yaml`), and `src/` holds the project's own tracked sources where a repository root would conventionally hold them. Keep the monorepo point; it never depended on forking.
- [x] 1.2 Replace "the same monorepo fork" in the Linear-projects-aren't-1:1 line, and change the notes convention's reason from "shared with every fork" to the file being replaced wholesale on the next update. The rule itself does not change — only why it holds.
- [x] 1.3 Re-read the amended `AGENTS.md` end to end for any remaining passage that assumes forking or a separate sources repository. `CLAUDE.md` is a symlink to it and needs no edit.
- [x] 1.4 Correct `scaffold/registry.yaml`'s example: one resource, the project itself, sources at `src/` in this same repository. Remove the `path: src/acme-web` shape, which depicts a separately cloned repository and teaches the hub model `AGENTS.md` opens by denying.

## 2. Package metadata and the license

- [x] 2.1 Add the stock Apache-2.0 text as `LICENSE` at the repository root, with the appendix copyright line filled in for Reveer. No `NOTICE` file — there is no third-party attribution to carry, and an empty one would propagate to every downstream fork.
- [x] 2.2 Set `license` to `Apache-2.0` in `package.json`, replacing `UNLICENSED`.
- [x] 2.3 Add `keywords` to `package.json` — the terms someone looking for this kind of tool would search, not an exhaustive list.

## 3. Tests for what is mechanically checkable

Written before the docs, so the docs are drafted against assertions that already hold.

- [x] 3.1 In `test/package.test.ts`, assert `license` is a non-`UNLICENSED` SPDX identifier and `keywords` is present and non-empty, beside the existing manifest assertions.
- [x] 3.2 Assert `LICENSE` exists at the repository root and names the license `package.json` declares.
- [x] 3.3 Extend the packed-tarball assertions to require `LICENSE` and `README.md` as entries. These are npm's always-included files rather than anything `files` selects, so the assertion is what stops a future `files` change from being trusted to control what ships.
- [x] 3.4 Run `npm run build && npm run typecheck && npm test` and confirm green before the docs are written.

## 4. The documentation split

- [x] 4.1 Create `CONTRIBUTING.md` carrying the current README's `## Working on jen`, `## Checks`, and `## Packaging` sections, unchanged in substance. Link to `cli/AGENTS.md` and `.github/AGENTS.md` rather than restating what they hold.
- [x] 4.2 Add the adoption-run ritual to `CONTRIBUTING.md` — pack, install from the tarball, init, bind, edit a managed file, update — so the run is repeatable rather than remembered. State why it is packed rather than run from the working tree: `prepack` stages the payload, so a working-tree run proves nothing about what ships.
- [x] 4.3 Rewrite `README.md` as the adopter's document. Lead with what jen is, then the ownership boundary as a table — replaced wholesale, written once, never jen's — before any install command, including that deleting a file's `metadata.jen` stamp claims it for the project.
- [x] 4.4 Document the path in order: install, `jen init`, the `setup-jen` skill, `jen update`. Give each as the command an adopter runs, and mark binding as the user's step that no command performs, since the CLI holds no tracker client.
- [x] 4.5 State that jen writes `.claude/` only, and that another assistant is a project-side symlink to `.claude/skills` that jen neither creates nor reads.
- [x] 4.6 State what adoption does not cover: `jen init` refuses a project already holding a differing root `AGENTS.md`, writes nothing when it does, and `--force` replaces the file wholesale. An adopter meeting the refusal should recognize it from the README as a stated limit.
- [x] 4.7 Link `README.md` to `CONTRIBUTING.md` for anyone arriving to change jen rather than to use it.

## 5. The adoption run

Against the packed tarball, in a scratch project that has never held jen. Findings correct the docs; this is the task, not a follow-up.

- [x] 5.1 `npm pack`, then in a fresh directory: `git init`, `npm init -y`, install the tarball, and run `npx jen init`. Confirm the payload lands — root `AGENTS.md`, the seven skills stamped, `registry.yaml`, `.claude/settings.json` — and that OpenSpec's own skills are written beside them.
- [x] 5.2 Run the `setup-jen` skill against the real `eng` team. Every check should report already-satisfied and nothing should be created: the labels and all seven statuses already exist, which is what makes this run read-only on the tracker. The only write is the scratch project's `registry.yaml`.
      *Performed as the skill's checks rather than as an attended invocation of it — implement-task runs unattended and the skill confirms with a user before recording. All eight statuses (`backlog`, `todo`, `in design`, `in progress`, `in review`, `in testing`, `in delivery`, `done`) and both labels (`epic`, `task`) were read back already present; nothing was created, renamed, or deleted on the tracker, and the scratch `registry.yaml` took the binding entry.*
- [x] 5.3 Read the scratch project's `registry.yaml` and root `AGENTS.md` as an adopter receives them, and confirm neither teaches the hub model. This is the check no test can perform — nothing in jen's repository reads `scaffold/`.
- [x] 5.4 Edit a managed skill, run `npx jen update`, and confirm the edit is gone — the boundary the README leads with, demonstrated rather than asserted.
- [x] 5.5 Confirm `LICENSE` and `README.md` are present in the installed package under the scratch project's `node_modules`, closing the loop from tarball assertion to what an adopter actually receives.
- [x] 5.6 Correct `README.md` and `CONTRIBUTING.md` from whatever the run actually did. A step that behaved differently from its description is a documentation defect and is fixed here; a step that revealed a *behavioral* defect is a separate task, and the docs describe what jen does today.
      *Two corrections. (1) The draft claimed that deleting a managed file's `metadata.jen` stamp claims it for the project. It does not: `planInstall` writes every payload file to its declared target unconditionally, and the stamp is read only when reconciling orphans. The run confirmed it — an unstamped `design-task/SKILL.md` was rewritten and re-stamped by `jen update`, while an unstamped skill jen never shipped was left alone. The README now states what the stamp actually governs, `specs/adoption-docs/spec.md` was corrected in the same way, and `test/plan.test.ts` now asserts it. See the note on the PR: the design assumed the behavior, so whether jen* should *honor unstamping is a question for a separate task, not something decided here. (2) The symlink command failed verbatim because the assistant's directory did not exist; it now creates it.*

## 6. Close out

- [x] 6.1 Add a changeset. This changes shipped payload — root `AGENTS.md` and the scaffold — and the published package's metadata and front page, so it has something to tell an adopter.
- [x] 6.2 Run `npm run build && npm run typecheck && npm test` and `openspec validate eng-162-adoption-docs-validated-against-a-real-install --strict`, both green.
- [x] 6.3 Record in `cli/AGENTS.md` anything the run taught that a future session would otherwise rediscover — only if it clears the bar. The scaffold blind spot is already written there; extend it rather than restating it, and skip this if the run turned up nothing new.
