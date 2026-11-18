# Design

## Context

jen runs as three images from one `Dockerfile`: `jen-runtime`, `jen-agent` and `jen-workspace`. A user starts the runtime's container with the engine's socket, a published port and four settings in its environment (`JEN_OWNER_TOKEN`, `JEN_MODEL`, `JEN_API_KEY`, the optional `JEN_BASE_URL`), then drives the runtime's API with `curl` (`record/environment.md`). The runtime keeps no state of its own: it recovers the tree from Docker's labels at startup and claims its container's name, `<name>-runtime`, as a lock (`agent-runtime`). Agents keep running when the runtime's container is removed, and a runtime started again reads them back.

An agent's `GET /events` streams every saved item from the start, or after `Last-Event-ID`, and never says when it has caught up. Each step's items are saved at once, since the store is synchronous. A root's reply to the owner is the text of a model response with no tool call (`src/agent/model/replies.ts`).

See proposal.md for the commands and why the runtime stays up.

## Goals / Non-Goals

**Goals:**

- **The user never meets Docker, a token or the API.** Every step in `record/environment.md` that a user takes by hand becomes something `jen` does, except building the images, which JEN-26 replaces with getting them.
- **`jen` only drives what exists.** It's a client of the runtime's API as the owner, plus the few engine calls that start and stop the runtime. The tree, grants, waking and stopping stay the runtime's.

**Non-Goals:**

- Getting the images, compiling the command or publishing it. That's JEN-26. Here `jen` uses the images it finds by name and tells the user how to build any that's missing.
- Deleting, renaming or organizing roots, and a current root. The proposal leaves them for later.
- Windows. jen targets macOS and Linux, where Docker and the `docker` command are what this project has run on.
- Migrating an agent's stored state between versions (proposal).

## Decisions

### Where the command lives and how it runs

The command is `src/cli/`, run with `node src/cli/main.ts`. `package.json` gets `"bin": {"jen": "src/cli/main.ts"}`, and `main.ts` starts with `#!/usr/bin/env node`. In a checkout, `npm link` puts `jen` on the path. Measured on 2026-11-18 with Node 26.0.0: a bin linked this way runs its TypeScript from the checkout, because Node resolves the link to its real path, outside `node_modules`, where it strips types.

`src/cli/` imports only types from `src/runtime/` and `src/agent/` (`Agent`, `Item`), so no runtime or agent code runs on the user's machine. `record/environment.md`'s rule that `src/` holds one directory per image becomes: one per image, plus `src/cli/`, which runs on the user's machine.

Files: `main.ts` (parsing the arguments and dispatching), `settings.ts`, `docker.ts` (the engine), `runtime.ts` (starting, checking and stopping the runtime), `api.ts` (the owner's client of the runtime's API), `follow.ts` (watching a root work) and `browser.ts`. Each has unit tests beside it, against fakes of `docker.ts` and the runtime's API.

### Reaching the engine through the `docker` command

`src/cli/docker.ts` runs the user's `docker` command: `run`, `inspect`, `image inspect`, `port`, `ps`, `rm` and `logs`. It doesn't speak the Engine API over a socket, as the runtime does.

The socket's path depends on how the user runs Docker. On this Mac the current context's socket is `~/.docker/run/docker.sock` (measured on 2026-11-18). Colima, OrbStack and remote engines each have their own path, and `DOCKER_HOST` or a context can point anywhere. The `docker` command already resolves all of that the way the user configured it. The runtime's container still mounts `/var/run/docker.sock`, as `record/environment.md` does today, because a bind mount's source is resolved on the engine's host, where that path is the engine's socket.

A `docker` that's missing, or an engine that doesn't answer, is an error saying so, before anything else runs.

*Rejected: `src/runtime/docker.ts` on the host.* It would have to find the socket itself, by reimplementing Docker's contexts, and grow port bindings and bind mounts that only the host side needs.

### Settings

`settings.ts` keeps one JSON file at `$XDG_CONFIG_HOME/jen/settings.json`, or `~/.config/jen/settings.json` when `XDG_CONFIG_HOME` is unset. That's where `gh` keeps its settings on macOS and Linux. The directory is created `0700` and the file `0600`. A write goes to a temporary file in the same directory that's renamed over the old one, so a write cut short leaves the old settings. The file holds:

