# Tasks

## 1. Store positions

- [x] 1.1 Add `after(seq)` to `src/agent/store.ts` per the design, returning `{ seq, item }` entries. Add tests to `store.test.ts` for each scenario in the `agent-store` delta: items after a position, positions surviving a reopen, and nothing after the last item. Verify with `npm test` and `npm run check`.

## 2. Protocol server

- [x] 2.1 Move `respond` from `src/main.ts` to `src/agent/respond.ts` unchanged, and its tests from `main.test.ts` to `src/agent/respond.test.ts`. Verify the moved tests pass unchanged with `npm test`.
- [x] 2.2 Write `src/server.ts` (`createServer({ store, model, token })`) on `node:http`, with the token check, `POST /messages`, the one-turn-at-a-time rule and 404s, per the design. Test it in-process on port 0 with `fetch` and the scripted model, covering each `agent-protocol` scenario for the token, messages, invalid messages, one turn at a time, failed turns, a sender hanging up, and unknown routes. Verify with `npm test` and `npm run check`.
- [x] 2.3 Add `GET /events` to `src/server.ts`: the backlog from the store, `Last-Event-ID` resumption, live delivery after each saved turn, and the 15-second keepalive, per the design. Test each `agent-protocol` event-stream scenario in-process, including two watchers and a failed turn sending nothing. Test the keepalive with fake timers. Verify with `npm test` and `npm run check`.

## 3. Entrypoint and image

- [x] 3.1 Rewrite `src/main.ts` as the server's entrypoint: require `JEN_MODEL`, `JEN_API_KEY` and `JEN_TOKEN`, open `/state/agent.db`, listen on `0.0.0.0:8080`, and keep the SIGINT/SIGTERM handlers. Add `EXPOSE 8080` to the `Dockerfile`. Verify with `docker build -t jen .`. Then run the `agent-container` scenarios by hand and record the results in the PR: a missing `JEN_TOKEN`, two messages to one container with curl, a non-root process, and `docker stop` mid-turn returning well inside the 10-second timeout.
- [x] 3.2 Rewrite `src/container.live.test.ts` per the design: one container is sent a message, then a new container on the same volume is asked to recall it. Also check a request without the token gets 401, and that `GET /events` returns all four items in order. Always remove the containers and the volume. It skips without live credentials and fails without Docker. Verify that it skips with no credentials and passes against a real model.
- [x] 3.3 Replace the `docker run` example in `record/environment.md` with starting the agent detached on `-p 127.0.0.1:8080:8080` with `JEN_TOKEN`, then talking to it with curl (`POST /messages`, and `curl -N` on `/events`). Update the code layout for `src/server.ts` and `src/agent/respond.ts`. Verify the documented commands run as written.

## 4. Record

- [x] 4.1 Add JEN-9's project-level decisions to `record/decisions.md`:
  - jen's own protocol over HTTP and SSE, not WebSocket or A2A
  - the stream carries saved items only, with resumption by position
  - a required bearer token, explicitly a minimum, with auth to be designed in depth later
  - one turn at a time, as a placeholder for JEN-2
  - no `jen` CLI until distribution

  Mark the JEN-8 entry on the one-shot entrypoint superseded. Update the JEN-9 status in `record/plan.md`, and add deeper auth design to its open questions. Verify each file stays within its size budget in `record/README.md`.

## 5. Review fixes

From the [review of PR #6](https://github.com/reveer-ai/jen/pull/6#pullrequestreview-5682865860).

- [x] 5.1 Route on the request target as a string, so `GET //` gets 404 instead of throwing, and contain unexpected request failures inside the handler. Test a raw `//` target followed by a normal message.
- [x] 5.2 Check the one-turn-at-a-time flag when a message arrives as well as after its body is read. Test a message whose body finishes after the running turn.
- [x] 5.3 Stop delivery to a stream whose buffer is full and resume on `drain`, reading the store in pages (`after(seq, limit)`), with the keepalive skipped while draining. Test a stalled watcher on a long conversation: bounded buffering, other clients served, every item once it reads.
- [x] 5.4 Update the design and the `agent-protocol` and `agent-store` deltas for routing, the arrival check and the slow-watcher policy. Verify each new test fails against the reviewed code, then run `openspec validate --strict`, `npm test` and `npm run check`.

## Workflow follow-up

- Open a pull request titled with JEN-9 and get it reviewed.
- Archive the change with `openspec archive` on the branch, so the pull request carries the specs into `openspec/specs/`.
- Squash-merge the pull request, then move JEN-9 to Done.
