# Design

## Context

jen runs as three images from one `Dockerfile`: `jen-runtime`, `jen-agent` and `jen-workspace`. A user starts the runtime's container with the engine's socket, a published port and four settings in its environment (`JEN_OWNER_TOKEN`, `JEN_MODEL`, `JEN_API_KEY`, the optional `JEN_BASE_URL`), then drives the runtime's API with `curl` (`record/environment.md`). The runtime keeps no state of its own: it recovers the tree from Docker's labels at startup and claims its container's name, `<name>-runtime`, as a lock (`agent-runtime`). Agents keep running when the runtime's container is removed, and a runtime started again reads them back.

An agent's `GET /events` streams every saved item from the start, or after `Last-Event-ID`, and never says when it has caught up. Each step's items are saved at once, since the store is synchronous. A root's reply to the owner is the text of a model response with no tool call (`src/agent/model/replies.ts`).

See proposal.md for the commands and why the runtime stays up.

## Goals / Non-Goals

**Goals:**

- **The user never meets Docker, a token or the API.** Every step in `record/environment.md` that a user takes by hand becomes something `jen` does, except building the images, which JEN-26 replaces with getting them.
- **`jen` only drives what exists.** It's a client of the runtime's API as the owner, plus the few engine calls that keep its settings, start and stop the runtime, and delete everything at uninstall. The tree, grants, waking and stopping stay the runtime's.
- **All of jen is in Docker, and goes in one step.** Nothing of jen's lands in the user's home folder, and `jen uninstall` leaves nothing behind.

**Non-Goals:**

- Getting the images, compiling the command or publishing it. That's JEN-26. Here `jen` uses the images it finds by name and tells the user how to build any that's missing.
- Deleting, renaming or organizing roots, and a current root. The proposal leaves them for later.
- Windows. jen targets macOS and Linux, where Docker and the `docker` command are what this project has run on.
- Migrating an agent's stored state between versions (proposal).

## Decisions

### Where the command lives and how it runs

The command is `src/cli/`, run with `node src/cli/main.ts`. `package.json` gets `"bin": {"jen": "src/cli/main.ts"}`, and `main.ts` starts with `#!/usr/bin/env node`. In a checkout, `npm link` puts `jen` on the path. Measured on 2026-11-18 with Node 26.0.0: a bin linked this way runs its TypeScript from the checkout, because Node resolves the link to its real path, outside `node_modules`, where it strips types.

`src/cli/` imports only types from `src/runtime/` and `src/agent/` (`Agent`, `Item`), so no runtime or agent code runs on the user's machine. `record/environment.md`'s rule that `src/` holds one directory per image becomes: one per image, plus `src/cli/`, which runs on the user's machine.

Files: `main.ts` (parsing the arguments and dispatching), `settings.ts`, `docker.ts` (the engine), `runtime.ts` (starting, checking and stopping the runtime), `api.ts` (the owner's client of the runtime's API), `follow.ts` (watching a root work), `browser.ts` and `uninstall.ts`. Each has unit tests beside it, against fakes of `docker.ts` and the runtime's API.

### Reaching the engine through the `docker` command

`src/cli/docker.ts` runs the user's `docker` command: `run`, `inspect`, `image inspect`, `image rm`, `port`, `ps`, `rm`, `logs`, `volume` and `network rm`. It doesn't speak the Engine API over a socket, as the runtime does.

The socket's path depends on how the user runs Docker. On this Mac the current context's socket is `~/.docker/run/docker.sock` (measured on 2026-11-18). Colima, OrbStack and remote engines each have their own path, and `DOCKER_HOST` or a context can point anywhere. The `docker` command already resolves all of that the way the user configured it. The runtime's container still mounts `/var/run/docker.sock`, as `record/environment.md` does today, because a bind mount's source is resolved on the engine's host, where that path is the engine's socket.

A `docker` that's missing, or an engine that doesn't answer, is an error saying so, before anything else runs.

*Rejected: `src/runtime/docker.ts` on the host.* It would have to find the socket itself, by reimplementing Docker's contexts, and grow port bindings and bind mounts that only the host side needs.

### Settings

The settings live in a Docker volume of the command's own, `<name>-settings`, labelled `jen.runtime=<name>` and `jen.settings`, holding one file, `settings.json`:

- `model`, `apiKey` and `baseURL`, which may be empty, meaning OpenAI's endpoint
- `ownerToken`: 32 random bytes as hex, made up the first time settings are saved, and kept
- `port`: the host port the runtime was last published on

