# Tasks

## 1. The model route

- [ ] 1.1 Add `src/runtime/model.ts`: `checkModelRequest(body)`, which returns the checked request with the runtime's model in place, or the error naming the first field that doesn't fit, exactly as the shape table in the design and the `agent-runtime` spec say. Its comment says why it's an allowlist: anything else could name a URL the provider fetches, or a hosted tool.
- [ ] 1.2 In `src/runtime/server.ts`, serve `POST /model/responses` as the design's "The model route" says: an agent's token only (`403` for the owner), the token checked again after the body, `413` over 32 MiB, `400` from the check, the checked body sent again with the key and the three headers, the response streamed back without hop-by-hop headers, `content-encoding` or `content-length`, the provider's call aborted when the agent hangs up, and `502` when the provider can't be reached. Every other path under `/model` falls through to `404`. `RuntimeServerOptions` takes the model settings and an optional `fetch`. Update the file's header comment.
- [ ] 1.3 In `src/runtime/main.ts`, pass the model settings to the server instead of the `Runtime`.
- [ ] 1.4 Unit tests in `src/runtime/server.test.ts` for each point of 1.2 and each row of the shape table, with `fetch` stubbed. One of them has the stub provider gzip its response, served through a real HTTP server so that `fetch` decodes it. One test runs the request `OpenAIResponsesModel` actually builds (captured through the adapter's own `fetch` option) for a conversation with messages, tool calls and results, and expects it accepted unchanged but for the model.

## 2. What agents are given

- [ ] 2.1 In `src/runtime/runtime.ts`, give agents `JEN_MODEL` and no `JEN_API_KEY` or `JEN_BASE_URL`. The `Runtime`'s `model` option becomes the model ID alone. Test in `runtime.test.ts` that no agent's environment holds the key's value or the endpoint's.
- [ ] 2.2 In `src/agent/main.ts`, build the adapter with `JEN_TOKEN` as the API key and `<JEN_RUNTIME_URL>/model` as the base URL, and require only `JEN_MODEL` and `JEN_TOKEN`.

## 3. The agents' network

- [ ] 3.1 In `src/runtime/docker.ts`, `createNetwork` creates the internal network the design names: `Internal: true`, `EnableIPv6: false` and `com.docker.network.bridge.gateway_mode_ipv4=isolated`. Its comment says why the isolated gateway is needed, citing the 2026-11-16 measurement. `fake-docker.ts` records the settings, and `docker.test.ts` and `runtime.test.ts` check them.
- [ ] 3.2 Migrate this laptop by hand, as the design's Migration Plan says, before the live checks.

## 4. Live checks

- [ ] 4.1 In `src/runtime/workspace.live.test.ts`, the boundary check starts a stand-in provider in a container on Docker's default bridge and passes its address to the runtime as `JEN_BASE_URL`, then probes the agent's container with `docker exec` as the design's "Checks" says: no key or endpoint in any process's environment, the runtime reached, no public address, no public DNS, no address of the engine's host (reported by a listener in a `--network host` container), a valid call reaching the stand-in with the runtime's model and the placeholder key, and an `input_image` call refused with `400` and never reaching the stand-in. Everything it starts is removed in `afterAll`. Update the file's header comment.
- [ ] 4.2 In `src/agent/container.live.test.ts`, serve a stand-in proxy on the host that adds `JEN_LIVE_API_KEY` and forwards `/model/responses` to the provider, start the agent with `JEN_RUNTIME_URL=http://host.docker.internal:<port>` and `--add-host host.docker.internal:host-gateway`, and pass no key to the container.
- [ ] 4.3 Check the runtime, UI and behavior checks still start their runtime as before, and that nothing else in them passes a key to an agent.

## 5. Record and docs

- [ ] 5.1 Add dated entries to `record/decisions.md`:
  - The runtime proxies model calls and accepts only the adapter's request shape, setting the model itself. *Why:* forwarding as is would leave the provider able to fetch any URL a request names, and an allowlist fails closed. Set by the maintainer with the proposal on 2026-11-16.
  - Agents' network is internal with an isolated gateway. *Why:* the 2026-11-16 measurement: a plain internal network leaves the host reachable at the gateway.
  - No migration code for the old network. *Why:* set by the maintainer on 2026-11-16: jen has run only on their laptop.
  - WebRTC out of the UI's frame stays open, as a known gap. *Why:* the 2026-11-16 measurement, and no complete mechanism exists. Mark 2026-11-10's "agents lose internet access" entry as completed by this change.
- [ ] 5.2 In `record/plan.md`, update the open question on model access: the key is in the runtime and agents are offline since JEN-21. Still open: model access as a grant and spend as a recursion bound, which would extend the proxy's check.
- [ ] 5.3 In `record/environment.md`: the runtime passes only `JEN_MODEL` to agents and proxies their model calls at `POST /model/responses`; the agents' network is internal with an isolated gateway and needs Docker Engine 28.0 or later; the boundary check also probes the agent's container with a stand-in provider; the container check's stand-in proxy; and how to remove an old `jen` network by hand.
- [ ] 5.4 In `src/agent/sandbox.live.test.ts`, point the comment about skipping WebRTC at the `agent-ui` spec rather than the add-agent-ui design.
- [ ] 5.5 Update `docs/architecture.html`: model calls go from the adapter through the runtime's model route to the provider, the agents' network is internal, and the runtime alone holds the key.

## 6. Verification

- [ ] 6.1 `npm run check` and `npm test` pass.
- [ ] 6.2 The boundary check passes on Docker Desktop, and in CI on a plain Linux kernel.
- [ ] 6.3 The container, runtime and UI checks pass, and the behavior check passes on `openai/gpt-6-luna`, all with model calls going through the proxy.
