# Tasks

## 1. Agent store

- [ ] 1.1 Write `src/agent/store.ts` (`openStore`, `Store`) on `node:sqlite`, per the design: one `items` table, one JSON row per item, each turn appended in one transaction. Add tests against a temporary directory for each `agent-store` storage scenario: first open, reload after reopening, every item type, and a failure partway through saving a turn. Verify with `npm test` and `npm run check`.

## 2. Entrypoint

- [ ] 2.1 Write `src/main.ts`: `respond(store, model, text)`, plus, when run directly, reading the environment and arguments, the fixed `/state/agent.db` path, stdout/stderr and exit codes, and SIGINT/SIGTERM handlers. Test `respond` with the scripted model for the `agent-store` turn scenarios: the second message sees the first, a failed turn saves nothing, and the reply is the assistant messages that end the turn. Verify with `npm test` and `npm run check`.

## 3. Image and persistence check

- [ ] 3.1 Add the `Dockerfile` and `.dockerignore` per the design. Verify that `docker build -t jen .` succeeds, and that the image holds no `.env`, tests or dev dependencies. Run the `agent-container` scenarios by hand and record the results in the PR: no message, missing `JEN_API_KEY`, a non-root process, and `docker stop` mid-turn returning well inside the 10-second timeout.
- [ ] 3.2 Write `src/container.live.test.ts` per the design: build the image, run two messages in two fresh containers on one new named volume, check that the second reply contains the remembered word, and always remove the volume. It skips without live credentials and fails without Docker. Verify that it skips with no credentials and passes against a real model.
- [ ] 3.3 Document `docker build -t jen .` and a two-message `docker run` example on a named volume in `context/environment.md`, alongside `test:live`'s new Docker requirement. Verify the documented commands run as written.

## 4. Record

- [ ] 4.1 Add JEN-8's project-level decisions to `context/decisions.md`: the container is the only supported way to run an agent, the conversation is stored as one JSON row per item, and the one-shot entrypoint stands until JEN-9. Update the JEN-8 status in `context/plan.md`. Verify each file stays within its size budget in `context/README.md`.

## Workflow follow-up

- Open a pull request titled with JEN-8 and get it reviewed.
- Archive the change with `openspec archive` on the branch, so the pull request carries the specs into `openspec/specs/`.
- Squash-merge the pull request, then move JEN-8 to Done.