The runtime never mounts or reads the volume, so it keeps no state of its own. It gets the settings in its environment, passed to `docker run` by name (`-e JEN_API_KEY`) from the child process's environment, so they stay off the command line, as today. Nothing the runtime does at startup touches the volume: it reads only volumes labelled `jen.agent`, and removes only ones labelled `jen.workspace` (`src/runtime/runtime.ts`).

**Reading.** While the runtime is running, `jen` reads the owner token from its container's environment with `docker inspect`, and its port with `docker port`. That's every command once the runtime is up, and it starts no container. Only when the runtime has to start, and for `jen config`, does `jen` read the volume, with a short-lived container of the runtime's image: `docker run --rm --network none -v <name>-settings:/settings:ro --entrypoint cat <runtime image> /settings/settings.json`. A missing volume or file means there are no settings yet. The runtime's image is always there by then (step 1 below), so reading needs no other image.

**Writing.** `docker volume create` with the labels, which leaves an existing volume as it is. Then a short-lived container of the runtime's image, with no network and the volume mounted, writes the JSON it reads from stdin to a temporary file and renames it over `settings.json`. A write cut short leaves the old settings, and the key never appears on a command line. A write happens when `jen config` saves, and when the runtime's port changes.

**`jen config`** asks for the model, the base URL and the key, in that order, showing each current value with the key masked. An empty answer keeps the current value. The key is read with echo off. Once it's saved, a running runtime is replaced with one that has the new settings (see below). Agents keep running through that: the runtime sets the model on every call itself, so they follow the new settings at once. Without a terminal on stdin, `jen config` fails, since it can't ask. It needs the runtime's image to read and write the volume, so a missing one is the same error as at start (step 1 below).

The first command that needs the runtime and finds no settings runs `jen config`'s questions first when stdin is a terminal. Otherwise it fails, saying to run `jen config`.

*Rejected: editing the settings in the user's `$VISUAL` or `$EDITOR`, as `git commit` does.* It shows every setting at once, but it puts the key in a file on the host while it's edited, and an editor may copy that file into swap, backup or undo files that `jen` can't find or delete. That leaves the key outside Docker, where `jen uninstall` can't remove it. Discussed with the maintainer on 2026-11-18. An editor becomes worth it for the settings that aren't secret once there are enough of them.

*Rejected: a file in `~/.config/jen/`, which needs no container to read.* It's the one piece of jen that would live outside Docker, and the maintainer wants jen in one place (proposal). Reading the running runtime's environment keeps the cost to a container at start, which already takes seconds.

### Starting the runtime on demand

Every command but `jen config`, `jen uninstall` and `jen help` needs the runtime, and calls `ensureRuntime()` first:

1. **The images.** `docker image inspect` the three images. A missing one is an error naming the `docker build` command that makes it.
2. **What's running.** Inspect `<name>-runtime`, and every container labelled `jen.runtime=<name>`. These are the runtime's agents and workspaces.
3. **A new image.** If the runtime's container or any agent or workspace container runs an image ID that isn't the current ID of its image's name, `jen` stops every agent and restarts the runtime (below), and says so.
4. **Start.** If the runtime's container isn't running, remove what's left of it and `docker run -d --name <name>-runtime` with the socket, `-p 127.0.0.1:<port>:8080` and the settings. With no saved port, publish `127.0.0.1::8080` and let Docker choose. If the saved port fails to start, which is how a taken port shows, remove the container and retry once with a port Docker chooses. A conflict on the container's name means another `jen` is starting the runtime, so this one goes on to step 5 and waits for it. Then read the port back with `docker port` and save it. Keeping one port keeps a UI's URL the same across restarts, so an open tab reconnects.
5. **Ready.** Poll the port until the runtime answers, for at most 15 seconds. If its container has exited, show the last lines of its logs, which name a missing or bad setting, as the runtime already reports.

`<name>` is `jen`, or `JEN_RUNTIME_NAME` when set, which the runtime reads as it does today. The images are `jen-runtime`, `jen-agent` and `jen-workspace`, or `JEN_RUNTIME_IMAGE`, `JEN_AGENT_IMAGE` and `JEN_WORKSPACE_IMAGE` when set, the last two passed on to the runtime, which already reads them. That's how the live check keeps its own runtime, settings and images apart from the user's. It tags its own copies of the images, so its `jen uninstall` removes only those tags.

`jen` labels the runtime's container `jen.runtime=<name>`, as everything else of jen's is, so uninstalling finds it. The runtime reads only containers that are also labelled `jen.agent` or `jen.workspace`, so the label changes nothing for it.

