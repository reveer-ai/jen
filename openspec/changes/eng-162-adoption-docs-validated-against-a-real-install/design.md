## Context

See `proposal.md` — Why. The constraints that shape the approach, none of them negotiable here:

- **The registry publishes `README.md` regardless of `files`.** `files: ["dist"]` selects nothing but build output, yet npm adds `package.json`, `README.md`, and `LICENSE` to every tarball. The current README is a contributor guide, so this is already the package's front page whether or not it was written to be.
- **Root `AGENTS.md` is shipped payload.** It is a fixed path in the `managed-payload` declaration, staged at `prepack` and overwritten wholesale on every `jen update`. Editing it edits what every adopting project receives, which is why the fork language could not simply be left to rot.
- **Nothing in this repository reads `scaffold/`.** `cli/AGENTS.md` already records the consequence: scaffold text is inert here and becomes instructions only in an installed project, which is how `registry.yaml` once shipped naming a skill that never existed. The same blind spot hides the hub-model example.
- **`CLAUDE.md` is a symlink to `AGENTS.md`.** The pointer requirement in `agent-instructions` is satisfied structurally; no edit follows from changing `AGENTS.md`.
- **Binding is a conversation, not a command.** `project-binding` forbids the CLI from reaching a tracker. Any end-to-end run therefore has a step no script performs.

## Goals / Non-Goals

**Goals:**

- One document per audience, with the adopter's reachable from the registry.
- The repository model stated once, in `AGENTS.md`, and consistent with every file that implies it — including the scaffold an adopter receives.
- Every mechanically checkable claim in the documentation held by a test, so the parts that rot are only the parts no test could hold.
- A validation run that exercises the published artifact, and a written ritual so a later contributor can repeat it.

**Non-Goals:**

- Automating the adoption run in CI. It needs a packed tarball, a real tracker, and a conversation with a user; a CI job could cover the first only, and one that covered only the first would be mistaken for covering all three.
- Documenting the CLI's flags exhaustively. `--force` is documented because the refusal it overrides is something an adopter meets; the rest is `--help`'s job.
- Changing any behavior of `jen init` or `jen update`. This change is documentation, metadata, and the spec corrections that make them true.

## Decisions

### The README is the adopter's, and `CONTRIBUTING.md` takes what it sheds

Two audiences currently share one file, and the registry hands that file to the one it was not written for.

The README becomes: what jen is, the ownership boundary, install → `jen init` → `setup-jen` → `jen update`, which assistants it reaches, and what adoption does not yet cover. `CONTRIBUTING.md` takes the current `## Working on jen`, `## Checks`, and `## Packaging` sections, plus the adoption-run ritual below.

*Alternative rejected — one file, adopter section first.* Cheaper, but the npm page still carries `prepare`-versus-`postinstall` reasoning that no adopter has a use for, and the boundary between the two audiences would erode again on the first edit that had nowhere obvious to go.

*Alternative rejected — contributor notes into `cli/AGENTS.md`.* That file is for someone changing the CLI and is already dense with hard-won specifics. Build and packaging instructions are entry-level material for a different moment, and burying them under the symlink-containment reasoning serves neither reader. The notes convention stays as it is: `CONTRIBUTING.md` links to the nearest `AGENTS.md` files rather than restating them.

### The ownership boundary is a table, and it comes before the install command

`adoption-docs` requires the boundary ahead of the instructions; this is how. A table because the boundary is two-valued across a handful of paths, which is exactly what prose renders worst.

It states four things, in this order: what jen replaces wholesale (root `AGENTS.md`, the shipped skills), what it writes once and never touches (`registry.yaml`, `.claude/settings.json`), what is never jen's (`src/`, `openspec/` content, project-authored skills), and how to claim a managed file by deleting its `metadata.jen` stamp.

The stamp is included deliberately. It is the one part of the boundary an adopter can *act* on, and without it the only documented way to keep an edit is not to make it.

### The repository model, and what replaces the fork passages

Four passages in `AGENTS.md` change: the "template every project forks from" opener, the "A project starts as a fork" paragraph, "the same monorepo fork", and "shared with every fork" in the notes convention.

The replacement states the arrangement confirmed during design: a project installs jen into its own repository; the root is jen's — `AGENTS.md`, `.claude/`, `openspec/`, `registry.yaml` — and `src/` holds what a repository root would conventionally hold, the project's own tracked sources. The monorepo point survives unchanged; it was never dependent on forking.

