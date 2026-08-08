# jen

The workflow layer for automated, agentic software development — task-anchored, spec-driven, and git-reviewed. [`AGENTS.md`](AGENTS.md) is the workflow itself; the six stage skills in `.claude/skills/` carry it out.

## Working on jen

```bash
npm install
```

The six stage skills work straight out of a clone — no build, no install, no init. They are the same files the package ships; editing one is editing a file.

OpenSpec's own skills and commands are **not** vendored. They come from the version this package depends on:

```bash
npx openspec init
```

That writes `.claude/skills/openspec-*` and `.claude/commands/opsx/*` locally. Both are gitignored — committing them re-vendors the frozen snapshot this repository deliberately dropped. Run `openspec init` once per clone.

## Checks

```bash
npm run build && npm run typecheck && npm test
```

CI runs the same three on every pull request, on the minimum Node version `engines.node` allows.

## Packaging

`npm pack` compiles the CLI to `dist/` and stages the payload into `dist/templates/` — the six skills, stamped, plus the workflow document. `files: ["dist"]` ships that and nothing else.

See [`cli/AGENTS.md`](cli/AGENTS.md) for how the payload declaration and staging fit together.
