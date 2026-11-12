# Proposal

## Why

A jen agent can think and delegate, but it can't do work: it can't write code and run it, build or test anything. This change ([JEN-20](https://linear.app/reveer/issue/JEN-20)) gives an agent a workspace that survives its restarts and a tool to run commands in it. It also sets the workspace's boundary: what a command can and can't reach. [JEN-19](https://linear.app/reveer/issue/JEN-19)'s file tools will run inside the same boundary.

Run in the agent's own container, a command could reach everything that makes the agent itself. Probed on 2026-11-10 and 2026-11-11 on Docker Desktop, a command running as the agent's user read `JEN_TOKEN` from the agent's `/proc/1/environ`, rewrote `agent.db`, and reached the internet. Two ways of fencing commands off inside that container were rejected:
- **bubblewrap** can't create its namespaces under Docker's default seccomp profile, and with seccomp turned off it still couldn't mount `/proc`. Running it would mean loosening the container that stands between a kernel bug and the Docker engine.
- **Landlock** works under Docker's defaults. But it is a set of rules over a filesystem the command still shares with the agent. Before Landlock's version 3 (Linux 6.2), a command could still empty `agent.db` with `truncate()`, which was measured. The command would also share the agent's memory, CPU and process limits.

So an agent's work runs in a container of its own beside the agent's, which the runtime creates and is the only way into. What a command can reach is fixed by what that container is given. That holds on any kernel Docker runs on.

## What Changes

- **A `workspace` grant.** It works like `spawn`: the owner sets it on a root agent, and a parent can pass it on only if it has it itself. An agent without it gets no workspace and no command tool. A sub-agent that only thinks or talks costs nothing extra. One grant covers the workspace and every tool that works in it, JEN-19's file tools included.
- **A workspace container for each agent with the grant**, beside the agent's own and started from a new workspace image. It holds only the image's tools and a workspace volume of its own. It has:
  - no state volume and no Docker socket
  - none of jen's settings in its environment
  - no network beyond its own loopback, so it isn't on the runtime's network
  - fixed limits of its own on processes, memory and CPU
  - no capabilities, `no-new-privileges`, and a root filesystem that can't be written outside the workspace, `/tmp` and `/dev/shm`, Docker's small shared-memory mount
- **The workspace follows what's done to its agent, not what happens to its process.**
  - **Spawning** creates and starts the workspace container before the agent's.
  - **Stopping** removes it, so its processes end and its files are kept.
  - **Starting** creates it again, before the agent's.
  - **Deleting** removes it and its volume.
  - **A crash of the agent's process** leaves it running. When the agent's restarts run out, the runtime stops the agent, and the workspace container goes with it.
- **The runtime runs an agent's commands.** A new route lets an agent, with its own token, run a command in its own workspace and no other. The runtime runs it with the engine's exec. The agent has no other way into its workspace.
- **A `run_command` tool.** It runs a bash command in the workspace and returns its exit code and output.
  - **Timeout:** the agent can set one per command. The default is 2 minutes, and a fixed maximum of 10 minutes can't be exceeded. A timeout, or an urgent message that cancels the call, kills what is still running from the call.
  - **Background processes:** the tool returns when the command's shell exits. Anything the command started in the background keeps running until the workspace container is removed, so `npm run dev > dev.log &` works as it would in a terminal.
  - **Output:** capped at about 8 KB, keeping the start and the end. When output is cut, the whole of it is saved to a file in the workspace, and the result names the file. The tool's description tells the model about the cap and the timeout, so it can redirect large output itself.
- **A workspace image, `jen-workspace`**, built as a third target of the one `Dockerfile` on the agent's Debian base. Nothing can be installed into a workspace that has no network, so the image is the agent's whole toolset: Node, git, python3, `ps` and `kill`, `curl` for its own loopback, ripgrep and jq. **Supersedes in part** the 2026-11-03 decision that the agent's image grows with its tools: tools ship in the workspace image, and the agent's image stays only jen's code.
- **A live boundary check.** It runs from a real workspace container and fails if a command can:
  - see any of jen's settings
  - see the agent's process or its state
  - reach the runtime, another agent or the internet
  - use more than its fixed limits

  It also checks that the workspace's files survive a stop and start, and that a background process outlives its call but not a stop.
- **The behavior check gains a task that needs a command whose output exceeds the cap.** It shows whether a model of `openai/gpt-6-luna`'s class works within the cap without being walked through it.

## Capabilities

### New Capabilities

- `agent-workspace`:
  - the workspace container and its boundary
  - its lifecycle beside the agent's
  - the workspace image
  - the `run_command` tool with its timeout, background processes and output cap
  - the live boundary check

### Modified Capabilities

- `agent-runtime`:
  - Grants gain `workspace`, which the owner always has.
  - Spawning, stopping, starting, deleting and a failed spawn each cover the workspace container and its volume.
  - The new route that runs a command in the caller's own workspace.
  - The runtime alone decides how a workspace runs, as it does for an agent.
  - There are three images, each holding only its own side.
- `agent-delegation`: tools follow the grant. An agent with `workspace` and without `spawn` is offered `run_command` and nothing else, where an agent without `spawn` is offered no tools today. The behavior check gains its command task.

## Impact

- **Runtime code:**
  - `src/runtime/runtime.ts`: the workspace container's lifecycle and the grant
  - `src/runtime/docker.ts`: exec, the container's limits and hardening, a second volume
  - `src/runtime/server.ts`: the new route
  - `src/runtime/fake-docker.ts`: exec and the new settings for the unit tests
- **Agent code:** the tool goes in a new `src/agent/workspace.ts`, and `src/agent/delegation.ts` gets the grant. The tool's description is behavior, so the behavior check runs on Luna, as `src/agent/AGENTS.md` requires.
- **Build:** the `Dockerfile` gains the `workspace` target. The runtime starts workspaces from a new optional setting, `JEN_WORKSPACE_IMAGE`, with default `jen-workspace`. The commands in `record/environment.md` gain its build.
- **[JEN-21](https://linear.app/reveer/issue/JEN-21) shrinks.** Commands are offline from this change on, so JEN-21 is left with keeping the model key in the runtime and cutting off the agent's own container, which runs only jen's code.
- **Docs:** `docs/architecture.html` gains the workspace container.
- **Agents saved before this change** have no `workspace` in their grant, so they get no workspace. jen has no adopters, so nothing is migrated.