**Stopping every agent and restarting the runtime** (a new image, or `jen config`): with a running runtime, `POST /agents/<id>/stop` for each root, which stops everything under it. Then, if the runtime itself is on an old image, `docker rm -f <name>-runtime` and step 4; one already on its current image is left running, since restarting it would change nothing. A runtime that isn't running is started first, on its current image, so the agents can be stopped through it, since the tree is the runtime's to change. For `jen config` the stops are skipped and the runtime is always replaced, so it gets the new settings: the agents keep running, and the new runtime reads them back.

*Rejected: comparing versions instead of image IDs.* A checkout has no version, and a rebuilt image is exactly the change that should reach agents.

### Roots' names

The owner's `POST /agents` takes `{"grant", "name"}`. A name is 1 to 32 characters of lowercase letters, digits and hyphens, starting with a letter, so it can follow `@` without quoting. The runtime checks it in the tree-operation queue, against the roots it holds then:

- A missing or malformed name from the owner gets `400`.
- A name another root has gets `409`, creating nothing.
- An agent that sends a `name` gets `400`. Sub-agents are addressed by their parent, not by the user.

The name is stored as a `jen.name` label on the root's volume, beside `jen.parent` and `jen.grant`, and every description of an agent gains `"name"`: the root's name, or `null` for a sub-agent and for a root made before this change. Volume labels can't change, which is why a name is fixed.

`jen` gives every new root `{"spawn": true, "workspace": true}`. It finds a root by name in the owner's `GET /agents`. A root without a name is listed by its ID, marked as having no name, and can't be addressed.

*Rejected: optional names.* Every root jen makes has one, and a root without a name can't be reached from `jen`. Requiring it keeps the tree and the command in step. The tests and live checks that spawn roots give them names.

### Following a root's work

The agent's event stream gains one event: `synced`, whose data is `{"seq": n}`, where `n` is the position of the last item the stream has sent, or 0. A stream sends it when it opens, once it has sent every item saved so far, and again each time it catches up after new items are saved. Each step's items are saved at once and sent in one pass, so a `synced` after an item means that item's step has fully arrived. The runtime relays it unchanged. The UI page reads `/events` to see `publish_ui` finish, but acts only on `item` and `error` events, and moves its resume cursor only on an event with an ID, which `synced` doesn't have, so it ignores `synced`.

`jen @<name> <query>` (`follow.ts`):

1. If the root is stopped, start it with `POST /agents/<id>/start`, since the runtime relays `/events` only to a running agent. Then open the root's `GET /agents/<id>/events` and read until the first `synced`. Everything before it is history and isn't shown, and its `seq` is where the query starts. A `409` when opening the stream means the root stopped in between, and is an error saying so.
2. Post the query to `/agents/<id>/messages`. A stopped root is started by the runtime, as today.
3. Read the items after that position. Each tool call prints one line to stderr: the tool's name and a summary of its input, cut to the terminal's width. A message from a sub-agent prints a line naming it. Each `error` event prints its message.
4. Once the root's own message from `owner` with the query's text has arrived, the reply is the text of the first model response after it with no tool call. A response ends with any item that isn't an assistant message or a tool call, or with a `synced`. The reply is written to stdout, and `jen` exits 0.

Progress goes to stderr and the reply to stdout, so `jen @<name> <query> > out` keeps only the reply.

If the stream ends before the reply, the root's container stopped or restarted, or the runtime was replaced. `jen` asks the runtime for the root's state, waiting for the runtime to answer for as long as a start may take (step 5 above), so a runtime being replaced doesn't end the query: if it's `running`, `jen` reopens the stream with `Last-Event-ID` and carries on; if it's `stopped`, it reports that the root stopped and exits 1. Ctrl-C closes the stream, says the root is still working and how to see it (`jen @<name> open`), and exits 130. The root isn't told.

A query that arrives while the root is still working on an earlier one, such as one left with Ctrl-C, is delivered at its next step, and its reply may answer both. That's how the root's inbox already works.

*Rejected: deciding a response has ended after a quiet moment*, as the live checks do with `replies()`. A slow relay could split a response across the pause, and a reply would print before a tool call that belonged to it. `synced` says so outright.

*Rejected: skipping history by matching the query's text.* The same text may already be in the conversation.

### Opening a root's UI

`jen @<name> open` starts the root if it's stopped, with `POST /agents/<id>/start`, since the page route starts nothing. Then it prints `http://127.0.0.1:<port>/agents/<id>/page#token=<owner token>` and opens it with `$BROWSER` when that's set, `open` on macOS, or `xdg-open` on Linux when `DISPLAY` or `WAYLAND_DISPLAY` is set. If none applies, or the opener fails, the printed URL is what the user follows. The URL holds the owner token in its fragment, as it does today, so it's in the terminal's scrollback. Anyone who can read the user's terminal can already run `jen` as them.

