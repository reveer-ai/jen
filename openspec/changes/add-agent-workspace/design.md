# Design

## Context

The runtime (`src/runtime/runtime.ts`) keeps no state of its own. Each agent is a labelled volume, `<name>-agent-<id>`, whose labels hold its parent and grant, and each run of it is a container of the same name on the runtime's network. Tree operations (spawn, stop, start, delete, and the handling of an exit) run one at a time through a queue. Startup removes containers left over by a crash. A watcher on the engine's `die` events reports to a parent a child whose restarts ran out. That child's container is left exited, and the agent counts as stopped. The agent calls the runtime with `RuntimeClient` (`src/agent/delegation.ts`), which uses Node's `http` with no timeout of its own. Every tool gets an `AbortSignal`, which fires on an urgent message (`src/agent/loop.ts`).

See proposal.md for why the workspace is a container of its own, and what it covers.

## Goals / Non-Goals

**Goals:**

- **The boundary comes from what the container is given.** Nothing a command can do inside the workspace container reaches the agent, the runtime, another agent or the network, because none of them is in that container's world. No rule in jen's code has to be right for the boundary to hold.
- **The runtime is the only way in.** The agent has no socket, address or credential for its workspace. Every command goes through the runtime, which checks the caller's token first, as it does for every other route.
- **Plain shell works.** A command runs as it would in a terminal, background processes included. The tool adds a timeout and an output cap, and no other concepts.

**Non-Goals:**

- Anyone but the agent itself running commands in its workspace. The owner and the agent's parent have no route into it here. Nothing rules one out later.
- A cap on the disk a workspace uses. Docker's local volume driver can't set one (see Risks).
- A working directory that persists between commands. Each command starts in the workspace's home directory.
- JEN-19's file tools. They will run in the same container.

## Decisions

### The workspace's resources

Each agent with the `workspace` grant has two more Docker objects, named and labelled apart from its agent's:

| | Agent | Workspace |
|---|---|---|
| Volume | `<name>-agent-<id>`, its record, holding its grant | `<name>-workspace-<id>`, its files |
| Container | `<name>-agent-<id>`, on the runtime's network | `<name>-workspace-<id>`, no network |
| Label | `jen.agent=<id>` | `jen.workspace=<id>` |

- **Why a separate label.** The tree is read from `jen.agent`, and the exit watcher filters on it. A workspace container that dies isn't an agent crash, and must never be reported to a parent as one. *Alternative:* `jen.agent` with a role label, which every reader would have to remember to tell apart.
- **Why the agent's volume stays the record.** Nothing moves: the grant is read from the agent's volume as today. The workspace volume holds only files, so losing its labels loses nothing.

### What the workspace container is given

The runtime creates it from `JEN_WORKSPACE_IMAGE` (default `jen-workspace`), with fixed settings that no caller can change:

- **Mounts:** the workspace volume at `/home/agent`, and a tmpfs at `/tmp` mounted `exec,nosuid,nodev`. Docker mounts a tmpfs `noexec` by default, which would break the many tools that build and run helpers in `/tmp`. Nothing else is mounted. There's no state volume and no engine socket.
- **Environment:** only what the image sets, such as `PATH` and `HOME`. None of jen's settings.
- **Network:** `none`. It has loopback only.
- **User:** `agent` (uid 1000), with home `/home/agent`.
- **Privileges:** all capabilities dropped, `no-new-privileges`, Docker's default seccomp profile, and a root filesystem that can't be written. The image's files can't be changed, so the workspace's home and `/tmp` are the only places a command can write.
- **Limits:** fixed constants:
  - 2 CPUs
  - 2 GiB of memory, which the tmpfs counts toward
  - 512 processes
  - a 512 MiB `/tmp`

  These are caps, not reservations, so a laptop with less memory than every agent's cap added together still works. The agent's own container keeps the runtime's network and gets no new limits here.
- **Its first process:** `sleep infinity` under Docker's init (`Init: true`). The init reaps the orphans that background processes leave, so they don't pile up as zombies. The restart policy is `unless-stopped`, so a workspace whose first process dies comes back on its own. Its files are kept, and its background processes are gone.

*Why the workspace is the home directory:* tools keep their config and caches under `HOME`, for example `~/.gitconfig`, `~/.npm` and `~/.cache`. Mounting the volume as the home directory keeps all of that across restarts, and `~` means the same to a model as it does in any terminal. `HOME` could be any directory. `/home/agent` follows the convention a model expects, and its name matches the user it belongs to. The base image's user, `node`, is renamed, because its name turns up in every path a command prints and reads as if the workspace were a Node project.

### The workspace follows what's done to its agent

