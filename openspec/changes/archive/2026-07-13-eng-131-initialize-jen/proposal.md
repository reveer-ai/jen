## Why

jen exists to be the workflow layer every project forks from, but a workflow that lives only in a person's head cannot be forked. Nothing downstream — spec-driven changes, task-anchored branches, agent-run stages — can be built until the repo itself states what the workflow is, in a file agents are required to read, in a repo whose tracking rules are deliberate rather than incidental.

This change is that starting point. It writes the workflow down, makes OpenSpec available to agents working in the repo, and settles which files the repo tracks. It establishes the single-directory-per-project model everything after it builds on.

## What Changes

- **`AGENTS.md` becomes the workflow document**, and the authority any agent acting in this repo is bound to. It states the four things the workflow rests on: the task is the source of truth, a project's repo is a fork of jen rather than something jen points at, OpenSpec's artifact progression drives the work, and all work happens against resources declared in `registry.yaml`.
- **`CLAUDE.md` is a one-line pointer** at `AGENTS.md`, not a second copy. The workflow is tool-neutral; a tool that wants its own filename gets a pointer to the one document, so the two can never disagree.
- **OpenSpec is vendored into the repo** — nine `openspec-*` skills and nine `.claude/commands/opsx/*` command wrappers, plus the `openspec/` directory — so an agent working here can drive a change through proposal, specs, design, and tasks without any out-of-band setup.
- **`.gitignore` is a default-deny allowlist**: ignore `*`, then re-admit each path the repo genuinely owns. jen is a template, and a template that a project fills in should track only what jen itself ships — anything a project adds stays untracked unless the project chooses otherwise.
- **`.ignore` re-admits everything for editor and search tooling** (`!*`). The default-deny `.gitignore` is honored by ripgrep and editor search, which would otherwise hide the project's own working files from the agents meant to read them. The two files pull in opposite directions on purpose.
- **Claude Code permissions are seeded** with the Linear MCP, the first resource the workflow depends on.

## Capabilities

### New Capabilities

- `agent-instructions`: how agents working in this repo are instructed — `AGENTS.md` as the single authoritative workflow document, tool-specific files as pointers to it rather than copies, and the requirement that agents adhere to it.
- `repo-scaffold`: what the repository tracks and exposes — the default-deny `.gitignore` allowlist, the `.ignore` counterweight that keeps files visible to search, and `src/` as untracked space for the project's own sources.
- `openspec-integration`: OpenSpec's availability to agents in-repo — the vendored skills and `opsx` command wrappers, and the `openspec/` directory structure changes and specs live in.

### Modified Capabilities

None. This is the first change in the repo; `openspec/specs/` does not yet exist.

## Impact

- **Added**: `AGENTS.md`, `CLAUDE.md`, `.gitignore`, `.ignore`, `.claude/settings.local.json`, nine `.claude/skills/openspec-*/SKILL.md`, nine `.claude/commands/opsx/*.md`.
- **Dependencies**: OpenSpec 1.4.0, vendored as a snapshot rather than installed. Linear as the project-management system of record.
- **Downstream**: every later change inherits the allowlist, so any new tracked path must be admitted explicitly — a step easy to forget and silent when missed. ENG-135 builds the stage skills on top of the artifact progression named here.
- **Known limitation**: `openspec/` is created but not admitted by the allowlist, so the directory exists on disk and is invisible to git. The repo has OpenSpec available to agents without being able to record what they produce with it. This is not resolved here.
