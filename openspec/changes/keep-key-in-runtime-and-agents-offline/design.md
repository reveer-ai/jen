# Design

## Context

The runtime (`src/runtime/runtime.ts`) gives every agent `JEN_MODEL`, `JEN_API_KEY` and the optional `JEN_BASE_URL` in its environment, and starts it on the runtime's network, `<name>`. That's a plain bridge network the runtime creates at startup and joins under the alias `runtime`. The agent (`src/agent/main.ts`) builds `OpenAIResponsesModel` from those three variables and calls the provider itself. It already calls the runtime at `JEN_RUNTIME_URL` with its own token, `JEN_TOKEN`, for every other route. The runtime itself is started on whatever network `docker run` gives it, normally Docker's default bridge, which is also where its published port lives.

See proposal.md for why the key moves and agents go offline.

## Goals / Non-Goals

**Goals:**

- **The agent's world holds no key and no way out.** The boundary rests on what the container is given, the way the workspace's does since [JEN-20](https://linear.app/reveer/issue/JEN-20): no key in its environment, and a network with nothing on it but the runtime and other agents.
- **The proxy is the one place model access is decided.** Model grants and spend bounds will extend its check later. Nothing about which models or how much spend is decided here.

**Non-Goals:**

- Agents reaching each other directly. They share the agents' network today and still will; each agent's protocol takes only its own token.
- Streaming model responses. The adapter doesn't stream, and the shape check refuses `stream`.
- Any check of the network a user starts the runtime on. The runtime needs the internet to reach the provider. If it has none, model calls fail with `502`.

## Decisions

### The model route

The runtime serves `POST /model/responses`. The agent builds its adapter with its own token as the API key and `<JEN_RUNTIME_URL>/model` as the base URL, so the SDK sends `POST /model/responses` with `Authorization: Bearer <token>`. The adapter doesn't change. The route is the only one under `/model`; anything else there gets `404`, like any unknown route.

- **Callers:** only an agent's current token. The owner gets `403`: the owner holds the key already, and nothing would use the route. The token is checked again once the body has arrived, as on every other route.
- **Body:** at most 32 MiB, or `413`. The runtime has to parse the whole body to check it, so it buffers it, and the bound keeps an agent from making the shared runtime hold an arbitrary upload. A conversation the model can take is well under it: about a million tokens is a few MiB of JSON.
- **Forwarding:** to `<JEN_BASE_URL>/responses`, or `https://api.openai.com/v1/responses` when `JEN_BASE_URL` is unset, with `Authorization: Bearer <JEN_API_KEY>`, `Content-Type: application/json` and `Accept: application/json`, and none of the agent's other headers. The body sent is the checked body serialized again, not the bytes the agent sent. A duplicate key or any other quirk the runtime's parser and the provider's would read differently can't carry anything past the check.
- **The response:** the provider's status, headers (less hop-by-hop ones, as the relay already strips) and body, streamed back unchanged. The SDK's own retries on `429` and `5xx` keep working, because `retry-after` passes through.
- **Ending:** when the agent hangs up, as it does when an urgent message aborts a model call or the agent stops, the runtime aborts the call to the provider, as a relay does today. There's no timeout of the runtime's own. A provider the runtime can't reach gets `502` with `{"error"}`.

*Rejected: a general proxy that forwards any path to the provider.* It's the key's full power for every agent (see proposal.md).

### The request shape

The runtime accepts exactly what `src/agent/model/openai-responses.ts` sends, and refuses anything else with `400` and `{"error"}` naming the first field that doesn't fit. No unknown key passes at any level.

| Field | Accepted |
|---|---|
| `model` | a string, which the runtime replaces with its own `JEN_MODEL` |
| `instructions` | a string |
| `input` | an array of: `{role: "user" \| "assistant", content: <string>}`; `{type: "function_call", call_id, name, arguments}` with string values; `{type: "function_call_output", call_id, output}` with string values |
| `tools` | an array of `{type: "function", name: <string>, description: <string>, parameters: <object>, strict: <boolean>}` |
| `store` | `false` |

Every field is required except that `input` and `tools` may be empty. What this keeps out is anything the provider would act on beyond generating text: content parts (`input_image`, `input_file`), which can name a URL the provider fetches; hosted tools (`web_search`, `file_search`, `mcp`, `code_interpreter`), which reach the internet or the owner's account; `previous_response_id`, `background`, `prompt`, `include` and stored responses.

**The runtime sets the model** rather than requiring the agent's to match it. An agent then can't choose a pricier model, or an OpenRouter variant like `<model>:online` that adds web search. Agents that keep running across a runtime restart with a new `JEN_MODEL` follow it rather than failing. Agents still get `JEN_MODEL`, since the adapter needs a model to send. It's not a secret.

`parameters` is any JSON object: it's the JSON Schema of a jen tool's input, and providers don't fetch anything a schema names.

*Rejected: refusing only what's known to reach out (image and file URLs, hosted tools).* It fails open on every field a provider adds later. The allowlist fails closed, at the cost of updating the runtime whenever the adapter starts sending something new, which is where a grant would decide it anyway.

### What agents are given

Agents get `JEN_MODEL`, `JEN_TOKEN`, `JEN_RUNTIME_URL`, their identity and grant, and nothing else of the model's. `JEN_API_KEY` and `JEN_BASE_URL` reach no agent. The agent no longer reads either, and exits naming `JEN_MODEL` or `JEN_TOKEN` when one is missing. The runtime still requires `JEN_MODEL` and `JEN_API_KEY` at startup, and the model settings move from the `Runtime`'s options to the server's, since only the route uses the key and the endpoint.

### The agents' network

The runtime creates its network with `Internal: true`, `EnableIPv6: false` and the bridge option `com.docker.network.bridge.gateway_mode_ipv4=isolated`. It joins it as `runtime`, as today, and reaches the provider through the network it was started on.

Measured on 2026-11-16 on Docker Desktop (Engine 29.4.1), from a container on each kind of network:

| Probe | Internal | Internal, isolated gateway |
|---|---|---|
| A container on the network, by its alias | reached | reached |
| TCP to `1.1.1.1:443`, UDP to `8.8.8.8:53` | unreachable | unreachable |
| DNS for `example.com` or `host.docker.internal` | no answer | no answer |
| A listener on the engine's host network, at the network's gateway address | **reached** | unreachable (no gateway exists) |

A plain internal network leaves the bridge's gateway address on the host, so an agent could reach any service on the engine's host that listens on all interfaces. On a Linux server that's the machine itself; under Docker Desktop, its VM. The isolated gateway mode, in Docker Engine 28.0 and later, gives the bridge no address, so the host has none an agent can reach. A runtime on both networks still reached the internet: its default route is through the network with a gateway.

The network's settings are fixed constants, not settings. Docker doesn't let them change on an existing network. A runtime that finds a network by its name uses it as it is, and doesn't check it (see Migration Plan).

### WebRTC stays open

Measured on 2026-11-16 with jen's page and frame policies and `<iframe sandbox="allow-scripts">`, against a UDP listener named as a STUN server, in Playwright's Chromium 158 and WebKit 27.2:

- An `RTCPeerConnection` in the frame sends STUN in both: 4 packets in Chromium, 2 in WebKit.
- `webrtc 'block'` in either policy changes nothing. Both log it as an unrecognized directive.
- With `RTCPeerConnection` deleted from the frame's window, a nested `srcdoc` frame, created from script, has its own and sends STUN in both. So does a frame nested inside that one. CSP's `frame-src` doesn't govern `srcdoc`.
- The frame can't reach into a nested frame's window, since every sandboxed frame has its own opaque origin. A `data:` frame is blocked by `frame-src`.

So closing it from the bridge would mean intercepting every way a document makes a frame (`createElement`, `innerHTML`, `DOMParser`, `document.write`, templates, shadow roots), and that list has no end. Nothing else jen controls reaches WebRTC: no sandbox flag or Permissions-Policy feature covers it. The gap is recorded in the `agent-ui` spec, beside the frame's network requirement, and in `record/decisions.md`. Firefox and Safari themselves weren't measured.

What can leave this way is what the agent put in its UI and what the viewer types into it, from the viewer's browser, over UDP. A breach shows only in the viewer's own network traffic, so it's recorded as a known gap and not as a convention.

*Rejected: adding `webrtc 'block'` to both policies now*, so a browser that starts enforcing it closes the gap. Every frame would log an error in both engines today, and the gap stays exactly as open.

### Checks

- **Unit tests** in `src/runtime/server.test.ts`, with the server's `fetch` replaced: the caller rules, the body bound, every row of the shape table and each kind of refusal, the model replaced, the key and headers sent, the body sent being the checked one, the response streamed back with its status, an agent hanging up aborting the provider's call, and an unreachable provider. In `runtime.test.ts`: no agent's environment holds the key or the endpoint, and the network is created with the three settings.
- **The boundary check** (`src/runtime/workspace.live.test.ts`) also probes the agent's own container, and CI runs it on every push, so the boundary is checked on a plain Linux kernel as well as Docker Desktop. It starts a stand-in provider, a small Node server in a container on Docker's default bridge, and passes its address to the runtime as `JEN_BASE_URL`, so the check still needs no credentials. With `docker exec` into the agent's container it:
  - finds neither the placeholder key nor `JEN_BASE_URL` in the agent's environment, nor in any process's
  - reaches the runtime (the control that keeps the rest from passing vacuously)
  - can't connect to a public address, gets no DNS answer for a public name, and can't connect to a listener on the engine's host network at any of the addresses that host has. The listener runs in a `--network host` container, which reports the host's addresses, so the probe covers whatever bridge address an engine leaves, the gateway a plain internal network would have included
  - posts a valid request to the model route with its own token, and the stand-in receives it with the runtime's model and the placeholder key
  - posts one with an `input_image` part, and gets `400` while the stand-in receives nothing
- **The container check** runs the agent image without a runtime, so it serves a stand-in proxy on the host that adds `JEN_LIVE_API_KEY` and forwards to the provider. The agent reaches it at `host.docker.internal`, which `--add-host host.docker.internal:host-gateway` provides on Linux too.
- **The runtime, behavior and UI checks** call the real model through the proxy unchanged, which is the live proof that forwarding works. The behavior check runs once on `openai/gpt-6-luna` and the UI check once on `openai/gpt-6-sol`. No instruction or tool description changes, so the runs check the path, not wording.

## Risks / Trade-offs

- **Every model call now depends on the runtime.** A runtime restart breaks the calls in flight, and agents can't reach the model while it's down. → The agent's loop already retries a failed call after 1, 5 and 25 seconds, so a quick restart costs one retry.
- **The runtime buffers each call's body**, up to 32 MiB, and the tree allows 10 agents. → That's a fixed bound of a few hundred MiB in the worst case. Real conversations are far smaller.
- **The adapter and the runtime's check must change together.** A field the adapter starts sending is refused until the runtime accepts it. → The unit tests run the adapter's own output through the check, so a mismatch fails `npm test`.
- **An engine older than 28.0 may not honour the isolated gateway mode.** → The boundary check probes the host at the gateway address and fails if it's reached, on Docker Desktop and in CI.
- **Agents' tokens are now the key's stand-in.** A token that leaks from an agent's container lets its holder spend on the owner's key while that agent runs. → A token reaches only the runtime, which is only on the agents' network and the owner's local port, and it changes on every start.

## Migration Plan

No code migrates anything. jen has only run on the maintainer's laptop, so before the live checks there, by hand:

1. Stop the runtime, if one is running, and stop every agent on the `jen` network, which removes its containers and keeps its volumes. Two agents (`jen-agent-0eb4e10a2732`, `jen-agent-e4d77d89c16e`) and their workspaces were running there on 2026-11-16, restarted by Docker with no runtime.
2. `docker network rm jen`.
3. Rebuild the three images, and start the runtime as before. It creates the network anew, and each agent starts on it at its next message or start.

The live checks create a runtime of their own each run, so they get the new network with no step.