- `model`, `apiKey` and `baseURL`, which may be empty, meaning OpenAI's endpoint
- `ownerToken`: 32 random bytes as hex, made up the first time settings are saved, and kept
- `port`: the host port the runtime was last published on

`jen config` asks for the model, the base URL and the key, in that order, showing each current value with the key masked. An empty answer keeps the current value. The key is read with echo off. It's saved, and if the runtime is running, it's restarted with the new settings (see below). Agents keep running through that: the runtime sets the model on every call itself, so they follow the new settings at once. Without a terminal on stdin, `jen config` fails, since it can't ask.

The first command that needs the runtime and finds no settings runs `jen config`'s questions first when stdin is a terminal. Otherwise it fails, saying to run `jen config`.

The runtime gets the settings in its environment, passed to `docker run` by name (`-e JEN_API_KEY`) from the child process's environment, so they stay off the command line, as today.

### Starting the runtime on demand

Every command but `jen config` and `jen help` needs the runtime, and calls `ensureRuntime()` first:

1. **The images.** `docker image inspect` the three images. A missing one is an error naming the `docker build` command that makes it.
2. **What's running.** Inspect `<name>-runtime`, and every container labelled `jen.runtime=<name>`. These are the runtime's agents and workspaces.
3. **A new image.** If the runtime's container or any agent or workspace container runs an image ID that isn't the current ID of its image's name, `jen` stops every agent and restarts the runtime (below), and says so.
4. **Start.** If the runtime's container isn't running, remove what's left of it and `docker run -d --name <name>-runtime` with the socket, `-p 127.0.0.1:<port>:8080` and the settings. With no saved port, or if publishing the saved one fails because it's taken, publish `127.0.0.1::8080` and let Docker choose. Then read the port back with `docker port` and save it. Keeping one port keeps a UI's URL the same across restarts, so an open tab reconnects.
5. **Ready.** Poll the port until the runtime answers, for at most 15 seconds. If its container has exited, show the last lines of its logs, which name a missing or bad setting, as the runtime already reports.

`<name>` is `jen`, or `JEN_RUNTIME_NAME` when set, which the runtime reads as it does today. That's how the live check keeps its own runtime apart from the user's.

**Stopping every agent and restarting the runtime** (a new image, or `jen config`): with a running runtime, `POST /agents/<id>/stop` for each root, which stops everything under it. Then `docker rm -f <name>-runtime` and step 4. For `jen config` the stops are skipped: the agents keep running, and the new runtime reads them back. A runtime that isn't running is started on its current image first, so the agents can be stopped through it, since the tree is the runtime's to change.

*Rejected: comparing versions instead of image IDs.* A checkout has no version, and a rebuilt image is exactly the change that should reach agents.

### Roots' names

The owner's `POST /agents` takes `{"grant", "name"}`. A name is 1 to 32 characters of lowercase letters, digits and hyphens, starting with a letter, so it can follow `@` without quoting. The runtime checks it in the tree-operation queue, against the roots it holds then:

- A missing or malformed name from the owner gets `400`.
- A name another root has gets `409`, creating nothing.
- An agent that sends a `name` gets `400`. Sub-agents are addressed by their parent, not by the user.

The name is stored as a `jen.name` label on the root's volume, beside `jen.parent` and `jen.grant`, and every description of an agent gains `"name"`: the root's name, or `null` for a sub-agent and for a root made before this change. Volume labels can't change, which is why a name is fixed.

`jen` gives every new root `{"spawn": true, "workspace": true}`. It finds a root by name in the owner's `GET /agents`. A root without a name is listed by its ID, marked as having no name, and can't be addressed.

*Rejected: optional names.* Every root jen makes has one, and a root without a name can't be reached from `jen`. Requiring it keeps the tree and the command in step.

### Following a root's work

The agent's event stream gains one event: `synced`, whose data is `{"seq": n}`, where `n` is the position of the last item the stream has sent, or 0. A stream sends it when it opens, once it has sent every item saved so far, and again each time it catches up after new items are saved. Each step's items are saved at once and sent in one pass, so a `synced` after an item means that item's step has fully arrived. The runtime relays it unchanged. The UI page doesn't read `/events`, and `EventSource` ignores event types nobody listens for.

