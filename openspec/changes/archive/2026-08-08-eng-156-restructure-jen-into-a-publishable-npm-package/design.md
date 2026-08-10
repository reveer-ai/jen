## Context

jen is a fork template. The repository holds a workflow document, six stage skills, and eighteen vendored OpenSpec files, with a `.gitignore` written as a default-deny allowlist so the template ignored whatever a project added on top.

Nothing about it is publishable today: there is no `package.json`, no build, no source directory for jen's own code, and no statement anywhere of which files jen owns versus which belong to the project. Forking made that statement unnecessary — everything was jen's and everything was mutable. A package cannot work that way.

Constraints that shaped this design:

- **The six stage skills are the most-edited files in the repository.** Any scheme requiring a build, a regeneration step, or a second copy taxes every edit.
- **OpenSpec is a separate package on its own release cadence.** jen must not know its file list.
- **Simplicity is the explicit priority.** Three mechanisms were considered and rejected during design — marker merge, a manifest, and a multi-tool table. Each is recorded below.
- **jen does not self-host.** It never runs `jen init` on itself. Its working files are the shipped files.

## Goals / Non-Goals

**Goals:**

- `npm pack` produces a tarball containing exactly the compiled CLI and the staged payload.
- The declaration of what jen owns is data, readable without running anything.
- A fresh clone has working stage skills with no build, install, or init.
- Editing a skill is editing one file, with no second copy to keep in sync.

**Non-Goals:**

- Install, reconcile, or update logic — the CLI commands that consume this contract (ENG-158).
- Release automation and npm publishing (ENG-161).
- Multi-assistant output. jen writes `.claude/` only; other assistants are a project-side symlink.
- Migrating existing forks. There are none in the wild.

## Decisions

### The payload is staged at pack time, from the working copies

`prepack` runs `tsc` and then a staging script, in that order:

```
"prepack": "npm run build && node scripts/stage-payload.js"
```

Staging copies `.claude/skills/<six>/SKILL.md` → `dist/templates/skills/<six>/SKILL.md` and `AGENTS.md` → `dist/templates/AGENTS.md`, stamping each skill on the way through. `files: ["dist"]` ships the result.

*Why:* the working copies and the shipped copies are the same bytes, produced seconds before upload, so there is no window in which they disagree. The staged path is tool-neutral rather than `.claude/…`, which would misdescribe the payload the moment a project symlinks another assistant at it.

*Alternative rejected:* a committed `templates/` tree with jen self-hosting. Two copies of the most-edited files in the repository, a rebuild on every skill edit, and dogfooding that proves little — jen's own repo is permanently on the easy path, while the interesting failures live in adopter divergence.

*Known limitation:* `prepack` does not run when a package is installed directly from a git URL, and `dist/` is gitignored, so a git-URL install yields an empty payload. Adopters install from the registry, so this is accepted rather than solved; `prepare` would cover it at the cost of rebuilding on every local `npm install`.

### Ownership is a stamp, and deletion is the stamp intersected with the payload

A file is deleted if and only if it carries jen's stamp and is absent from `dist/templates/`. The stamp makes it a candidate; presence in the shipped payload spares it. Unstamped files are the project's and are never candidates.

*Why this needs no manifest:* the obvious reading is that reconcile requires knowing what jen wrote last time, which implies a ledger. It does not. That history is already distributed across the files themselves — a stamp on disk *is* the record that jen put it there. Comparing against what jen ships now is enough, so there is no state file, nothing to go stale, and nothing that can disagree with the disk.

*Scope of the stamp:* only **variable sets** need one — groups whose membership can change between versions, written into a directory shared with the project. **Fixed paths** like root `AGENTS.md` are always written and can never be orphaned, so they are never deletion candidates and carry no stamp.

*The constraint this creates:* every variable-set member must be able to carry a stamp. Markdown has frontmatter; YAML and `.gitignore` take `#` comments; JSON has neither, so JSON cannot be a variable-set member. The live JSON candidate is `.claude/settings.json`, which is a fixed, project-owned, write-once path and therefore never reconciled. This is a real limit and is recorded rather than designed around.

*Alternatives rejected:* a **manifest** generalizes to any file type but reintroduces external state to solve a problem the stamps already solve. A **retired-names list** shipped in the package avoids touching files entirely, but requires remembering to append a name on every rename, and a forgotten line means a file lingering in every project.

### The stamp is a single namespaced key, injected as text

Staging inserts the stamp immediately before the closing `---` of the frontmatter. All six skills carry the same keys — `name`, `description`, `category`, `tags` — and none has a `metadata` key:

```yaml
metadata:
  jen: true
```

*Why one key:* presence denotes ownership, so an `author: jen` field alongside a version says the same thing twice.

*Why constant, with no version:* a value that changed per release would rewrite every managed file in every project on every release, burying real skill changes in version-bump noise in the adopter's diff. Version diagnostics are not worth that, and can be added later if they ever are.

*Why text insertion, not a YAML round-trip:* the specs require staging to be byte-deterministic. Parsing and re-serializing would normalize formatting nobody asked to change — `tags: [workflow, linear, openspec]` is flow style and a round-trip would likely emit block style — and key order depends on the serializer. Text insertion preserves the file exactly and adds no dependency. Reading the stamp back needs only a frontmatter scan, not a full parser.

