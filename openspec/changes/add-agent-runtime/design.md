# Design

## Context

Today an agent is a container that someone starts by hand with `docker run`. It serves `agent-protocol` on port 8080 (`src/server.ts`), guarded by the one bearer token in `JEN_TOKEN`. It keeps its conversation in SQLite on a volume at `/state`. `src/main.ts` refuses to start without `JEN_MODEL`, `JEN_API_KEY` and `JEN_TOKEN`. Nothing starts or stops agents, and nothing knows how they relate. The image is the only supported way to run an agent. CI has no container runtime, so anything that needs Docker is checked live. See proposal.md for why this change exists and what it covers.

## Goals / Non-Goals

**Goals:**

- **One way of running for every deployment.** The runtime and its agents run the same way on a laptop and on a cloud VM. Deploying jen somewhere is running the runtime there.
- **Docker holds the truth.** The runtime keeps no state of its own. Everything it knows about the tree, it reads back from the engine. A runtime can be restarted, or replaced, at any moment.
- **Credentials never travel.** No credential ever leaves the runtime except into the container it belongs to.

**Non-Goals:**

- Trees that span hosts. A runtime and all its agents share one engine.
- Narrowing model access or capping spend. Both need a model proxy.
- TLS on the runtime's port, and human login. Both belong to hosting ([JEN-4](https://linear.app/reveer/issue/JEN-4)).
- Restarting agents automatically when the engine or host restarts. An agent runs because someone started it through the runtime.
- An agent calling the runtime. The agent gets its address and credential here, and [JEN-11](https://linear.app/reveer/issue/JEN-11) uses them.

## Decisions

### Layout

```
src/runtime/main.ts         configuration, reconcile, listen on 8080
src/runtime/server.ts       the runtime's HTTP API and the relay
src/runtime/runtime.ts      the tree: spawn, stop, start, delete, list, reconcile, grants, bounds
src/runtime/docker.ts       a minimal Docker Engine API client over the socket
src/runtime/*.test.ts       unit tests, against a fake engine
src/runtime.live.test.ts    the check, against real Docker
Dockerfile                  ENTRYPOINT ["node"], CMD ["src/main.ts"]
```

### The runtime runs as a container beside its engine

The runtime runs from the jen image, with a different command (`node src/runtime/main.ts`). The engine's socket is mounted into it, and its port is published on `127.0.0.1`:

```sh
docker run -d --name jen-runtime --user root \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -p 127.0.0.1:8080:8080 \
  -e JEN_OWNER_TOKEN -e JEN_MODEL -e JEN_API_KEY -e JEN_BASE_URL jen src/runtime/main.ts
```

- **Why a container, not a process on the host.** On macOS and Windows, Docker runs inside a VM, so a host process can't reach containers on a Docker network, and those containers reach the host only through special names. Inside a container, the runtime reaches its agents, and they reach it, by plain DNS names on the agents' network. That works identically on Linux, on Docker Desktop and on a cloud VM. *Alternative:* a host process. It would need port publishing for every agent, and a different way of reaching agents on each platform.
- **Why the socket, not `DOCKER_HOST`.** The runtime has to sit on its agents' network to relay to them (see below), so it's always on the same host as its engine. A remote engine address would never be used. Deploying to the cloud means running this same command on a cloud VM. *Alternative:* a remote engine through `DOCKER_HOST`, which only works for a runtime that doesn't relay.
- **Why `--user root`.** The socket is owned by root in most setups, including Docker Desktop. Access to the socket is already root on the host, so running the runtime as root inside its own container doesn't add any power. Agents still run as uid 1000.
- **One image, one `ENTRYPOINT ["node"]`.** The agent's default command stays `src/main.ts`, so `docker run jen` still starts an agent. *Alternative:* a separate runtime image or build target. That's a second build to keep in step, for no gain while both run the same code base.

### A minimal Docker client, no dependency

`docker.ts` speaks the Engine API over `/var/run/docker.sock` with `node:http`'s `socketPath`. It covers only what the runtime calls: create, list and remove volumes, create, start, stop, list, inspect and remove containers, and create, inspect and connect networks. The API version is pinned in the path. *Alternative:* `dockerode`, which brings remote hosts, TLS and SSH that the runtime doesn't need, plus a dependency tree. `runtime.ts` takes the client as a parameter, so unit tests pass an in-memory fake engine. That's a test fixture, like the scripted model, and not an abstraction over where agents run.

### The agent's volume is its record, and its container is one run

Each agent has a named volume, `<name>-agent-<id>`, mounted at `/state`, and at most one container with the same name. `<name>` is the runtime's name, `JEN_RUNTIME_NAME`, which defaults to `jen`. The volume's labels are the agent's permanent record:

| Volume label | Holds |
|---|---|
| `jen.runtime` | The runtime's name, so each runtime sees only its own agents |
| `jen.agent` | The agent's ID, 12 random hex characters |
| `jen.parent` | The parent agent's ID, or empty for a root agent |
| `jen.grant` | The grant, as JSON |

Docker labels can't change after creation. That fits, because an agent's parent and grant never change.

- **Stop removes the container and keeps the volume.** **Start creates a new container** from the volume's labels, with the runtime's current model settings and the current image. **Delete removes the container and the volume.** An agent is running exactly when its container exists and is running.
- **Starting fresh each time means nothing goes stale.** A new key, model or image reaches an agent the next time it starts. *Alternative:* `docker stop` and `docker start` on a kept container. That would freeze each agent's environment and image at spawn, and would store the tree in two places.
- **Why labels, not a database in the runtime.** Docker already has to know which containers and volumes exist. A second record could disagree with it after a crash, and reconciling the two would be the hard part. With labels, there's only one record. *Alternative:* SQLite on a runtime volume, which is two sources of truth.

### Credentials

There are two credentials:

| Credential | Held by | Authorizes | Lifetime |
|---|---|---|---|
| Owner token, `JEN_OWNER_TOKEN` | The owner, and the runtime's environment | Calls to the runtime, as the owner | As long as the owner keeps it |
| Agent token, `JEN_TOKEN` | The agent's container, and the runtime | Calls to the runtime, as that agent, and calls to that agent's protocol, which only the runtime makes | One run |

- **One token per agent serves both directions.** The agent presents it to the runtime to say who it is, and the runtime presents it to the agent when relaying. Only the runtime and the agent ever see it. *Alternative:* separate tokens for each direction. Both would sit in the same container's environment, so stealing one means stealing the other, and a second token would add nothing.
- **The token is 32 random bytes, generated each time the agent starts.** The container's labels hold its SHA-256, `jen.credential`. A caller is identified by hashing the bearer token it presents and finding the running container with that hash, or by comparing it with the owner token in constant time. A stopped agent has no valid token.
- **The runtime reads the token back from the container's configuration when it relays a request.** It never stores the token anywhere else.
- **A credential resolves to a principal: the owner or an agent ID.** Every check is about that principal's place in the tree. No token means anything by itself.

### The API and the relay

The runtime listens on port 8080. Every route needs a bearer token. Errors are JSON, as `{"error": "…"}`, the same as `agent-protocol`.

| Route | Does |
|---|---|
| `POST /agents` | Body `{"grant": {"spawn": bool}}`. Spawns a child of the caller and starts it. `201` with the agent. |
| `GET /agents` | Lists the caller's descendants. For the owner, that's every agent. |
| `GET /agents/:id` | One agent. |
| `POST /agents/:id/stop` | Stops it and everything under it. |
| `POST /agents/:id/start` | Starts it. Its sub-agents stay stopped. |
| `DELETE /agents/:id` | Deletes it and everything under it. `204`. |
| `POST /agents/:id/messages`, `GET /agents/:id/events` | Relayed to the agent's `/messages` and `/events`, with the agent's `JEN_TOKEN`. `Last-Event-ID` and the body pass through, and the response streams back unchanged. |

An agent is returned as `{"id", "parent", "grant", "state": "running" | "stopped"}`.

- **The caller can act only on its own descendants.** The owner counts as everyone's ancestor, and an agent isn't its own descendant. Any other ID gets `404`, the same as an ID that doesn't exist, so a caller can't probe for agents it can't reach. A refused grant or a bound that's been reached gets `403`. Starting an agent whose parent is stopped, or relaying to a stopped agent, gets `409`.
- **Every request to an agent goes through the runtime.** This means no agent's port is published, and no protocol token ever leaves the runtime. It's also the only design that lets the owner reach a root agent on a remote VM or on Docker Desktop. And it puts the check of who may reach which agent in the one place that already knows the tree. That's where JEN-11's rule, that a child may also reach its parent, will go. *Alternative:* hand each new agent's `JEN_TOKEN` to whoever spawned it, and publish each root agent's port on `127.0.0.1`. That doesn't work for a remote owner, and it spreads protocol tokens through the tree.

### Grants and bounds

- **A grant is a set of capabilities, and a child's must be a subset of its parent's.** For a root agent, the parent is the owner, which has every capability. The check is a subset check, so it holds as capabilities are added. To spawn at all, a caller needs `spawn` (the owner always has it).
- **The only capability is `spawn`.** Model access isn't a capability yet. As a yes-or-no switch, it would only produce agents that can't run, because an agent refuses to start without its model settings. It becomes a capability with the model proxy, when "which models" and "how much" can be granted. Until then, every agent gets the owner's model settings.
- **`JEN_MAX_DEPTH` (default 3) and `JEN_MAX_AGENTS` (default 10)** bound the tree. A root agent is at depth 1. The count covers every agent that hasn't been deleted, running or stopped, because each one is a volume and can be started again. *Alternative:* counting only running agents, which would let stopped agents pile up without limit.

### Ordering, concurrency and reconciling

- **The runtime runs one tree operation at a time,** through an in-process queue. Relayed requests don't wait in it, so a long turn never holds up a spawn or a stop.
- **Stop and delete work from the deepest agent upward.** If the runtime dies partway through, every running agent still has running ancestors, and every remaining agent still has its parent. Spawn creates the volume first. If creating or starting the container fails, it deletes the volume again.
- **On startup, the runtime reconciles before it serves.** It creates its network if it's missing and attaches itself to it, then repairs anything a crash left behind:
  - A container with no volume is removed.
  - An agent whose parent volume is gone is deleted, along with its subtree.
  - A running agent with a stopped ancestor is stopped.

  This is what guarantees that no agent is ever detached, across restarts.

### The agents' network

The runtime creates a bridge network named `<name>`, attaches its own container to it under the alias `runtime`, and attaches every agent to it. Agents get `JEN_RUNTIME_URL=http://runtime:8080`. The alias belongs to each network, so two runtimes on one engine, such as a test runtime next to a real one, never see each other's agents. Agents can reach one another's port 8080, but they hold no one's protocol token, so they can't use it.

### What an agent's container is given

When an agent starts, the runtime creates its container with fixed settings: the image `JEN_IMAGE` (default `jen`) with its default command, the agent's volume at `/state`, the network, the labels above, and this environment:

- `JEN_MODEL`, `JEN_API_KEY` and `JEN_BASE_URL`, copied from the runtime's own environment
- `JEN_TOKEN`
- `JEN_RUNTIME_URL`

Nothing a caller sends ends up in the container's configuration. The agent's code doesn't change in this change.

## Risks / Trade-offs

- [The runtime has root on its host through the socket] → This is inherent to starting containers. The API keeps it contained: nothing a caller sends reaches Docker except an ID the runtime has already checked, and the grant, which is validated and stored as a label.
- [Agents on a bridge network can reach the host's LAN and the internet] → They need the internet for the model API. Restricting egress means a model proxy and an internal network, which is later security work.
- [Agents share a network, so a sibling can reach another's port] → Protocol tokens never leave the runtime, so reaching a port gets a sibling nothing. A network per agent stays an option if that changes.
- [Labels can't change, so a grant can't be widened or narrowed after spawn] → Nothing needs that. A different grant means a new agent.
- [If the runtime is down, no one can reach any agent] → Agents keep running and keep their state. Restarting the runtime is safe at any time, because it reconciles from Docker.
- [The socket path differs by setup] → The run command mounts the host's `/var/run/docker.sock`, which Docker Desktop provides by default. The live check uses the same path.
- [Changing from `ENTRYPOINT ["node", "src/main.ts"]` to `["node"]`] → A command line that passed arguments to the agent would break. The agent takes none, and there are no adopters.

## Migration Plan

No data migrates. An agent volume from JEN-9 has no labels, so the runtime ignores it. `context/environment.md` changes to: build the image, start the runtime, spawn and talk through it.