`jen @<name> <query>` (`follow.ts`):

1. Open the root's `GET /agents/<id>/events` and read until the first `synced`. Everything before it is history and isn't shown. Its `seq` is where the query starts.
2. Post the query to `/agents/<id>/messages`. A stopped root is started by the runtime, as today.
3. Read the items after that position. Each tool call prints one line to stderr: the tool's name and a summary of its input, cut to the terminal's width. A message from a sub-agent prints a line naming it. Each `error` event prints its message.
4. Once the root's own message from `owner` with the query's text has arrived, the reply is the text of the first model response after it with no tool call. A response ends with any item that isn't an assistant message or a tool call, or with a `synced`. The reply is written to stdout, and `jen` exits 0.

Progress goes to stderr and the reply to stdout, so `jen @<name> <query> > out` keeps only the reply.

If the stream ends before the reply, the root's container stopped or restarted. `jen` asks the runtime for the root's state: if it's `running`, `jen` reopens the stream with `Last-Event-ID` and carries on; if it's `stopped`, it reports that the root stopped and exits 1. Ctrl-C closes the stream, says the root is still working and how to see it (`jen @<name> open`), and exits 130. The root isn't told.

A query that arrives while the root is still working on an earlier one, such as one left with Ctrl-C, is delivered at its next step, and its reply may answer both. That's how the root's inbox already works.

*Rejected: deciding a response has ended after a quiet moment*, as the live checks do with `replies()`. A slow relay could split a response across the pause, and a reply would print before a tool call that belonged to it. `synced` says so outright.

*Rejected: skipping history by matching the query's text.* The same text may already be in the conversation.

### Opening a root's UI

`jen @<name> open` starts the root if it's stopped, with `POST /agents/<id>/start`, since the page route starts nothing. Then it prints `http://127.0.0.1:<port>/agents/<id>/page#token=<owner token>` and opens it with `$BROWSER` when that's set, `open` on macOS, or `xdg-open` on Linux when `DISPLAY` or `WAYLAND_DISPLAY` is set. If none applies, or the opener fails, the printed URL is what the user follows. The URL holds the owner token in its fragment, as it does today, so it's in the terminal's scrollback. That's the same exposure the token already has in the settings file, readable by the same user.

### Listing and stopping

- `jen list` prints one line per root: `@<name>` and `running` or `stopped`, sorted by name, then unnamed roots by ID.
- `jen stop @<name>` posts `/agents/<id>/stop`, which stops the root and everything under it and keeps their state, and leaves the runtime running.
- `jen stop all` stops every root through the runtime, then removes `<name>-runtime`. If nothing of jen is running, there's nothing to stop and it says so. If agents are running without a runtime, the runtime is started first, so stopping goes through it. The agents' network is left, as the runtime leaves it, and reused at the next start.

### Arguments

The first argument decides: `new`, `list`, `stop`, `config`, `help`, or `@<name>`. After `@<name>`, a single argument `open` opens the UI, and anything else is the query: the remaining arguments joined with spaces. No arguments, or a word jen doesn't know, prints the usage and exits 2. A name that isn't a root's is an error suggesting `jen new <name>`.

## Risks / Trade-offs

- **The tree's bound counts every root.** `JEN_MAX_AGENTS` is 10 across the whole runtime, so a few roots with sub-agents reach it. `jen` doesn't change the bound. The refusal names it, and raising it is a setting for the runtime once real use shows what's needed.
- **No way to delete a root from `jen`.** A root made by mistake stays until it's deleted through the API by hand. The open question on organizing and cleaning up agents (`record/plan.md`) owns this.
- **A query that's only `open` can't be sent** (proposal).
- **The owner token sits in the settings file and the UI's URL.** Anyone who can read the user's files or the engine already holds everything jen has, as today.
- **Docker's own messages surface as they are** when a `docker` call fails for a reason `jen` doesn't expect, such as a full disk. `jen` shows them rather than guessing.

## Migration Plan

Roots on the maintainer's laptop have no `jen.name` label, and labels can't be added. `jen list` shows them by ID. Delete them once by hand, through the API, if they're no longer wanted.

## Open Questions

None.
