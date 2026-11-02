# Proposal

## Why

Today nothing in jen starts an agent. The user runs `docker run` by hand, and an agent has no way to start another. The 2026-11-01 decisions in `context/decisions.md` settled that one runtime starts and stops every agent, the root included. That runtime owns the tree of agents, so no sub-agent outlives its place in it, and it applies each agent's grant, which can only narrow. This change builds that runtime ([JEN-10](https://linear.app/reveer/issue/JEN-10)). It's done when an agent can be started through the runtime, stopping an agent stops its sub-agents, and no agent can be granted more than its owner has. Teaching an agent to delegate is [JEN-11](https://linear.app/reveer/issue/JEN-11).

The runtime is the minimum that lets agents do their work. It's also where security will grow, so its boundaries are drawn carefully from the start. The same runtime has to work locally and in a deployed setup, including when agents run on a machine other than the user's.

## What Changes

- **The runtime is its own long-running process, separate from every agent.** Agents never share a host with each other, so none can start containers itself. The runtime isn't an agent. It runs as a container of its own, beside its engine, so it runs the same way on a laptop and on a cloud VM.
- **The runtime starts agents through the Docker Engine API, and only through that.** It talks to the engine on its own host through the engine's socket. Deploying jen somewhere, including a cloud VM away from the user, means running the runtime there. Stronger isolation, such as gVisor or Kata, plugs in as a Docker runtime. There is no abstraction over where agents run, because Docker is the one mechanism and it covers every deployment we have. A second mechanism would come with a platform that has no Docker engine, if hosting ([JEN-4](https://linear.app/reveer/issue/JEN-4)) ever picks one.
- **The runtime offers a narrow API: spawn, stop, start, delete and list.** Stopping an agent ends its container and keeps its state. Starting it again resumes from that state. Deleting it removes its state for good. That's what lets a sub-agent persist like an employee, building context across its parent's tasks, such as the design, build and test agents under a project agent. Whether a sub-agent is temporary or kept is the parent's choice, made by deleting it when its work is done or not. It isn't a flag or a type. Spawning starts the jen image, with mounts, network and environment that the runtime sets itself. A caller never passes Docker options through. The runtime controls a Docker engine, which is effectively root on that engine's host, and this narrow API is what keeps that power from leaking to agents. Agents never see the engine.
- **Every caller has its own credential, and the runtime checks every call against the tree.** The runtime serves one owner, the principal it acts for, identified by an owner credential. The owner is the top of the tree: agents it spawns are root agents, and every grant narrows from what the owner has. Each agent gets its own credential when it's spawned. A caller can spawn, stop or list only its own descendants. A credential identifies a principal and resolves to what that principal may do. Holding a token never means full control. This replaces the idea of one shared token for everything, which would let any agent act as any other and make narrowing meaningless.
- **Stopping an agent stops everything under it, deleting one deletes everything under it, and the tree holds across a runtime restart.** A sub-agent's life is tied to its place in the tree, not to its parent's process. If the runtime restarts, it must still know every agent it started, and it must never leave one running outside the tree.
- **A grant is a set of capabilities, and a child's grant can't exceed its parent's.** For now the only capability is spawning. Model access isn't a grant yet. Every agent gets the owner's model settings, because an agent can't run without a model, and a raw API key can't be narrowed. Model access becomes a grant when the runtime proxies model calls, so that which models and how much spend can be granted. That's a later addition.
- **Recursion is bounded by a maximum depth and a maximum number of agents, running or stopped**, both set on the runtime and enforced by it. Spend isn't a bound yet, for the same reason model access can't be narrowed.
- **Agents run on a network of their own, and every request to an agent goes through the runtime.** The runtime relays each agent's protocol and checks who may reach which agent against the tree. No agent's port is published, and the owner reaches its agents through the runtime's own port, which is bound to localhost by default. That's what lets the owner reach a root agent on a remote VM.
- **Each agent has one token, which works in both directions.** The runtime generates an agent's `JEN_TOKEN` each time it starts. The runtime presents it when relaying to the agent, so `agent-protocol` itself doesn't change, and the agent presents it to identify itself to the runtime, which it doesn't do until JEN-11. The agent also gets the runtime's address. JEN-11 gives the agent the means to call this API, so a parent can manage its sub-agents' lifecycle itself.

The runtime serves one owner. Each account gets its own runtime, so the runtime's code has no notion of accounts. How a person logs in, and how hosting starts a runtime per account, belong to JEN-4. Messages between parent and child, and what a busy agent does with one, are JEN-11.

## Capabilities

### New Capabilities

- `agent-runtime`: the runtime process: its API for spawning, stopping, starting, deleting and listing agents, owner and agent credentials, the tree and its stop-everything-under guarantee across restarts, grants and how they narrow, the recursion bounds, and the fixed way it starts the agent image on Docker.

### Modified Capabilities

- `agent-container`: an agent is started by the runtime rather than by hand. It receives its token, the owner's model settings and the runtime's address from the runtime.

## Impact

- A new runtime module under `src/runtime/` with its own entrypoint, run from the jen image. It talks to the Docker Engine API over `node:http`, with no new dependency.
- The agent's code is unchanged. The image's entrypoint becomes `node`, so that the same image can start either an agent or the runtime.
- A live check with Docker running: the owner starts an agent through the runtime, that agent's credential starts a sub-agent, stopping the root removes both containers, a grant wider than its parent's is refused, and a restarted runtime still knows the tree.
- `context/environment.md`: run instructions move from `docker run` to starting the runtime and spawning through it.
