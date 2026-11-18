# Proposal

## Why

Using jen today takes the steps in `record/environment.md`: build three images, start the runtime with a long `docker run`, make up an owner token, spawn and message agents with `curl`, and open a UI from a URL that holds the token. Nobody but the maintainer can do that, and the maintainer shouldn't have to. [JEN-25](https://linear.app/reveer/issue/JEN-25) gives jen its command, `jen`. The user talks to their root agents with it in the terminal and opens their UIs in the browser, and never touches Docker, a token or the runtime's API. Publishing the command to npm as `jenai` is [JEN-26](https://linear.app/reveer/issue/JEN-26).

## What Changes

- **A new `jen` command, run on the user's machine, outside any container.** It's jen's first code that isn't an image, so `src/` gains `src/cli/` beside `src/agent/` and `src/runtime/`. The command uses the runtime's API as the owner and talks to the engine only to start and stop the runtime. In this change it runs from a checkout and uses the images it finds by name. How a user without a checkout gets the command and the images is JEN-26.
- **The user addresses root agents by name, always.** A user can have several root agents, each keeping its sub-agents over time, so every command names its root with `@<name>`. There's no current or default root. That can come later.

  ```text
  jen new <name>          create a root agent named <name>
  jen @<name> <query>     send <query> to that root and show its progress and reply
  jen @<name> open        open that root's UI in the browser
  jen list                list the roots and whether each is running
  jen stop @<name>        stop that root and everything under it
  jen stop all            stop every agent and the runtime
  ```

- **Roots get names from the runtime.** The owner's `POST /agents` takes a `name` for the root, kept as a label beside the tree, and the runtime refuses a name another root already has. Every root the owner spawns has one, and a sub-agent has none. The label is fixed at creation, so a name can't change yet. A new root gets `spawn` and `workspace`, so it can delegate, work in its workspace and publish a UI. Only the user creates roots, as the runtime already ensures.
- **`jen @<name> <query>` shows progress, then the reply.** It prints a short line for each tool call and each sub-agent the root starts, then the root's reply in full when its turn ends. Ctrl-C stops watching and leaves the root working. A failed model call is shown as it happens.
- **`jen @<name> open` opens the UI.** It starts the root if it's stopped, since the page starts nothing, then opens the browser where the system can and always prints the URL, for environments where it can't. One consequence: a query that is only the word `open` can't be sent this way.
- **The runtime starts on demand and runs until `jen stop all`.** Any command that needs the runtime starts it first. It isn't stopped when a query ends: a root's UI is served through it, a root's work can outlast its reply, and a stopped root is woken for a message, as today. `jen stop @<name>` stops one root and its sub-agents and leaves the runtime up. Stopping keeps every conversation and workspace.
- **A new image stops the agents running on the old one.** When the runtime or agent image the command would start isn't what's running, `jen` stops every agent and restarts the runtime on the new image. Each agent then starts on the new image at its next message. Today a rebuilt image reaches an agent only after a stop and start by hand. Nothing migrates an agent's stored state between versions, which is accepted until jen has users whose agents must survive an upgrade.
- **Settings are asked for, not edited.** The first command that needs the runtime asks for the model and the model key, without echoing the key, and the optional base URL. `jen config` changes them later. jen makes up the owner token itself. All of them are kept in one file only `jen` reads and writes, readable only by the user, in the user's config directory. The user never opens it. The runtime still gets them as its environment when `jen` starts it.

*Alternative: keep the settings in a Docker volume the runtime owns, so nothing lands on the host.* It was the first option discussed, since the maintainer preferred settings that aren't "just a file". But the runtime keeps no state of its own by design (`agent-runtime`): it recovers the tree from Docker's labels, so any runtime started on the engine is the same runtime. A settings volume would make it stateful. The command also needs the owner token on every run, and reading it from a volume means running a container each time. A file only `jen` touches is what `gh` and `npm` do with their credentials, and it keeps the runtime as it is.

*Alternative: the system keychain (macOS Keychain, Secret Service on Linux).* It keeps the key out of a plain file. But Node has no keychain API, each system needs its own tool, and the key still reaches the runtime's environment, where anyone with the engine can read it, as they can today.

## Capabilities

### New Capabilities

- `jen-command`: the `jen` command. How the user creates, lists, messages, opens and stops root agents. What it shows while a root works. How it starts the runtime, keeps it running, restarts it on a new image and stops it. How it asks for and keeps its settings.

### Modified Capabilities

- `agent-runtime`: the owner spawns a root with a name, unique among the runtime's roots and reported with the agent.
- `agent-protocol`: the event stream says when it has sent every item saved so far, so a watcher can tell history from what's new and knows when a saved step has fully arrived.

## Impact

- **New code:** `src/cli/`, the command and its unit tests. It needs a client for the engine to start and stop the runtime's container. The design decides whether it shares `src/runtime/docker.ts`, which today ships only in the runtime image.
- **Runtime code:** `src/runtime/runtime.ts` and `src/runtime/server.ts`, for roots' names.
- **Agent code:** `src/agent/server.ts`, for the event stream's new event.
- **Checks:** a live check that drives `jen` against a real runtime: create a root, send it a query, see the progress and the reply, open its UI, and stop it.
- **`package.json`:** a `bin` entry for `jen`, so `npm link` in a checkout puts the command on the user's path.
- **Record:** `record/environment.md`, whose run instructions become `jen` commands and whose rule that `src/` holds one directory per image changes. `record/decisions.md` gets the decisions.
- **Docs:** `docs/architecture.html` gains the command.