The notes convention's *reason* changes rather than its rule. "Never the root `AGENTS.md`" held because the file was shared with every fork; it now holds because the file is replaced wholesale on the next update. Same instruction, and a sharper reason — the old one explained why a note was *impolite*, the new one explains why it is *lost*.

`scaffold/registry.yaml`'s example follows from the same decision: one resource, the project itself, with its sources at `src/` — not a separate repository cloned to `path: src/acme-web`.

### The adoption run is manual, one-off, and written down

The ritual in `cli/AGENTS.md` is the starting point, extended through binding and update:

```
npm pack --pack-destination /tmp
cd /tmp/proj && git init && npm init -y && npm i -D /tmp/reveer-jen-*.tgz && npx jen init
```

then `setup-jen`, then edit a managed skill, then `npx jen update` and confirm the edit is gone. Packing rather than running from the working tree is the point: `prepack` stages the payload, so the tarball is the artifact by construction, and a run out of the working tree proves nothing about what ships.

**Binding runs against the real `eng` team, not a throwaway one.** This looks like the riskier choice and is the safer one: `project-binding` makes every step idempotent, and against a team already carrying `epic`, `task`, and the seven pipeline statuses, every check reports already-satisfied and the run creates nothing. A fresh team would exercise label *creation* — a mutation, on a tracker, to validate documentation. The only write is `registry.yaml` inside the scratch project, which is discarded.

*Alternative rejected — a CI job packing and installing into a temp directory.* It would cover installation and `jen init` and stop at binding, and its passing would then read as the adoption path being verified. Whatever the CLI can be held to belongs in `test/install.test.ts`, which already spawns the built entry point; a second harness proving less is not worth the maintenance.

### Tests take everything mechanical; the run takes what is left

The run happens once, and its findings become doc corrections. What a test can hold, a test holds — otherwise the next change to `package.json` silently undoes it and only the next manual run notices:

- `license` is a valid SPDX identifier and is not `UNLICENSED`; `keywords` is non-empty (`test/package.test.ts`, beside the existing manifest assertions)
- `LICENSE` and `README.md` are tarball entries — the requirement that they reach the adopter, and the guard against a future `files` change being trusted to control what ships
- `LICENSE` exists at the repository root and names the license `package.json` declares

The scaffold's hub-model example is not mechanically checkable — no test can ask whether prose teaches the right model. `test/payload.test.ts` already checks the one property it can (every skill a scaffold file names exists), and this stays a reading task in the run.

### Apache-2.0 ships verbatim, with no `NOTICE`

`LICENSE` is the stock Apache-2.0 text with the copyright line in its appendix filled in for Reveer. No `NOTICE` file: Apache-2.0 requires one only when there is third-party attribution to carry, and jen has none. Shipping an empty one would oblige every downstream fork to propagate a file that says nothing.

## Risks / Trade-offs

- **A validation run performed once decays into a claim.** → The ritual lands in `CONTRIBUTING.md` so it is repeatable rather than remembered, and everything mechanical moves into tests. The residue — whether the prose is followable — genuinely cannot be automated, and is stated as a one-time gate rather than a standing guarantee.
- **The run's findings could invalidate the docs mid-implementation.** → Sequenced deliberately: the run comes after the docs are drafted and before the changeset, and correcting the docs from it is part of the task rather than a follow-up. If the run finds a *behavioral* defect rather than a documentation one, that is a separate task and the docs describe what jen does today.
- **Editing shipped `AGENTS.md` rewrites it in every adopting project on their next update.** → This is the designed behavior of a fixed path, and correcting a false statement is exactly what it is for. Nothing is lost that was not already at risk: a project that wrote notes into the root file was losing them on any update, which the notes convention now says outright.
- **`keywords` invites bikeshedding.** → Chosen for what someone would actually search, not for coverage. It is metadata, cheap to change, and not worth a decision record.
- **The `@reveer` scope ladder in `npm-package` becomes stale text.** → Folded into the identity delta rather than left behind: the first rung was registered, so the fallback clause is spent and is removed rather than preserved as a decision that still looks open.

## Migration Plan

Not applicable — no adopter state changes. Published versions carrying `UNLICENSED` stay as published; the license applies from the next release, which the changeset in this change triggers. No rollback beyond reverting the commit.

## Open Questions

None. The two that existed — the license, and what an adopted project's repository actually looks like — were resolved with the user before the proposal was written, and both are recorded on the issue.
