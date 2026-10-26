# Environment

## Project

- **Repo:** `reveer-ai/jen` on GitHub.
- **Linear:** workspace `reveer`. The `jen` team (key `JEN`) is the product. Linear's GitHub integration has been connected to `reveer-ai` since 2026-10-24. It links a PR to an issue automatically when the issue ID appears in the branch name or the PR title, so don't attach PRs by hand.
- **OpenSpec** 1.15.0, initialized for Claude Code and Codex with the `spec-driven` schema. Its config is in `openspec/config.yaml`. Its skills live in `.claude/skills/` and `.agents/skills/`, and its `/opsx:*` commands in `.claude/commands/opsx/`. All of these are generated, so refresh them with `openspec update` rather than editing them by hand.

## Code

One npm package (ESM, Node ≥ 26) at the repo root. Node runs the TypeScript in `src/` directly, so there's no build output. Unit tests sit next to the code as `*.test.ts`. Live checks against real models are `*.live.test.ts`.

- `src/model/`: the model port (`port.ts`), the scripted fake (`scripted.ts`) and the adapters. Only an adapter imports a model SDK.
- `src/agent/`: the agent loop.

Commands:

- `npm run check` typechecks. It's the build, and it rejects syntax Node can't strip, such as `enum`.
- `npm test` runs the unit tests and never the live checks. CI (`.github/workflows/ci.yml`) runs `npm ci`, `check` and `test` on every push and pull request, with no secrets.
- `npm run test:live` runs only the live checks. Each skips unless `JEN_LIVE_API_KEY` and `JEN_LIVE_MODEL` are set. Add `JEN_LIVE_BASE_URL=https://openrouter.ai/api/v1` to go through OpenRouter, with a model ID such as `openai/<model>`.

## Tool quirks

- **The Linear MCP can't create cycles or change team settings.** Someone has to do that in the Linear UI. For example, the number of upcoming cycles is set under jen team settings → Cycles.
- **Adding an issue to a cycle moves it from Backlog to Todo.**
- **`openspec init` deletes OpenSpec's old global Codex prompts** in `~/.codex/prompts/opsx-*.md`. That's outside the repo, and it does it without asking.
