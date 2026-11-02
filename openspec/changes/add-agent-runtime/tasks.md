# Tasks

## 1. Docker client

- [ ] 1.1 Write `src/runtime/docker.ts` per the design: a minimal Docker Engine API client on `node:http` over `/var/run/docker.sock`, with the API version pinned in the path. It covers volumes (create, list by label, remove), containers (create, start, list by label, inspect, rename, remove with force) and networks (create, inspect, connect with an alias). "Not found" counts as success on removal, and Docker errors become typed errors that carry the status. Unit-test request building and error mapping against a stub server on a Unix socket in a temp directory. Verify with `npm test` and `npm run check`.

## 2. The tree

- [ ] 2.1 Write `src/runtime/runtime.ts` per the design: spawn, stop, start, delete, list and get. Agents are volumes with labels, and runs are containers created with fixed settings, the `on-failure` restart policy (3 retries) and a fresh token whose hash is a container label. Include the descendant check, the grant subset check, the depth and count bounds, deepest-first cascades, the in-process operation queue, idempotent start, and the self-undoing spawn whose error carries the agent's ID. It takes the Docker client as a parameter. Add an in-memory fake engine as a test fixture, and unit-test each `agent-runtime` scenario it can reach: spawn by the owner and by an agent, a grant without `spawn`, both bounds with stopped agents counting, sibling and self, list scope, stop and delete cascades, start leaving descendants alone and removing a leftover container, a start that fails after create, a spawn with a lost start response, and token renewal. Verify with `npm test` and `npm run check`.
- [ ] 2.2 Add startup to `runtime.ts`: claim `<name>-runtime` by renaming its own container (found through its hostname), exit if a running container holds the name, and replace a dead one. Ensure the network exists and attach to it with the alias `runtime`. Then reconcile: remove containers that aren't alive (`running` or `restarting`) or that have no volume, and delete agents whose parent is gone, with their subtrees. Unit-test against the fake engine: a live holder, a dead holder, a restarting container left alone, an exited container removed, and a detached agent deleted. Verify with `npm test` and `npm run check`.

## 3. API, relay and entrypoint

- [ ] 3.1 Write `src/runtime/server.ts` on `node:http`: bearer auth resolving to the owner (constant-time) or a running agent (by token hash), the routes in the design, `400`/`403`/`404`/`409` as specified, and the relay of `/messages` and `/events` to `http://<container>:8080` with the agent's token, streaming the response and passing `Last-Event-ID` through. Test in-process on port 0 against the fake engine, with the relay pointed at an in-process `agent-protocol` server running the scripted model. Cover auth (no token, a stopped agent's token), each route's status codes, the relay of a message and an event stream with `Last-Event-ID`, a relay to a stopped agent, and an unknown route. Verify with `npm test` and `npm run check`.
- [ ] 3.2 Write `src/runtime/main.ts`: require `JEN_OWNER_TOKEN`, `JEN_MODEL` and `JEN_API_KEY`, read `JEN_BASE_URL`, `JEN_RUNTIME_NAME`, `JEN_IMAGE`, `JEN_MAX_DEPTH` and `JEN_MAX_AGENTS`, run startup, and listen on `0.0.0.0:8080` with the SIGINT/SIGTERM handlers. Change the `Dockerfile` to `ENTRYPOINT ["node"]` and `CMD ["src/main.ts"]`. Verify with `docker build -t jen .`. Then run by hand, and record in the PR: a missing `JEN_OWNER_TOKEN`, the default command still serving an agent, and a second runtime with the same name exiting.

## 4. Live check and docs

- [ ] 4.1 Write `src/runtime.live.test.ts` against real Docker, under a unique runtime name. Build the image and start the runtime as documented. Then:
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
- [ ] 4.2 Rewrite the run instructions in `context/environment.md`: build the image, start the runtime with the documented `docker run`, spawn a root agent and talk to it through the runtime with curl, and stop or delete it. Add `src/runtime/` to the code layout. Verify the documented commands run as written.

## 5. Record

- [ ] 5.1 Add JEN-10's project-level decisions to `context/decisions.md`:
  - the runtime runs as a container beside its engine, using the socket
  - Docker labels are the only record of the tree
  - every request to an agent is relayed
  - an owner token plus one token per agent
  - `spawn` is the only capability until a model proxy exists
  - a deliberate stop cascades and a crash doesn't, with crashed agents restarted by the engine
  - one runtime per name

  Update the JEN-10 status in `context/plan.md`, and fold the auth open question's runtime part into what was built. Verify each file stays within its size budget in `context/README.md`.

## Workflow follow-up

- Mark PR #8 ready for review once every task is done and verified.
- Archive the change with `openspec archive` on the branch, so the pull request carries the specs into `openspec/specs/`.
- Squash-merge the pull request, then move JEN-10 to Done.
