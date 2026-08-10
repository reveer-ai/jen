## Why

jen is adopted by forking. Forking carries the workflow into a project but cannot carry updates back out: pulling upstream jen into a diverged project means merging unrelated histories, with permanent conflicts in the one file both sides edit (`AGENTS.md`). It also drags jen's history into every project and makes the GitHub fork relationship — PR default targeting, forks-of-forks — actively wrong.

The fix is to publish jen as an installable package, but nothing can be built until the repo is something npm can publish. This change is that groundwork: it settles the package's identity, its build, and — most importantly — the explicit declaration of which files jen owns. Under forking every file was mutable and every file was jen's; a package has to draw that line in data, before any code reads it.

## What Changes

- **Package identity.** `package.json` with name `@reveer/jen` (ladder `@reveer` → `@reveer-ai` → `@reveerdev`), `bin` mapping `jen` to the CLI entry, `files: ["dist"]`, and `publishConfig.access: public` — scoped packages default to private, and the failure reads like a billing problem rather than a config one.
- **OpenSpec becomes a dependency**, not a vendored copy. jen never copies, tracks, or knows OpenSpec's file list — it delegates to `openspec init`, so OpenSpec's version can move without jen's payload changing.
- **TypeScript, ESM, compiled to `dist/`**, with a CI check that build and typecheck pass.
- **CLI source lives at `cli/`**, top-level. `src/` stays reserved and untracked for the sources of the project running under the workflow; jen's own code is workflow-level and belongs alongside it, not inside it.
- **`prepack` stages the payload** into `dist/templates/` — the six stage skills plus root `AGENTS.md`. Generated, gitignored, tool-neutral, regenerated seconds before upload so the two copies cannot drift. The ownership stamp is applied here rather than committed to the source files, since jen's own checkout is not a managed install. `dist/templates/` is also what the deletion rule compares against, so it is the authority on what jen currently ships.
- **An explicit payload declaration**, distinguishing *fixed paths* jen always writes (root `AGENTS.md`) from *variable sets* whose membership can change between versions (the six stage skills in `.claude/skills/`). Skills are one kind of managed file, not the only kind, and the declaration does not assume otherwise. jen writes `.claude/` and nothing else — no tool table, no fan-out. Support for other assistants is a project-side symlink (`.github/skills` → `.claude/skills`), which costs jen no code and propagates every update for free.
- **An ownership stamp** on every file in a variable set — the single namespaced key `metadata.jen: true`, in frontmatter the Agent Skills standard already allows. Presence denotes ownership, so no companion author or version field is needed, and keeping it constant means a release never rewrites a file whose content did not change. Fixed paths need no stamp: they are always written and can never be orphaned.
- **Deletion is the stamp intersected with the shipped payload** — a file goes if and only if it is stamped and absent from what jen currently ships. No record of previous writes is needed, because the stamps distributed across the files *are* that record. Hence no manifest and no state file. A project takes ownership of a copied file by deleting the stamp.
- **A constraint this creates:** anything jen ships into a variable set must be able to carry a stamp. JSON has no comment syntax, so it cannot be a variable-set member.
- **Root `AGENTS.md` is jen's outright**, overwritten wholesale on update — no marker block, no merge. This holds the existing constraint rather than relaxing it: the workflow already routes project notes to the nearest `AGENTS.md` at or below `src/` and declares the root one off-limits. Root `AGENTS.md` stays static across every project, describing the workflow and how the project it governs is represented in `src/`.
- **`.gitignore` inverts** from a default-deny allowlist (a fork artifact, written so the template ignored everything a project added) to a conventional ignore file, so jen's own sources are trackable.
- **The eighteen vendored OpenSpec files are removed** — nine `openspec-*` skills and nine `.claude/commands/opsx/*` wrappers, a frozen snapshot of OpenSpec 1.4.0 that silently goes stale.

Explicitly out of scope: install and reconcile logic (ENG-157), the `jen init` / `jen update` commands (ENG-158), and release automation (ENG-161). This change declares the contract those consume; it does not act on it.

## Capabilities

### New Capabilities

- `npm-package`: the publishable artifact — package identity and metadata, the TypeScript build, the `prepack` staging step, and what the tarball is required to contain and to exclude.
- `managed-payload`: the declarative ownership contract — fixed paths versus variable sets, which files belong to the project, the frontmatter stamp by which a jen-written file is recognized, and the deletion rule built on it.
- `repo-layout`: how jen's own repository is arranged and tracked — the `cli/` source location, the inverted `.gitignore`, the removal of vendored OpenSpec artifacts, and the requirement that a fresh clone has working stage skills with no build step.

### Modified Capabilities

None. `openspec/specs/` is empty — this is the first change to establish specs in this repo.

## Impact

- **Added**: `package.json`, `tsconfig.json`, `cli/` (entry point and the declarations above), `scripts/` (the staging script), a CI workflow for build and typecheck, `openspec/` now tracked.
- **Modified**: `.gitignore` inverts. Root `AGENTS.md` is unchanged in content but becomes a declared managed path.
- **Removed**: `.claude/skills/openspec-*` (nine) and `.claude/commands/opsx/*` (nine). Agents in this repo lose the vendored OpenSpec skills and rely on the OpenSpec dependency instead.
- **Dependencies**: OpenSpec added; TypeScript, `@types/node`, and a test runner added as dev dependencies. Node's version floor gets pinned in `engines`.
- **Downstream**: the install side builds directly on the managed-path list and the ownership stamp. Three things drop out of what ENG-157 was scoped to build: wholesale ownership of `AGENTS.md` removes marker-merge, the stamp removes `.jen/manifest.json`, and project-side symlinks remove the tool table and its fan-out. What remains — copy, scan-for-stamp, delete-unshipped, delegate to `openspec init` — is small enough to belong to the CLI task rather than a separate engine. ENG-161 inherits the `publishConfig` gotcha above.
- **Human step**: registering the npm scope needs credentials this project does not hold (`npm whoami` returns `ENEEDAUTH`). `@reveer/jen` is unregistered and no `@reveer` packages exist, which makes the scope likely free but unconfirmable — npm's org endpoints are auth-gated and the registry search API silently ignores the `scope:` qualifier. Implementation prepares everything around it and hands the registration back.
- **Risk**: the `.gitignore` inversion is the delicate part. The current allowlist is why `openspec/` was created by ENG-131 and then never tracked; inverting it wrong either drops files from git or starts tracking local noise.
