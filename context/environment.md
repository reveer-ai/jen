# Environment

## Project

- **Repo:** `reveer-ai/jen` on GitHub.
- **Linear:** workspace `reveer`. The `jen` team (key `JEN`) is the product. Linear's GitHub integration has been connected to `reveer-ai` since 2026-10-24. It links a PR to an issue automatically when the issue ID appears in the branch name or the PR title, so don't attach PRs by hand.
- **OpenSpec** 1.15.0, initialized for Claude Code and Codex with the `spec-driven` schema. Its config is in `openspec/config.yaml`. Its skills live in `.claude/skills/` and `.agents/skills/`, and its `/opsx:*` commands in `.claude/commands/opsx/`. All of these are generated, so refresh them with `openspec update` rather than editing them by hand.

## Code

One npm package (ESM, Node ≥ 26) at the repo root. Node runs the TypeScript in `src/` directly, so there's no build output. Unit tests sit next to the code as `*.test.ts`. Live checks against real models are `*.live.test.ts`.

- `src/model/`: the model port (`port.ts`), the scripted fake (`scripted.ts`) and the adapters. Only an adapter imports a model SDK.
- `src/agent/`: the agent loop, its store (`store.ts`, the conversation in SQLite) and `respond.ts`, which runs and saves one turn.
- `src/server.ts`: the agent's protocol over HTTP: `POST /messages`, the `GET /events` stream and the bearer token.
- `src/main.ts`: the agent's entrypoint. It serves the protocol on port 8080. The container is the only supported way to run it.

Commands:

- `npm run check` typechecks. It's the build, and it rejects syntax Node can't strip, such as `enum`.
- `npm test` runs the unit tests and never the live checks. CI (`.github/workflows/ci.yml`) runs `npm ci`, `check` and `test` on every push and pull request, with no secrets.
- `npm run test:live` runs only the live checks. Each skips unless `JEN_LIVE_API_KEY` and `JEN_LIVE_MODEL` are set, either in the environment or in a git-ignored `.env` at the repo root, which only `test:live` loads. Add `JEN_LIVE_BASE_URL=https://openrouter.ai/api/v1` to go through OpenRouter, with a model ID such as `openai/<model>`.
  The container check (`src/container.live.test.ts`) also needs Docker running. With credentials set and no Docker, it fails rather than skips.
- `docker build -t jen .` builds the agent's image. Run it detached on a named volume, which keeps the conversation between containers. The model comes from `JEN_MODEL`, `JEN_API_KEY` and the optional `JEN_BASE_URL`, and every request must carry `JEN_TOKEN` as a bearer token. Pass them by name so they stay off the command line, and publish the port on `127.0.0.1` to keep the agent local:

  ```sh
  export JEN_TOKEN=$(openssl rand -hex 32)
  docker volume create jen-state
  docker run -d --name jen -p 127.0.0.1:8080:8080 -v jen-state:/state -e JEN_MODEL -e JEN_API_KEY -e JEN_BASE_URL -e JEN_TOKEN jen
  curl -H "Authorization: Bearer $JEN_TOKEN" -d '{"text":"Remember the word heron."}' localhost:8080/messages
  curl -N -H "Authorization: Bearer $JEN_TOKEN" localhost:8080/events
  ```

  `POST /messages` answers with `{"reply": "…"}` once the turn is saved. `/events` streams every saved item as Server-Sent Events, and resumes after the item named by a `Last-Event-ID` header. Stop the agent with `docker rm -f jen`.

  Use a named volume, not a bind mount: the agent runs as uid 1000, which may not own a host directory.

## Tool quirks

- **The Linear MCP can't create cycles or change team settings.** Someone has to do that in the Linear UI. For example, the number of upcoming cycles is set under jen team settings → Cycles.
- **Adding an issue to a cycle moves it from Backlog to Todo.**
- **`openspec init` deletes OpenSpec's old global Codex prompts** in `~/.codex/prompts/opsx-*.md`. That's outside the repo, and it does it without asking.