### The managed-path declaration lives in TypeScript, and staging imports it built

`cli/payload.ts` exports the six skill names, the `AGENTS.md` path, and the stamp constants. `scripts/stage-payload.js` is plain Node ESM — no build of its own — and imports the declaration from `dist/` after `tsc` has run. The `prepack` ordering above guarantees that.

*Why:* one declaration, typed, consumed by both the staging script and the CLI. A `payload.json` would also be single-source but gives up types on the value the whole design turns on. Duplicating the list in the script is how the two drift.

### TypeScript compiled with `tsc`, no bundler

ESM output to `dist/`, `engines.node` at `>=20.19.0` — inherited from OpenSpec, since a package cannot require less than its dependency. Vitest for tests, matching the reference implementation.

*Why:* Node runs ESM directly; a CLI that copies files has nothing to bundle. `tsc` is the smallest thing that produces `dist/` and typechecks in CI.

*Noted:* the original case for TypeScript was that the manifest and marker-merge engine had invariants worth typing. Both are gone. TS is retained for the narrower reasons above — CI catches typos in a package published to others — and the weakened justification is recorded honestly rather than restated as if unchanged.

### `.gitignore` inverts to a conventional ignore file

The allowlist is replaced by explicit ignores: build output (`dist/`), dependencies (`node_modules/`), the governed project's sources (`src/`), per-install files (`.claude/settings.local.json`), and local agent scratch (`.claude/worktrees/`).

*Why:* the allowlist has already failed twice in observable ways. ENG-131 created `openspec/` and the allowlist silently prevented it from ever being tracked — it was absent from the repository until this change restored it. During this change's first commit the same file tried to stage an embedded git repository under `.claude/worktrees/`, because `!/.claude/**` admits everything beneath it. It is simultaneously too permissive under `.claude/` and too restrictive everywhere else.

*Risk acknowledged:* this is the delicate edit. Inverting it wrong drops files from git or starts tracking local noise, and both failures are quiet.

### Rejected during design, recorded so they are not revisited by accident

- **Marker block in `AGENTS.md`.** Would have relaxed a constraint the workflow already imposes — root `AGENTS.md` is off-limits to project notes, which belong to the nearest `AGENTS.md` at or below `src/`. Holding the constraint lets jen own the file outright, and removes in-file merging from the design entirely.
- **`.jen/manifest.json`.** Its only job was knowing what to delete when a later version drops a file. The stamp intersected with the shipped payload does that with no state outside the files themselves, so nothing can go stale, be gitignored, or disagree with the disk. It also gives projects an escape hatch: delete the stamp and the file is theirs.
- **Tool table with fan-out.** Every assistant reads only its own directory and no shared location exists, so fan-out means N byte-identical copies to write and reconcile. A project-side symlink produces the same result with no code in jen and no possibility of the copies diverging.

## Risks / Trade-offs

- **`.gitignore` inversion silently drops a file** → invert and then diff `git ls-files` against the pre-change list; every removal must be one of the eighteen vendored files, and every addition intentional.
- **Staging drifts from the working copies** → staging is a copy with one insertion, and the specs require byte-identical output across runs; a test asserts staged content equals source plus stamp.
- **The tarball ships something unintended** → assert tarball contents directly from `npm pack`, both what must be present and what must be absent.
- **`prepack` ordering breaks** if the staging script is run standalone before a build → the script fails loudly on a missing `dist/` import rather than staging an unstamped or partial payload.
- **The scope is unavailable at registration** → the ladder `@reveer` → `@reveer-ai` → `@reveerdev` is decided in advance, so registration does not come back for a decision.
- **Contributors lose the vendored OpenSpec skills** → they come from `openspec init`, which was verified during design to regenerate them byte-identical to the committed copies. Nothing is lost; the setup step needs documenting.

## Migration Plan

No adopters exist, so there is nothing to migrate. jen's own repository changes in place:

1. Add `package.json`, `tsconfig.json`, `cli/`, `scripts/`, and the CI workflow.
2. Invert `.gitignore`, then verify tracked files against the pre-change list.
3. Delete the eighteen vendored OpenSpec files.
4. Verify `npm pack` contents.

Rollback is `git revert` — nothing is published by this change, and no external state is touched.

## Open Questions

- **`.claude/settings.json` has no declared owner.** ENG-137 lists it in the scaffold but it is not in the managed set, which makes it project-owned and written once at init. That is a reasonable default and is what the specs assume, but it was never explicitly decided.

## Resolved During Design

- **`AGENTS.md` still describes forking as the adoption model.** Two sections say a project starts as a fork of jen — false once jen ships as a package, and false in the very file jen ships. **Resolved: the rewrite belongs to ENG-162**, alongside the adoption docs, so the text describing how adoption works is written by the task that performs a real adoption and can check it. This change therefore alters no `AGENTS.md` content; it only makes the file a declared managed path. Accepted consequence: between this change and ENG-162 merging, the shipped workflow document describes a model that no longer applies.
