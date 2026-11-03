# Tasks

## 1. Docker client

- [x] 1.1 Write `src/runtime/docker.ts` per the design: a minimal Docker Engine API client on `node:http` over `/var/run/docker.sock`, with the API version pinned in the path. It covers volumes (create, list by label, remove), containers (create, start, list by label, inspect, rename, remove with force) and networks (create, inspect, connect with an alias). "Not found" counts as success on removal, and Docker errors become typed errors that carry the status. Unit-test request building and error mapping against a stub server on a Unix socket in a temp directory. Verify with `npm test` and `npm run check`.

## 2. The tree

- [x] 2.1 Write `src/runtime/runtime.ts` per the design: spawn, stop, start, delete, list and get. Agents are volumes with labels, and runs are containers created with fixed settings, the `on-failure` restart policy (3 retries) and a fresh token whose hash is a container label. Include the descendant check, the grant subset check, the depth and count bounds, deepest-first cascades, the in-process operation queue, idempotent start, and the self-undoing spawn whose error carries the agent's ID. It takes the Docker client as a parameter. Add an in-memory fake engine as a test fixture, and unit-test each `agent-runtime` scenario it can reach: spawn by the owner and by an agent, a grant without `spawn`, both bounds with stopped agents counting, sibling and self, list scope, stop and delete cascades, start leaving descendants alone and removing a leftover container, a start that fails after create, a spawn with a lost start response, and token renewal. Verify with `npm test` and `npm run check`.
- [x] 2.2 Add startup to `runtime.ts`: claim `<name>-runtime` by renaming its own container (found through its hostname), exit if a running container holds the name, and replace a dead one. Ensure the network exists and attach to it with the alias `runtime`. Then reconcile: remove containers that aren't alive (`running` or `restarting`) or that have no volume, and delete agents whose parent is gone, with their subtrees. Unit-test against the fake engine: a live holder, a dead holder, a restarting container left alone, an exited container removed, and a detached agent deleted. Verify with `npm test` and `npm run check`.

## 3. API, relay and entrypoint

- [x] 3.1 Write `src/runtime/server.ts` on `node:http`: bearer auth resolving to the owner (constant-time) or a running agent (by token hash), the routes in the design, `400`/`403`/`404`/`409` as specified, and the relay of `/messages` and `/events` to `http://<container>:8080` with the agent's token, streaming the response and passing `Last-Event-ID` through. Test in-process on port 0 against the fake engine, with the relay pointed at an in-process `agent-protocol` server running the scripted model. Cover auth (no token, a stopped agent's token), each route's status codes, the relay of a message and an event stream with `Last-Event-ID`, a relay to a stopped agent, and an unknown route. Verify with `npm test` and `npm run check`.
- [x] 3.2 Write `src/runtime/main.ts`: require `JEN_OWNER_TOKEN`, `JEN_MODEL` and `JEN_API_KEY`, read `JEN_BASE_URL`, `JEN_RUNTIME_NAME`, the agent image's name, `JEN_MAX_DEPTH` and `JEN_MAX_AGENTS`, run startup, and listen on `0.0.0.0:8080` with the SIGINT/SIGTERM handlers. Run by hand, and record in the PR: a missing `JEN_OWNER_TOKEN` and a second runtime with the same name exiting.

## 4. Live check and docs

- [x] 4.1 Write `src/runtime.live.test.ts` against real Docker, under a unique runtime name. Build the images and start the runtime as documented. Then:
  - the owner spawns a root agent with `spawn`, and gets `401` without a token
  - the root's token, read from its container, spawns a child without `spawn`, and the child is refused a spawn with `403`
  - a message relayed to the root is answered, and `/events` streams it
  - killing the root's process brings it back with the child still running
  - the root is stopped, with both containers gone and both volumes kept
  - the root is started and recalls the message, with the child still stopped
  - the runtime container is replaced, and the new runtime lists the same tree
  - a second runtime with the same name exits
  - the root is deleted, with both volumes gone

  Always remove everything the check created. It skips without live credentials and fails without Docker. Verify that it skips with no credentials and passes against a real model.
- [x] 4.2 Rewrite the run instructions in `context/environment.md`: build the images, start the runtime with the documented `docker run`, spawn a root agent and talk to it through the runtime with curl, and stop or delete it. Add `src/runtime/` to the code layout. Verify the documented commands run as written.

## 5. Record

- [x] 5.1 Add JEN-10's project-level decisions to `context/decisions.md`:
  - the runtime runs as a container beside its engine, using the socket
  - Docker labels are the only record of the tree
  - every request to an agent is relayed
  - an owner token plus one token per agent
  - `spawn` is the only capability until a model proxy exists
  - a deliberate stop cascades and a crash doesn't, with crashed agents restarted by the engine
  - one runtime per name

  Update the JEN-10 status in `context/plan.md`, and fold the auth open question's runtime part into what was built. Verify each file stays within its size budget in `context/README.md`.

## 6. Implementation review fixes

- [x] 6.1 Check the caller's token again inside every runtime operation, against the tree it acts on: the caller carries its ID and its token's hash, and a token no longer current gets `401`. Unit-test a stale caller across stop and across stop and start for every operation, and a spawn whose body finishes uploading after its caller stopped, or stopped and started. Verify with `npm test` and `npm run check`.
- [x] 6.2 End the caller's relayed response when the agent's response breaks off. Unit-test an event stream whose agent drops mid-stream, and extend the live check to keep a stream open across the root's crash. Verify with `npm test` and `npm run test:live`.

## 7. Second review fixes

- [x] 7.1 Open no relay to an agent once the caller has hung up during the target lookup. Unit-test a disconnect while the lookup is held, asserting the agent sees no connection. Verify with `npm test` and `npm run check`.
- [x] 7.2 Bound spawn bodies at 16 KiB while reading: refuse a declared length over it unread, stop reading a chunked one where it crosses, and answer `413` with `Connection: close`. Unit-test declared, chunked and endless uploads. Verify with `npm test` and `npm run check`.

## 8. Separate images

- [x] 8.1 Give the runtime its own image per the design. Split the `Dockerfile` into the `agent` target (`jen-agent`, `src/` without `src/runtime/`, `ENTRYPOINT ["node", "src/main.ts"]`) and the `runtime` target (`jen-runtime`, `package.json` and `src/runtime/` only, no dependencies, no volume, no user, `ENTRYPOINT ["node", "src/runtime/main.ts"]`), and keep `fake-docker.ts` out of the build context. Rename `JEN_IMAGE` to `JEN_AGENT_IMAGE`, defaulting to `jen-agent`. Stop removing anonymous volumes with containers, since no container the runtime removes has one any more. Make both live checks build their image by target, start the runtime from `jen-runtime` with no command or user, drop the assertion about the runtime's `/state` volume, and check that the agent image contains nothing from `src/runtime/`. Verify with `npm run check`, `npm test`, `npm run test:live` and strict validation, and by hand: a missing `JEN_OWNER_TOKEN` exits, and `docker run jen-agent` still serves an agent.
- [x] 8.2 Update the record for the split: the run instructions and optional settings in `context/environment.md`, the runtime's decision in `context/decisions.md`, and JEN-10's status in `context/plan.md`. Verify the documented commands run as written and each file stays within its size budget.

## Workflow follow-up

- Mark PR #8 ready for review once every task is done and verified.
- Archive the change with `openspec archive` on the branch, so the pull request carries the specs into `openspec/specs/`.
- Squash-merge the pull request, then move JEN-10 to Done.
