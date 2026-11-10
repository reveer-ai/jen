# Design

## Context

JEN-7 left a stateless loop: `runTurn(model, tools, conversation, text)` returns the turn's new items and leaves its caller's conversation untouched. A model failure throws, and no items are returned. Items are plain JSON. The model is bound when `OpenAIResponsesModel` is constructed, from a model ID, an API key and an optional base URL. The 2026-10-26 entries in `record/decisions.md` set the container, the volume and SQLite. See proposal.md for why.

Node 26 runs the TypeScript sources directly, and it ships `node:sqlite` without an experimental warning. Both were checked on this machine on 2026-10-27.

## Goals / Non-Goals

**Goals:**

- The container is the only supported way to run an agent. As it gains tools and preinstalled software, running the code anywhere else stops being the same agent. The store and `respond` are still unit-tested in-process, because CI has no container runtime, but that doesn't make the host a place to run agents.
- The store holds items exactly as the loop returns them, so whatever later reads the conversation (JEN-9's protocol, a parent agent, the UI) gets the port's shape.

**Non-Goals:**

- Schema versioning or migrations. jen has no installs to migrate. The first change to the table can add versioning if it's needed then.
- Two processes using one volume at once. One message runs at a time, and JEN-9 owns concurrency.
- Image publishing, registries, multi-arch builds and pinning by digest. That's distribution ([JEN-4](https://linear.app/reveer/issue/JEN-4)).
- Isolation hardening beyond a non-root user. Isolation strength is a deployment setting, per the 2026-10-26 decisions.

## Decisions

### Layout

```
src/agent/store.ts        openStore: the conversation in SQLite
src/main.ts               the entrypoint: config, one message, exit
src/container.live.test.ts  the persistence check
Dockerfile, .dockerignore
```

### The store

```ts
interface Store {
  load(): Item[];
  append(items: readonly Item[]): void;
  close(): void;
}
function openStore(path: string): Store;
```

- **One table, one row per item:** `items(seq INTEGER PRIMARY KEY, item TEXT NOT NULL)`, holding each item as JSON. `load` reads them in `seq` order. This is the "one item becomes one stored row" shape that JEN-7's design chose the flat item list for. *Alternative:* one row per turn, holding a JSON array. Turn boundaries can be derived, since every turn starts with a user message, and nothing needs them yet. *Alternative:* a column per item field. That would mirror the port's union in SQL and change every time the union changes. Nothing queries inside items yet.
- **`append` writes the whole turn in one transaction**, so a turn is saved whole or not at all, even if the process dies partway through.
- **`openStore` creates the database file and the table when they don't exist** (`CREATE TABLE IF NOT EXISTS`). A fresh volume is just an empty conversation.
- **Synchronous**, because `node:sqlite` is. One process handles one message, so there's nothing to block.
- **The file is `/state/agent.db`.** A single file in a directory leaves room for whatever else an agent keeps later. `/state` is a fixed path in the entrypoint, matching the image's `VOLUME /state`, and isn't configurable. The store itself takes its path as a parameter, which is how its tests use a temporary directory.

### The entrypoint

`src/main.ts` exports `respond(store, model, text): Promise<string>`. It loads the conversation, runs `runTurn` with no tools, appends the turn and returns the reply. When the file is run directly (`import.meta.main`), it:

1. reads its configuration from the environment: `JEN_MODEL` and `JEN_API_KEY` are required, and `JEN_BASE_URL` is optional. If one is missing, it exits non-zero and names the variable.
2. takes the message from its arguments, joined with spaces, so `docker run … jen "hello"` works. With no message, it exits non-zero.
3. calls `respond` and writes the reply to stdout. If it fails, it writes the error to stderr and exits non-zero. Nothing has been saved, because `append` only runs after `runTurn` returns.

- **The reply is the text of the assistant messages that end the turn**, joined by blank lines. With no tools, that's the model's one response. If the model returns no text, the reply is empty and the turn is still saved.
- **The model configuration is all in the environment, with no defaults.** The model and its key come from whoever starts the container. Passing variables by name (`-e JEN_API_KEY`) keeps the key off the command line. *Alternative:* a config file on the volume. That's another thing to create before the first run, and nothing else needs it yet.
- **SIGINT and SIGTERM exit at once.** Node runs as PID 1 in the container, and PID 1 gets no default signal handling. Without handlers, Ctrl-C does nothing and `docker stop` waits out its timeout. Exiting mid-turn saves nothing, which is correct. *Alternative:* `tini` or `docker run --init`. That's an extra binary, or a flag every caller has to remember, to do what two lines can do.
- **Message from the arguments, not stdin.** It's the simplest thing for a person at a terminal. JEN-9 replaces this interface anyway.

### The image

```dockerfile
FROM node:26-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
RUN mkdir /state && chown node:node /state
USER node
VOLUME /state
ENTRYPOINT ["node", "src/main.ts"]
```

- **`node:26-slim`**: Debian-based, so the Node is the official build, with none of Alpine's musl differences. The tag isn't pinned to a digest (see Non-Goals).
- **Runtime dependencies only.** `.dockerignore` keeps out `node_modules`, `.env`, `.git`, `openspec`, `context` and the test files. Above all, `.env` holds live credentials.
- **`/state` is created owned by `node` before `VOLUME`.** A new named volume copies that ownership, so the non-root user can write to it with no setup.
- **No npm script for the build.** `docker build -t jen .` is the command, and it's documented in `record/environment.md`. The persistence check runs it itself.

### The persistence check

`src/container.live.test.ts` runs under `npm run test:live`. It reuses `JEN_LIVE_API_KEY`, `JEN_LIVE_MODEL` and `JEN_LIVE_BASE_URL`, and passes them into the container as `JEN_API_KEY`, `JEN_MODEL` and `JEN_BASE_URL`. It skips when the key or model is missing, like the adapter's check. It does not skip when Docker is missing. With credentials set, a missing runtime fails the check, so a broken setup can't pass as a skip.

1. Build the image.
2. Create a uniquely named volume.
3. In a fresh `docker run --rm` container, send a message that asks the model to remember a random word.
4. In a second fresh container on the same volume, ask for the word, and check that the reply contains it.
5. Remove the volume, even if the check fails.

Two separate containers prove more than stopping and restarting one: nothing survives in the container's own filesystem, only on the volume.

Unit tests cover the store against a temporary directory: an empty start, append and reload, order, and reopening the file. They also cover `respond` with the scripted model: the turn is saved, the next turn is sent the stored conversation, and a failed turn saves nothing.

## Risks / Trade-offs

- **Bind-mounting a host directory instead of a named volume can fail on permissions**, because the container user's uid may not own it → the check and the documented commands use a named volume. A bind mount works if its owner matches uid 1000.
- **SQLite locking on network or macOS-shared filesystems is unreliable** → named volumes live inside the runtime's Linux VM, not on a host share. Running two containers against one volume at once isn't supported yet.
- **Environment variables show up in `docker inspect`** → that's acceptable for a local, single-user agent. How secrets reach agents belongs to hosting (JEN-4).
- **The persistence check depends on the model following an instruction to recall a word** → the word is the only content in the conversation, and the adapter's live check already relies on similar instruction-following. If it proves flaky, the check can read `agent.db` from the volume instead.
- **The one-shot entrypoint is thrown away by JEN-9** → it's small, and `respond` and the store carry over unchanged.