Each tree operation changes the workspace in a fixed order. A running agent always has a running workspace, and an interrupted operation can be repeated:

- **Spawn:** create the agent's volume (the record), then the workspace volume. Start the workspace container, then the agent's. A failure removes everything, as any failed spawn does.
- **Start:** start the workspace container, then the agent's.
- **Stop:** remove the agent's container, then the workspace container. The volumes stay. This happens across the subtree, deepest first, as today.
- **Delete:** remove the agent's container and the workspace container, then the workspace volume, and the agent's volume last. A repeated delete still finds the agent by its record.
- **Restarts run out:** when the exit watcher sees an agent container that has exited for good, it removes that agent's workspace container, whether or not the agent has a parent to tell. That makes the workspace match an agent that counts as stopped.
- **Startup:** the runtime also removes every workspace container whose agent isn't running, and every workspace volume whose agent's volume is gone.

A crash of the agent's process leaves the workspace running. Docker restarts the agent's container in place, and nothing in the queue sees it.

*Alternative:* create the workspace on first use. That would put the cost of creating a container into a model's first command, and leave the workspace's existence depending on what the agent did.

### Running a command

A new route, `POST /workspace/commands`, with the body `{"command": "<shell>", "timeout": <seconds>}`, acts on the caller's own workspace. The caller is whoever the token belongs to, so no agent ID is involved. The route's refusals:
- an agent without the grant gets `403`, as a caller without `spawn` does when it spawns
- the owner, who has no workspace, gets `404`
- a timeout over 600 seconds, or below 1, gets `400`
- a body over 64 KB gets `413`

The body bound is the route's own, not the runtime's 16 KB `MAX_BODY`. Until JEN-19's file tools land, an agent writes files with heredocs, which outgrow 16 KB. The bound also stays under Linux's 128 KB limit on one argument, which `sh -c` would otherwise hit.

The route doesn't go through the tree queue, because a command can run for 10 minutes. If the workspace container stops while the command runs, the exec's stream ends without the wrapper's final report, and the route answers `409`, saying the workspace stopped during the command. That happens when the agent is stopped or deleted, or when the workspace's first process dies and is restarted. Once the command ends, it answers `200` with:

```json
{ "exitCode": 0, "output": "...", "timedOut": false, "cut": { "bytes": 123456, "file": "/home/agent/.jen/output/<id>.log" } }
```

`exitCode` is `null` when the command was killed. `cut` is present only when the output was cut.

The runtime runs each command through the engine's exec, as `agent` in `/home/agent`, with stdin closed. The command is wrapped in a short script, part of the runtime's own code, that:
1. reports the process group the command runs in, before the command starts
2. runs the command with `sh -c` in that group, writing its stdout and stderr together to a file, `~/.jen/output/<id>.log`
3. once the shell exits, reports the exit code and the file's size, then prints the file whole if it's within the cap, or else its first 2 KB and last 6 KB
4. deletes the file when nothing was cut

Why each piece:

- **The output goes to a file, not the exec's stream.** Something the command runs in the background inherits the file, not the stream. So the exec ends when the shell exits, whatever runs on, and that settles background processes. The whole output also lands where it can be kept when it's too long, with no second copy.
- **Its own process group.** The engine's API can't kill an exec. So when the timeout passes, or the caller hangs up, the runtime runs a second exec that kills the command's process group. That covers the shell and everything it started that is still in the group, background jobs included. A finished command's group isn't touched, so what it started in the background lives until the workspace container is removed. A process that leaves its group deliberately, with `setsid` or a daemon's fork, counts as background either way.
- **The caller hanging up kills the command.** Cancelling by an urgent message aborts the agent's request, and so does a crash of the agent's process. Either way the command dies with its call, so a crash leaves no command running unseen. The loop records the call as `CANCELLED` or `INTERRUPTED`, as it does today.
- **The runtime enforces the maximum.** The runtime holds the boundary, so the 10-minute maximum is its constant, not the tool's. The tool refuses an over-long timeout too, so the model hears about it before any request is made.
- **The cut is bytes, kept as the start and the end.** Errors come at the end, which is why the end gets 6 KB of the 8 KB. A character split by the cut is decoded as a replacement character.

*Alternatives:*
- Streaming output back over the exec. A background process holding the stream open then makes the call hang until its timeout, and the full output has to be buffered in the runtime to be saved.
- A daemon in the workspace that runs commands. That would put jen's code inside the boundary, and add a second service to keep alive and authenticate.

### The `run_command` tool

An agent whose grant has `workspace` is offered `run_command`, which takes `command` and an optional `timeout` in seconds. It calls the route with the agent's own token and the call's `AbortSignal`. Its result for the model gives the exit code, or says the command was killed by its timeout, then the output. When output was cut, the result ends with how many bytes were cut and the file holding all of it.

