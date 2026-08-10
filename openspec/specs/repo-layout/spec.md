# repo-layout Specification

## Purpose

Fixes where jen's own code lives and how the repository decides what to track, keeping `src/` reserved for the governed project's sources and keeping a fresh clone immediately usable without a build, an install, or an initialization step.

## Requirements

### Requirement: jen's own source lives at `cli/`

jen's CLI source SHALL live in a top-level `cli/` directory. It SHALL NOT live in `src/`.

`src/` names the same location in jen and in every project that adopts it: the project's own sources, sitting where a repository root would conventionally hold them, beneath a root the workflow owns. jen's own code is workflow-level and belongs beside `src/` rather than inside it, so that an adopter's `src/` and jen's mean the same thing.

Whether that location is tracked is a property of the repository, not of the workflow. An adopted project's sources ARE its repository's content and SHALL be tracked there. jen's own repository governs no sources of its own, so its `src/` holds only working checkouts and is ignored. jen SHALL NOT impose either arrangement on a project: it writes no ignore file, and the `project-install` capability forbids it from modifying one.

#### Scenario: CLI source is at the top level

- **WHEN** the repository is listed
- **THEN** the CLI's TypeScript sources are under `cli/`
- **AND** no jen source file exists under `src/`

#### Scenario: `src/` remains untracked

- **WHEN** jen's own repository's tracked files are listed
- **THEN** no path under `src/` appears

#### Scenario: An adopted project tracks its sources under `src/`

- **WHEN** a project that has adopted the workflow commits its own application sources
- **THEN** they are tracked under `src/` in the same repository as the workflow's files
- **AND** no ignore rule written by jen excludes them

#### Scenario: Adoption does not import jen's ignore rules

- **WHEN** jen writes its payload into a project
- **THEN** the project's ignore rules are unchanged
- **AND** `src/` is not excluded on jen's account

### Requirement: The repository tracks files by default

`.gitignore` SHALL be a conventional ignore file, listing what is excluded. It SHALL NOT be a default-deny allowlist — a leading `*` rule with `!` exceptions — which was a fork-template artifact written so the template ignored everything a project added.

Ignore rules SHALL cover build output, dependencies, local agent scratch directories, and per-install files. Every path jen manages SHALL be trackable.

#### Scenario: New source files are tracked without an allowlist edit

- **WHEN** a new source file is added under `cli/`
- **THEN** git reports it as untracked and stageable, with no change to `.gitignore`

#### Scenario: Specs and changes are tracked

- **WHEN** an OpenSpec change artifact is written under `openspec/`
- **THEN** git reports it as stageable

#### Scenario: Build output is ignored

- **WHEN** `dist/` and `node_modules/` exist after a build and install
- **THEN** git reports neither as untracked content

#### Scenario: Local agent scratch is ignored

- **WHEN** an embedded git repository exists under `.claude/worktrees/`
- **THEN** git does not report it as stageable content

### Requirement: Vendored OpenSpec artifacts are removed

The nine `.claude/skills/openspec-*` directories and the nine `.claude/commands/opsx/*` files SHALL be deleted from the repository. They are a frozen snapshot of OpenSpec 1.4.0 that goes stale silently as OpenSpec releases.

These files SHALL instead be produced locally by `openspec init`, from the version the package depends on.

#### Scenario: The vendored copies are gone

- **WHEN** the repository's tracked files are listed
- **THEN** no `.claude/skills/openspec-*` path and no `.claude/commands/opsx/*` path appears

#### Scenario: OpenSpec's own skills are still obtainable

- **WHEN** `openspec init` is run in a fresh clone
- **THEN** the OpenSpec skills and commands are written locally

### Requirement: A fresh clone has working stage skills with no build step

Cloning the repository SHALL yield every skill jen ships — the six stage skills and the setup skill — immediately usable, without installing dependencies, running a build, or executing any initialization command. The skills a contributor edits SHALL be the same files the package ships.

#### Scenario: Stage skills work immediately after clone

- **WHEN** the repository is cloned and no build or install is run
- **THEN** every skill the payload declares is present at `.claude/skills/<name>/SKILL.md` and is a valid Agent Skill

#### Scenario: Editing a skill requires no regeneration

- **WHEN** a contributor edits a shipped skill's `SKILL.md` and commits it
- **THEN** no build, regeneration, or second copy needs updating for the change to be complete
