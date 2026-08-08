## 1. Package skeleton

- [ ] 1.1 Add `package.json`: `name` `@reveer/jen`, `type: module`, `bin.jen` pointing at the built CLI entry, `files: ["dist"]`, `publishConfig.access: public`, `engines.node` `>=20.19.0`
- [ ] 1.2 Add OpenSpec as a dependency, and TypeScript, `@types/node`, and vitest as dev dependencies
- [ ] 1.3 Add `tsconfig.json` targeting ESM output to `dist/`, with `cli/` as the source root
- [ ] 1.4 Add `build`, `typecheck`, and `test` scripts

## 2. Payload declaration

- [ ] 2.1 Create `cli/payload.ts` exporting the six stage skill names (`refine-epic`, `design-task`, `implement-task`, `review-task`, `test-task`, `deliver-task`), the root `AGENTS.md` path, and the target directory `.claude`
- [ ] 2.2 Export the stamp constants from the same module: the `author` value `jen` and the frontmatter key names
- [ ] 2.3 Add a test asserting the declaration names exactly six skills and contains no glob or wildcard entry

## 3. Staging script

- [ ] 3.1 Create `scripts/stage-payload.js` as plain Node ESM, importing the declaration from `dist/` (built first by `prepack`)
- [ ] 3.2 Copy the six `SKILL.md` files to `dist/templates/skills/<name>/SKILL.md` and `AGENTS.md` to `dist/templates/AGENTS.md`
- [ ] 3.3 Inject the stamp by inserting a `metadata` block immediately before the closing `---` of each skill's frontmatter, reading the version from `package.json` — text insertion, not a YAML round-trip
- [ ] 3.4 Fail loudly with a clear message if the `dist/` import is missing, rather than staging an unstamped or partial payload
- [ ] 3.5 Wire `prepack` to run the build then the staging script, in that order
- [ ] 3.6 Test that staged skills equal source plus stamp, byte for byte
- [ ] 3.7 Test that two consecutive staging runs produce byte-identical output
- [ ] 3.8 Test that a stamped `SKILL.md` still parses as a valid Agent Skill with `name` and `description` intact
- [ ] 3.9 Test that no path under `dist/templates/` is named for an assistant

## 4. CLI entry point

- [ ] 4.1 Create the `cli/` entry point registering the `jen` binary and reporting `--version` and `--help`
- [ ] 4.2 Leave `init` and `update` unimplemented — they belong to ENG-158. This change ships the entry point and the declaration they consume, not the commands

## 5. Repository layout

- [ ] 5.1 Capture the current `git ls-files` output as the pre-change baseline for comparison in 5.4
- [ ] 5.2 Invert `.gitignore` to a conventional ignore file: `dist/`, `node_modules/`, `src/`, `.claude/settings.local.json`, `.claude/worktrees/`
- [ ] 5.3 Delete the nine `.claude/skills/openspec-*` directories and the nine `.claude/commands/opsx/*` files
- [ ] 5.4 Diff `git ls-files` against the 5.1 baseline and confirm every removal is one of the eighteen vendored files and every addition is intentional
- [ ] 5.5 Verify a fresh clone has all six stage skills present and valid with no install, build, or init

## 6. Tarball verification

- [ ] 6.1 Test that `npm pack` produces a tarball containing the compiled CLI entry and all of `dist/templates/`
- [ ] 6.2 Test that the tarball contains no `.ts` source, no test file, and no path under `.claude/`, `openspec/`, or `src/`
- [ ] 6.3 Test that the tarball contains no `openspec-*` skill and no `opsx` command file

## 7. CI

- [ ] 7.1 Add a GitHub Actions workflow running build, typecheck, and tests on every pull request
- [ ] 7.2 Confirm the workflow fails on an introduced type error and on a broken build

## 8. Handoff

- [ ] 8.1 Record any convention or gotcha this change establishes in an `AGENTS.md` at or below the code it applies to — not the root one
- [ ] 8.2 Comment on ENG-156 handing the npm scope registration back to a human, naming the rung of the ladder to register and the `publishConfig.access: public` requirement
