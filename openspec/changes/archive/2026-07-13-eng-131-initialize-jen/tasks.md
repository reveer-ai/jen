## 1. Tracking rules

- [x] 1.1 Write `.gitignore` as a default-deny allowlist: ignore `*`, then re-admit `/.gitignore`, `/.ignore`, `/AGENTS.md`, `/CLAUDE.md`, `/.claude/`, and `/.claude/**`
- [x] 1.2 Write `.ignore` as `!*` so search and editor tooling still see paths git ignores
- [x] 1.3 Verify the two pull in opposite directions: a file under `src/` is invisible to `git status` and returned by ripgrep

## 2. Workflow document

- [x] 2.1 Write `AGENTS.md` with the four sections the workflow rests on — the task as source of truth, projects as monorepo forks of jen, the OpenSpec artifact progression, and resources declared in `registry.yaml`
- [x] 2.2 State in `AGENTS.md` that any agent acting in the project must adhere to it
- [x] 2.3 Write `CLAUDE.md` as a one-line pointer to `AGENTS.md`, with no workflow text of its own

## 3. OpenSpec integration

- [x] 3.1 Vendor the nine `openspec-*` skills into `.claude/skills/` from OpenSpec 1.4.0
- [x] 3.2 Vendor the nine `opsx` command wrappers into `.claude/commands/opsx/`
- [x] 3.3 Initialize the `openspec/` directory for changes and specs
- [x] 3.4 Confirm the vendored skills resolve by name in a fresh clone with no setup step

## 4. Assistant configuration

- [x] 4.1 Seed `.claude/settings.local.json` with the Linear MCP permission