The tool's description says:
- that each command starts in the home directory, which persists, with no network and no way to install anything
- the 2-minute default and the 10-minute maximum
- that a command which keeps running, such as a server, goes in the background with its output redirected
- that output is capped at about 8 KB, so large output belongs in a file to search with `grep` or `tail`, and that output which is cut anyway is saved whole
- that a command is at most 64 KB, so a large file is written in parts

The tool refuses a command over 64 KB before any request is made, with an error saying to write the content in parts.

The description is behavior, so its wording is settled by the behavior check (see below), not by unit tests. The tool lives in `src/agent/workspace.ts`. `delegation.ts` keeps its delegation tools and gains only the grant.

### The grant

`Grant` becomes `{ spawn: boolean; workspace: boolean }`, and the owner's grant has both. A spawn request's grant is an object whose keys are known capabilities with boolean values, and a key that's missing is `false`. So `{"spawn": true}` still means what it does today. An unknown key is still refused. The subset rule applies to each key, as it does today. A volume label with no `workspace` reads as `false`, so agents saved before this change get no workspace.

### The image

The `Dockerfile` gains a `workspace` target on the same `node:26-slim` base as the agent. It adds the tools in the proposal with `apt-get`, and holds no file from `src/`. It renames the base image's `node` user and group to `agent` (uid 1000 is kept) with home `/home/agent`, which the volume copies on first mount. Its user is `agent`, its working directory `/home/agent`, and its command `sleep infinity`. The runtime sends the wrapper script with each exec, so the image carries none of jen's code and nothing in the workspace can change how commands are run.

### Checks

- **Unit tests** run against `fake-docker.ts`, which gains exec and the new container settings. They cover:
  - the order of operations
  - the startup repairs
  - the exit watcher's removal
  - the route's refusals and timeouts
  - the tool's formatting
- **The boundary check** (`src/runtime/workspace.live.test.ts`) needs Docker, not a model. It starts a runtime with placeholder model settings, spawns an agent with the grant, takes the agent's token from its container, and calls the route as the agent. It fails if a command can:
  - see any `JEN_*` variable
  - see the agent's process or `/state`
  - write outside its home or `/tmp`
  - reach the runtime, the agent or the internet
  - start more than 512 processes

  It also checks that:
  - files survive a stop and a start
  - a background process outlives its call but not a stop
  - a timeout kills its command
  - a cut is saved whole

  It runs in `npm run test:live`, and CI runs it on every push. GitHub's runners have Docker on a plain Linux kernel, so it's the one check that shows the boundary holding outside Docker Desktop.
- **The behavior check** keeps its six tasks with their current grants, and gains a seventh. The root has `workspace` and is asked to run a given command exactly once and report one line from its output. The command prints a log far over the cap, with the line in the middle, so the line is in neither the start nor the end the result keeps. The command counts its own runs by appending to a file in the workspace, so a run piped into `grep` or rewritten in any other form still counts. The check reads that file afterwards. The task fails if the reply lacks the line or the count is above one.

It shows whether a Luna-class model gets what it needs from big output without running the command again, which is what makes the cap safe for commands that can't be repeated. A model that filters the output on its first run passes without the saved file coming into it, and that's a fine way to pass.

## Risks / Trade-offs

- **[A workspace can fill the engine's disk]** Docker's local volume driver has no size limit, so a command that writes without end fills the disk every agent and the runtime share. → Accepted for now, since there's nothing a cap would protect yet beyond the owner's own machine. A hosted runtime ([JEN-4](https://linear.app/reveer/issue/JEN-4)) can put each account's engine on a disk of its own.
- **[One kernel for everything]** A kernel bug still lets a command out of its container. → This is the separate-kernel idea in `record/ideas.md`, not this change.
- **[A runtime restart mid-command]** The exec's stream breaks, and the agent's call fails with an error. The command keeps running in the workspace, because the runtime that would kill it is gone. → Rare, and the workspace's limits bound it. The model sees the error and can check with `ps`.
- **[Each command costs about two execs]** One runs the command, measured at 58 ms on Docker Desktop. A kill adds another. → Small next to a model call.
- **[Background processes can outgrow what a model tracks]** Nothing lists them for it. → The process limit bounds them, and `ps` shows them. Stopping the agent clears them.

## Migration Plan

Nothing to migrate. Build the new image with `docker build --target workspace -t jen-workspace .` beside the other two, and restart the runtime. Agents saved before this change keep running without a workspace. To roll back, run the previous runtime image: it ignores the workspace containers and volumes. Delete them by their `jen.workspace` label.
