# Proposal

## Why

Every agent's container holds the owner's model key, `JEN_API_KEY`, and reaches the internet freely. [JEN-20](https://linear.app/reveer/issue/JEN-20) moved commands into an offline workspace container that has none of the agent's environment, so the agent's own container now runs only jen's code. But a key that reaches every container can't be narrowed later, and an agent whose process misbehaves can send anything anywhere. [JEN-21](https://linear.app/reveer/issue/JEN-21) closes both: the runtime holds the key, and an agent reaches only the runtime.

## What Changes

- **The runtime proxies every model call.** An agent calls the model at the runtime with its own token, the way it calls the rest of the runtime's API. The runtime checks the token, adds the owner's key and sends the call on to the configured endpoint. No agent gets `JEN_API_KEY` or `JEN_BASE_URL`. **BREAKING** for anything that starts the agent image itself: the agent no longer reads a key.
- **The proxy forwards only what jen's adapter sends.** That's one route, the Responses call, carrying the shape the adapter builds: text messages, function tools, function calls and their outputs, and the runtime's own model. The runtime refuses anything else. Forwarding the provider's whole API would hand any agent everything the key can do (files, batches, any model). Forwarding the Responses call as it comes would leave the internet one hop away, because a request can name URLs the provider fetches for it, such as an image, a file or a remote MCP server. Checking the shape is also where model access as a grant will plug in later. Which models an agent may use and how much it may spend stay out of this change.
- **Agents' network has no internet.** The runtime creates its agents' network as an internal Docker network. The runtime joins it and reaches the internet through the network it was started on, which also keeps its published port working. An agent can reach the runtime and other agents, as today, and nothing beyond them: not the internet, not the engine's host and not outside DNS.
- **No migration code.** Docker can't make an existing network internal, so a runtime started on today's `jen` network would leave agents online. jen hasn't run anywhere but the maintainer's laptop, so the old network is removed by hand there, once. The runtime doesn't check for it.
- **WebRTC out of the UI's frame stays open, recorded as a known gap.** Once agents are offline, an `RTCPeerConnection` in an agent's sandboxed UI frame is the one way out: Chromium 156 sends STUN to any host the frame names and ignores CSP's `webrtc 'block'` (measured in [JEN-18](https://linear.app/reveer/issue/JEN-18) on 2026-11-13). Nothing jen controls closes it completely. Deleting `RTCPeerConnection` in the bridge misses a nested `about:blank` frame, which gets a fresh one. What can leave this way is only what the agent put in its UI and what the viewer types into it, and only from the viewer's browser. The design measures which browsers it affects, and the record says so.
- **The checks prove the boundary.** A live check fails if an agent's container holds the key, or reaches any host but the runtime, DNS included. Another fails if the proxy forwards a request outside the adapter's shape. The container check starts the agent image without a runtime, so it gets a stand-in for the proxy.

*Alternative: forward any request to the provider.* It's less code, and the adapter could change without the runtime changing. But it hands every agent the key's full power, and leaves the provider able to fetch any URL on an agent's behalf.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `agent-runtime`: the runtime serves the model route, which takes only an agent's token and the adapter's request shape, gives agents no model key, and puts them on an internal network.
- `agent-container`: the agent reads no key. It calls the model at the runtime with its own token.
- `agent-ui`: the sandboxed frame's network requirement names WebRTC as the known exception.

## Impact

- **Runtime code:** `src/runtime/server.ts` (the model route), `src/runtime/runtime.ts` (agents' environment and the internal network), `src/runtime/docker.ts` and `fake-docker.ts` (creating an internal network).
- **Agent code:** `src/agent/main.ts` builds the adapter with its token and the runtime's address. The adapter doesn't change. No tool description or instruction changes, so the behavior check doesn't need to run again for wording, though the live checks run to prove model calls still work through the proxy.
- **Checks and CI:** the boundary check, or a check beside it, covers the agent's container. `src/agent/container.live.test.ts` gets a stand-in proxy.
- **Record:** `record/environment.md`'s run instructions, `record/plan.md`'s open question on model access, and the decisions in `record/decisions.md`.
- **Docs:** `docs/architecture.html`, which shows how a model call flows.
- **This laptop:** remove the old `jen` network once, after deleting or stopping the agents on it.
