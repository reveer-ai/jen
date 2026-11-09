# Proposal

## Why

The agent from [JEN-8](https://linear.app/reveer/issue/JEN-8) runs once per message, with the message passed as an argument. Nothing can reach it over the network. The 2026-10-26 decisions in `record/decisions.md` settled that one protocol, over the network, covers user→agent, agent→agent and parent→child. This change defines that protocol and makes the agent speak it ([JEN-9](https://linear.app/reveer/issue/JEN-9)). It's done when a user can start an agent in its container and talk to it.

Whoever talks to an agent uses the same protocol: a person with curl, someone self-hosting jen on their own servers, and later a parent agent ([JEN-2](https://linear.app/reveer/issue/JEN-2)), the UI ([JEN-3](https://linear.app/reveer/issue/JEN-3)) and the npm package ([JEN-4](https://linear.app/reveer/issue/JEN-4)). No client gets a privileged path. The image is the unit you deploy, and the protocol is its interface.

## What Changes

- **jen's own protocol, over HTTP with Server-Sent Events (SSE).** A client sends a message with a plain HTTP request and watches the conversation on an SSE stream. Sending and watching are separate, so a client can send at any time while its stream is open. HTTP and SSE pass through the reverse proxies, TLS and load balancers that self-hosters already run.
  - *Not WebSocket:* nothing needs the client to push on the stream itself, and WebSocket would mean writing our own framing and reconnection.
  - *Not A2A:* it's built for interop between opaque agents from different vendors, and its task model would shape jen's protocol around someone else's concepts. If interop matters later, A2A can be a facade at the edge.
- **The stream carries whole conversation items, not tokens.** That matches the model port, which doesn't stream yet. A client that reconnects resumes where it left off, and several clients can watch one agent at once. Token deltas become one more event type when JEN-3 adds streaming.
- **A bearer token guards every request.** The agent reads it from `JEN_TOKEN` and won't start without it. An exposed agent spends its owner's model credits, and later runs its tools. One shared token is a minimum, not an auth design. Auth needs deeper thought later, with hosting and with agents calling agents.
- **BREAKING: the one-message-per-run entrypoint is replaced** by a long-running server. You start an agent with `docker run`, publishing its port, and talk to it with curl. The store and the turn logic in `respond` carry over unchanged.
- **One turn at a time.** A message that arrives during a turn is rejected. This is deliberately temporary. What a busy agent does with a message belongs to JEN-2, along with how delegation works.

No `jen` CLI, npm packaging or UI. Starting an agent is `docker run`, and a wrapper belongs with distribution in JEN-4. Starting an agent from another agent belongs to JEN-2.

## Capabilities

### New Capabilities

- `agent-protocol`: how clients talk to an agent over HTTP: sending a message, the event stream and its resumption, the token, and the one-turn-at-a-time rule.

### Modified Capabilities

- `agent-container`: the agent runs as a long-running server on a published port instead of handling one message per run. It requires `JEN_TOKEN`, and a failed turn is reported to the client instead of ending the process.
- `agent-store`: each saved item gets a stable position in the conversation, so the event stream can resume from it.

## Impact

- `src/main.ts` becomes a server, and a new HTTP module joins it under `src/`. It's built on Node's `node:http`, with no new runtime dependency.
- The `Dockerfile` exposes the agent's port.
- The container live check (`src/container.live.test.ts`) changes from two runs to one server that's sent two messages, and then restarted on the same volume.
- `record/environment.md`: the run instructions change from passing the message as an argument to `docker run` plus curl.
