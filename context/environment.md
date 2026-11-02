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
- `src/runtime/`: the runtime, which starts, stops and deletes agents on its Docker engine and relays every request to them. `docker.ts` is a minimal Engine API client over the socket, `runtime.ts` the tree (its only record is Docker labels), `server.ts` the API and relay, and `main.ts` its entrypoint. Unit tests run against the in-memory engine in `fake-docker.ts`.

Commands:

- `npm run check` typechecks. It's the build, and it rejects syntax Node can't strip, such as `enum`.
- `npm test` runs the unit tests and never the live checks. CI (`.github/workflows/ci.yml`) runs `npm ci`, `check` and `test` on every push and pull request, with no secrets.
- `npm run test:live` runs only the live checks. Each skips unless `JEN_LIVE_API_KEY` and `JEN_LIVE_MODEL` are set, either in the environment or in a git-ignored `.env` at the repo root, which only `test:live` loads. Add `JEN_LIVE_BASE_URL=https://openrouter.ai/api/v1` to go through OpenRouter, with a model ID such as `openai/<model>`.
  The container check (`src/container.live.test.ts`) also needs Docker running. With credentials set and no Docker, it fails rather than skips.
  The runtime check (`src/runtime.live.test.ts`) needs Docker the same way, and starts its own runtime under a unique `JEN_RUNTIME_NAME`.
- `docker build -t jen .` builds the one image. Run with no command, it's an agent. Run with `src/runtime/main.ts`, it's the runtime, and jen runs by starting the runtime and spawning agents through it. The runtime needs the engine's socket, which is why it runs as root, and the owner's token, `JEN_OWNER_TOKEN`. It passes its `JEN_MODEL`, `JEN_API_KEY` and optional `JEN_BASE_URL` to every agent. Pass them by name so they stay off the command line, and publish the port on `127.0.0.1` to keep the runtime local:

  ```sh
  export JEN_OWNER_TOKEN=$(openssl rand -hex 32)
  docker run -d --name jen-runtime --user root -v /var/run/docker.sock:/var/run/docker.sock -p 127.0.0.1:8080:8080 -e JEN_OWNER_TOKEN -e JEN_MODEL -e JEN_API_KEY -e JEN_BASE_URL jen src/runtime/main.ts
  curl -H "Authorization: Bearer $JEN_OWNER_TOKEN" -d '{"grant":{"spawn":true}}' localhost:8080/agents
  export AGENT=<the id it returned>
  curl -H "Authorization: Bearer $JEN_OWNER_TOKEN" -d '{"text":"Remember the word heron."}' localhost:8080/agents/$AGENT/messages
  curl -N -H "Authorization: Bearer $JEN_OWNER_TOKEN" localhost:8080/agents/$AGENT/events
  curl -X POST -H "Authorization: Bearer $JEN_OWNER_TOKEN" localhost:8080/agents/$AGENT/stop
  curl -X DELETE -H "Authorization: Bearer $JEN_OWNER_TOKEN" localhost:8080/agents/$AGENT
  ```

  `POST /agents` answers `201` with `{"id", "parent", "grant", "state"}` once the agent accepts connections. `GET /agents` lists every agent, and `POST /agents/<id>/start` starts a stopped one from its stored conversation. `/messages` and `/events` are relayed to the agent's protocol unchanged: `POST` answers `{"reply": "…"}` once the turn is saved, and `/events` streams every saved item as Server-Sent Events, resuming after a `Last-Event-ID` header. The full API is in `openspec/specs/agent-runtime/spec.md`.

  Stopping an agent removes its container and keeps its volume, `jen-agent-<id>`. Deleting it removes both, and both act on everything under it. `docker rm -fv jen-runtime` stops only the runtime (`-v` removes the anonymous `/state` volume the image gives every container, which the runtime doesn't use): agents keep running, and a runtime started again with the same command reads the tree back from Docker. To remove everything, delete each agent, then the runtime and its network with `docker network rm jen`. Optional settings: `JEN_RUNTIME_NAME` (default `jen`, which prefixes the runtime's container, network and agents), `JEN_IMAGE` (default `jen`), `JEN_MAX_DEPTH` (default 3) and `JEN_MAX_AGENTS` (default 10).

## Tool quirks

- **The Linear MCP can't create cycles or change team settings.** Someone has to do that in the Linear UI. For example, the number of upcoming cycles is set under jen team settings → Cycles.
- **Adding an issue to a cycle moves it from Backlog to Todo.**
- **`openspec init` deletes OpenSpec's old global Codex prompts** in `~/.codex/prompts/opsx-*.md`. That's outside the repo, and it does it without asking.
