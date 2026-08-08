# jen

The workflow layer for automated, agentic software development — task-anchored, spec-driven, and git-reviewed. [`AGENTS.md`](AGENTS.md) is the workflow itself; the six stage skills in `.claude/skills/` carry it out.

## Working on jen

```bash
npm install
```

The six stage skills work straight out of a clone — no build, no install, no init. They are the same files the package ships; editing one is editing a file.

OpenSpec's own skills and commands are **not** vendored. `npm install` runs `openspec init` for you through `prepare`, writing `.claude/skills/openspec-*` and `.claude/commands/opsx/*` from the version in the lockfile. Both are gitignored — committing them re-vendors the frozen snapshot this repository deliberately dropped.

`prepare` rather than `postinstall` on purpose: `postinstall` fires for anyone installing jen as a dependency, and would run `openspec init` inside their project uninvited. `prepare` only runs for a local install here.

## Checks

```bash
npm run build && npm run typecheck && npm test
```

CI runs the same three on every pull request, on the minimum Node version `engines.node` allows.

## Packaging

`npm pack` compiles the CLI to `dist/` and stages the payload into `dist/templates/` — the six skills, stamped, plus the workflow document. `files: ["dist"]` ships that and nothing else.

See [`cli/AGENTS.md`](cli/AGENTS.md) for how the payload declaration and staging fit together.
