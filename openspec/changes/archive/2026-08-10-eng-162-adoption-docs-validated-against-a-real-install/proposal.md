## Why

jen is installable today — `@reveer/jen@0.0.0` is public on the registry and `npx jen init` writes a working workflow into a fresh project — but nothing tells an adopter how to do that, what they are permitted to do with it, or which of the files that appear are theirs to edit. The README is a contributor guide, and npm publishes it as the package's front page regardless of `files`, so the first thing an adopter reads is jen's build notes. `package.json` declares `UNLICENSED`, which grants no rights to the working package anyone can already download.

Underneath the docs sits a model that no longer holds. The workflow document still says a project *forks* jen, and the `agent-instructions` capability still requires it to. Forking was superseded by the package the rest of this epic built, and the false statement lives in the very file jen ships into every project it governs.

## What Changes

**The repository model, stated correctly.** An adopted project installs jen into its own repository. jen owns the root — `AGENTS.md`, `.claude/`, `openspec/`, `registry.yaml` — and `src/` holds what would conventionally sit at the repository root: the project's own sources, tracked. jen's own repository gitignores `src/` because jen governs no sources of its own; that is jen's arrangement and not a rule adopters inherit, and jen never writes a `.gitignore` to impose one.

- Root `AGENTS.md` drops the fork model in the two places it states it outright and the two places it assumes it. jen does not fork; it installs.
- `scaffold/registry.yaml` — the stub every adopter receives — stops teaching the hub model. Its example currently shows a separate repository cloned to `path: src/acme-web`, which is exactly the arrangement `AGENTS.md` opens by denying.

**Adoption documentation that has been followed.** The README becomes the adopter's document, leading with the ownership boundary, because someone who hand-edits a managed skill loses it on the next `jen update` and needs to know that beforehand. Contributor material moves to `CONTRIBUTING.md`.

- The documented path is executed end to end against a scratch project — pack, install, `jen init`, `setup-jen`, edit a managed file, `jen update` — and whatever the docs got wrong is fixed from what actually happened. A README that has never been followed is a guess.
- Documentation states that the workflow reaches Claude Code today, and that another assistant is a project-side symlink to `.claude/skills` rather than something jen writes.

**A license, deliberately chosen.** Apache-2.0, confirmed on the issue ahead of design: it carries an explicit patent grant and a contributor-licensing clause that MIT does not, and jen is published by a company rather than by an individual. `package.json` declares it and a `LICENSE` file ships in the tarball.

**Discoverability.** `package.json` gains `keywords`; it has none, so the package cannot be found by search.

## Capabilities

### New Capabilities

- `adoption-docs`: what the project's documentation must tell an adopter — the ownership boundary before anything else, the install-through-update path, the assistants the payload reaches — and the requirement that the path has been executed rather than only written. Also fixes where contributor material lives, so that the page npm publishes serves the person installing rather than the person building.

### Modified Capabilities

- `agent-instructions`: the requirement mandating that `AGENTS.md` state a fork-based repository model is replaced by one stating the installed model, including what `src/` holds and that the root is jen's. Scenarios phrased around forking are restated.
- `repo-layout`: `src/` means the same *location* in jen and in an adopted project but not the same tracked-ness — an adopter's sources are tracked, and jen's own `src/` is ignored because it holds nothing of jen's. The current requirement asserts the meaning is identical, which is the sentence that made the model ambiguous.
- `repo-scaffold`: the registry stub's example must describe an adopted project's own sources under `src/`, not a separate repository checked out there.
- `npm-package`: package identity gains a declared license and `keywords`; a `LICENSE` file is required in the published tarball.
- `openspec-integration`: the single-`openspec/` requirement is stated in terms of a project rather than a fork.

## Impact

- **Docs** — `README.md` rewritten adopter-first; `CONTRIBUTING.md` added, carrying what the README sheds; root `AGENTS.md` amended.
- **Package** — `package.json` gains `license: "Apache-2.0"` and `keywords`; `LICENSE` added at the repository root. npm includes `LICENSE` and `README.md` in a tarball regardless of `files`, so no packaging change is needed — but this is verified in the same real-install pass rather than assumed.
- **Scaffold** — `scaffold/registry.yaml`'s example. Nothing in this repository reads it, so the error is invisible here and only surfaces in an installed project; `test/payload.test.ts` already guards the one property it can check by construction.
- **Tests** — `test/package.test.ts` extends to the license field, the `LICENSE` and `README.md` tarball entries, and `keywords`.
- **Release** — a changeset, since this changes the published package's metadata and its front page.
- **Estimate** — the task was sized at 2 points before it absorbed the licensing decision and before design found the repository-model contradiction. The work now spans five spec deltas, two rewritten documents, and a full adoption run. Flagged rather than silently re-scoped.

**Not in scope.** Migrating an existing project onto jen: `jen init` refuses a project that already holds a differing `AGENTS.md`, and `project-install` records that refusal as an unsupported adoption rather than a defect. The docs state the limit; they do not lift it.
