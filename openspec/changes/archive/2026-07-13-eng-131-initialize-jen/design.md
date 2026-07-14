## Context

The repository is empty. Everything the workflow will later depend on — stage skills, spec-driven changes, task-anchored branches — presumes a repo that already states what the workflow is and already has OpenSpec available to the agents running it. Nothing can be built on a premise that is not written down.

Two constraints shape the work. First, adoption is by forking: whatever lands here is copied wholesale into every project, so the scaffold has to make sense as a template being filled in, not just as this repository. Second, the actors are agents. They read files rather than documentation sites, they resolve skills by name from the tree, and they search the working copy to orient themselves — so the scaffold is judged on what an agent finds when it looks.

## Goals / Non-Goals

**Goals:**

- State the workflow in one place, in a form an agent is bound to read.
- Give an agent working in a fresh clone a usable OpenSpec setup with no steps of its own.
- Make the repository's tracking rules deliberate, so a fork's own files do not leak into jen's history by default.
- Keep the whole thing tool-neutral, so support for a second assistant costs a pointer file.

**Non-Goals:**

- The stage skills themselves — `refine-epic` through `deliver-task` — and the statuses that trigger them. ENG-135 builds those on the progression named here.
- Any packaging or distribution mechanism. Forking is the adoption path for now.
- `registry.yaml`'s schema. The workflow names it as where resources are declared; what a resource record contains is deferred.

## Decisions

**`AGENTS.md` is the workflow document; `CLAUDE.md` is a one-line pointer to it.**

The alternative is a copy per assistant, which is two files to edit and two chances for them to disagree — and the disagreement is silent, because each assistant only reads its own. A pointer cannot drift. `AGENTS.md` was chosen as the real file over `CLAUDE.md` because the workflow is not Claude's: the emerging cross-tool convention is `AGENTS.md`, and a second assistant is then one pointer file, not a migration. The cost is one indirection at load time, which is free.

**OpenSpec is vendored in-tree rather than installed as a dependency.**

Nine skills and nine command wrappers are copied in at version 1.4.0. The alternative — declaring OpenSpec a dependency — is better in every respect except the one that matters right now: there is no package to declare it in. The repo has no `package.json`, no build, and no install step, and creating one to hold a single dependency is a larger change than this one. Vendoring buys a working setup in a fresh clone today.

The price is that the copy is a frozen snapshot. It does not track OpenSpec's releases, nothing signals when it has gone stale, and updating means re-copying eighteen files by hand. This is accepted deliberately as a debt to be paid once the repository is something a dependency can be declared in.

**`.gitignore` is default-deny; `.ignore` re-admits everything for search.**

jen is a template that projects fill in, so the safe default is that a file is the project's until jen claims it. Ignoring `*` and re-admitting explicitly makes every tracked path a decision. An allowlist is also short here — the repo owns a handful of paths — where an ignore-list would have to anticipate everything a project might add, which is unknowable.

The side effect is that ripgrep and editor search honor `.gitignore` too, and would hide the project's own working files from the agents meant to read them. `.ignore` (`!*`) exists solely to counteract that, and takes precedence for the tools that read it. The two files pull in opposite directions on purpose: git sees almost nothing, search sees everything.

## Risks / Trade-offs

**A new tracked path is silently dropped.** The allowlist admits paths by name, so a change that creates a directory without adding an exception produces files that exist on disk and never enter git. There is no error and no warning — the files simply are not there in a fresh clone. → Not mitigated. It bites immediately: `openspec/` is created by this change and is not admitted, so the repository has OpenSpec available to agents with no way to record what they produce with it. This is a known defect left standing, and the cost of the allowlist being right by default.

**The vendored OpenSpec snapshot goes stale invisibly.** Nothing compares the eighteen copied files against the version they came from. → Accepted as debt; the fix is to declare OpenSpec a dependency once the repository can hold one.

**The fork carries jen's history into every project.** Adoption by forking means a project's `git log` starts with jen's commits, and pulling later jen changes into a diverged fork means merging unrelated histories. → Accepted for now. Forking is what works without a package; the constraint is real and will force the question later.

**`AGENTS.md` is the one file both jen and every fork will want to edit.** A project that adds its own notes to it makes exactly the file jen most needs to update the one that conflicts. → Not addressed here. The workflow document does not yet say where project-level notes belong.

## Open Questions

- What a `registry.yaml` resource record contains, and whether the workflow reads it or only agents do.
- Whether `openspec/` should be admitted to the allowlist now or as part of a broader reconsideration of the tracking rules.
- How a fork takes jen's updates once it has diverged.