### Listing and stopping

- `jen list` prints one line per root: `@<name>` and `running` or `stopped`, sorted by name, then unnamed roots by ID.
- `jen stop @<name>` posts `/agents/<id>/stop`, which stops the root and everything under it and keeps their state, and leaves the runtime running.
- `jen stop all` stops every root through the runtime, then removes `<name>-runtime`. If nothing of jen is running, there's nothing to stop and it says so. If agents are running without a runtime, the runtime is started first, so stopping goes through it. The agents' network is left, as the runtime leaves it, and reused at the next start.

### Uninstalling

`jen uninstall` asks `This deletes every agent's conversation and files, and can't be undone. Continue? [y/N]`, and goes on only on `y`. Without a terminal on stdin it fails, since it can't ask. Then, through the `docker` command:

1. `docker rm -f <name>-runtime` first, so no runtime watches the agents go and reports their exits, then every container labelled `jen.runtime=<name>`: every agent and every workspace. Removing the runtime by name also catches one started by hand before this change, without the label.
2. `docker volume rm` every volume labelled `jen.runtime=<name>`: every agent's state, every workspace and the settings. Volumes go after containers, since Docker won't remove a volume in use.
3. `docker network rm <name>`.
4. `docker image rm` the three images. One that's missing is skipped.
5. Remove the package: when the real path of the running `main.ts` is inside `npm root -g`'s `jenai` folder, run `npm uninstall -g jenai`. Otherwise, as with `npm link` from a checkout or `npx`, say that jen's data is gone and the command was installed some other way, to be removed the way it was installed. Every module `jen` needs is imported at startup, so removing its own files doesn't break it while it finishes.

It doesn't go through the runtime, which is being removed too, so it works when the runtime can't start, such as with no settings or a missing image. Each step goes on past a failure and reports it at the end, so one stuck object doesn't leave the rest behind. It prints what it removed: how many agents, and the runtime, settings and images.

### Arguments

The first argument decides: `new`, `list`, `stop`, `config`, `uninstall`, `help`, or `@<name>`. After `@<name>`, a single argument `open` opens the UI, and anything else is the query: the remaining arguments joined with spaces. No arguments, or a word jen doesn't know, prints the usage and exits 2. A name that isn't a root's is an error suggesting `jen new <name>`.

## Risks / Trade-offs

- **The tree's bound counts every root.** `JEN_MAX_AGENTS` is 10 across the whole runtime, so a few roots with sub-agents reach it. `jen` doesn't change the bound. The refusal names it, and raising it is a setting for the runtime once real use shows what's needed.
- **No way to delete a root from `jen`.** A root made by mistake stays until it's deleted through the API by hand. The open question on organizing and cleaning up agents (`record/plan.md`) owns this.
- **A query that's only `open` can't be sent** (proposal).
- **The owner token and the key sit in the settings volume and the runtime's environment, and the token in the UI's URL.** Anyone who can reach the engine already holds everything jen has, as today.
- **Removing the settings volume by hand** loses the settings, and the next command asks for them again. The agents are untouched.
- **`npm uninstall -g jenai` on its own leaves everything in Docker.** npm runs no script of a package when it's uninstalled (npm v7 and later, checked in npm 11.12.1's docs). The usage text points to `jen uninstall`, and everything left is labelled, so installing jen again and uninstalling with it cleans it up.
- **Starting the runtime costs a short-lived container** to read the settings. On Docker Desktop 29.4.1 on the maintainer's Mac, measured on 2026-11-18, one takes 0.12 to 0.13 seconds (six runs), a small part of a start that already takes seconds.
- **A turn that saves nothing isn't seen.** A model response with no tool call and no output items ends the root's turn without saving an item (`store.endTurn`), so `jen` waits until Ctrl-C. Making every turn's end visible would add an item the model sees on every later call, for a response that's rare.
- **Replacing the runtime cuts calls in flight.** A model call an agent is making while `jen config` or a new image replaces the runtime fails, shows as an error line in any `jen` following that root, and is retried by the agent's loop, as any failed model call is. A `jen` following a root through the old runtime reconnects through the new one.
- **Two commands replacing the runtime for a new image at once** can each remove the runtime the other started. It takes a rebuilt image and two commands in the same moment, and the next command starts the runtime again.
- **Docker's own messages surface as they are** when a `docker` call fails for a reason `jen` doesn't expect, such as a full disk. `jen` shows them rather than guessing.

## Migration Plan

Roots on the maintainer's laptop have no `jen.name` label, and labels can't be added. `jen list` shows them by ID. Delete them once by hand, through the API, if they're no longer wanted.

## Open Questions

None.
