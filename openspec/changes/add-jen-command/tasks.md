# Tasks

## 1. Roots' names in the runtime

- [x] 1.1 In `src/runtime/runtime.ts`, `spawn` takes an optional name. The owner's must be 1 to 32 characters of lowercase letters, digits and hyphens, starting with a letter (`400` when missing or malformed), and no other root may have it (`409`). The name is checked in the tree-operation queue, so two spawns of the same name can't both pass. An agent that passes one gets `400`. The name is stored as a `jen.name` label on the root's volume, read back at startup (empty or missing reads as `null`), and `Agent` gains `name`. Verify with tests in `runtime.test.ts` for each refusal creating nothing, two concurrent spawns of one name, a sub-agent's `name` being `null`, the name surviving a runtime started again on the same fake engine, and a root without the label reading as `null` and blocking no name.
- [x] 1.2 In `src/runtime/server.ts`, the owner's `POST /agents` reads `{"grant", "name"}` and passes the name on, and every description of an agent carries `"name"`. Update the file's header comment. Verify with tests in `server.test.ts` for the `201` body with `name`, the owner's `400` and `409`, and an agent's `400`.
- [x] 1.3 Give every root spawned in a unit test or live check a name (`runtime.test.ts`, `server.test.ts`, and the runtime, UI, behavior, boundary and container checks where they spawn through the runtime), and verify `npm run check` and `npm test` pass.
- [x] 1.4 In `record/environment.md`, the owner's `POST /agents` takes `{"grant", "name"}` and answers with `"name"` too. Verify the description matches the `agent-runtime` delta spec.

## 2. The event stream's `synced`

- [x] 2.1 In `src/agent/server.ts`, `GET /events` sends `event: synced` with `data: {"seq": n}` each time it has sent every item saved so far: when it opens, after any resumed history, and after each later batch, never between items saved in one step. Update the file's header comment. Verify with tests in `server.test.ts` for each scenario in the `agent-protocol` delta spec: history of four items, an empty conversation, an assistant message and tool call saved together arriving before one `synced`, and resuming with `Last-Event-ID: 2`.
- [x] 2.2 Check the runtime's relay passes `synced` through unchanged and that `src/agent/ui/page.html` doesn't read `/events`. Verify with a test in `src/runtime/server.test.ts` that a relayed stream carries a `synced` event.
- [x] 2.3 In `record/environment.md`, `/events` also sends `synced` once it has caught up. Verify it says what the `seq` is.

## 3. The command's arguments and package entry

- [x] 3.1 Add `src/cli/main.ts`, starting `#!/usr/bin/env node`, which parses the arguments as the design's "Arguments" says (`new`, `list`, `stop @<name>`, `stop all`, `config`, `uninstall`, `help`, `@<name> open`, `@<name> <query>`) and dispatches to the modules below, with the usage text pointing to `jen uninstall` for removing jen. `jen help` exits 0; no arguments or an unknown word print the usage and exit 2. Every module is imported at startup. `src/cli/` imports only types from `src/runtime/` and `src/agent/`. Verify with tests in `main.test.ts` for each form, `jen start`'s exit 2, and a query of several arguments joined with spaces.
- [x] 3.2 In `package.json`, add `"bin": {"jen": "src/cli/main.ts"}` and make `main.ts` executable. Verify that `npm link` in the checkout puts `jen` on the path and `jen help` runs the TypeScript from the checkout.

## 4. The engine and the settings

- [x] 4.1 Add `src/cli/docker.ts`, which runs the user's `docker` command for the calls the design lists, passing secrets only through the child's environment and stdin, never its arguments. A missing `docker` or an engine that doesn't answer is an error saying Docker isn't reachable, before anything else runs. Verify with tests in `docker.test.ts` against a stubbed process runner, including that no argument holds a value passed as a secret.
- [x] 4.2 Add `src/cli/settings.ts`: reading `settings.json` from the `<name>-settings` volume through a short-lived container of the runtime's image with no network, writing it whole through a temporary file renamed over it from stdin, with the volume labelled `jen.runtime=<name>` and `jen.settings`, and an owner token of 32 random bytes as hex made once and kept. Reading the running runtime's token from its container's environment and its port from `docker port` lives here too. Verify with tests in `settings.test.ts` against a fake of `docker.ts`, including that a running runtime is read without starting a container.
- [x] 4.3 Add `jen config`: it asks for the model, the base URL and the key in that order, showing current values with the key masked and reading the key with echo off, keeps a value on an empty answer, fails without a terminal on stdin, and fails naming the runtime's image and its `docker build` command when the image is missing. Once saved, a running runtime is replaced without stopping agents (task 5.3). A command that needs the runtime and finds no settings runs the same questions from a terminal, or fails saying to run `jen config`. Verify with tests for each scenario in the "Settings are asked for", "first command asks" and "Changed settings" requirements, with a fake terminal.

## 5. Starting, replacing and stopping the runtime

- [x] 5.1 Add `src/cli/runtime.ts` with `ensureRuntime()` as the design's five steps say: the three images checked with `docker image inspect` (a missing one names its `docker build` command), the runtime and every container labelled `jen.runtime=<name>` inspected, a stale image ID triggering a stop of every agent and a restart that says so, `docker run -d --name <name>-runtime` labelled `jen.runtime=<name>` with the socket, `-p 127.0.0.1:<port>:8080` (or `127.0.0.1::8080` with no saved port, and one retry on a Docker-chosen port when the saved one fails), the settings passed by name, a name conflict treated as another `jen` starting it, the port read back and saved, and polling for at most 15 seconds, showing the runtime's last log lines if it exited. `JEN_RUNTIME_NAME`, `JEN_RUNTIME_IMAGE`, `JEN_AGENT_IMAGE` and `JEN_WORKSPACE_IMAGE` are honored, the last two passed on to the runtime. Verify with tests in `runtime.test.ts` against a fake of `docker.ts` and the API for each step, including a saved port that's taken, a name conflict, an exited runtime and a stale agent image.
- [x] 5.2 Measure how long the settings-reading container takes when the runtime starts, on Docker Desktop, and write the figure into the design's risk on it. Verify the design no longer says it wasn't measured.
- [x] 5.3 Replacing the runtime: for a new image, `POST /agents/<id>/stop` for each root through the running runtime (starting it on its current image first if it isn't running), then `docker rm -f <name>-runtime` and step 4. For `jen config`, the same without the stops. Verify with tests that a new image stops every root before the runtime is removed, and that `jen config` stops none.
- [x] 5.4 In `record/environment.md`, replace the hand steps for running jen (the token, the `docker run` and the `curl` calls) with building the images, `npm link` and the `jen` commands, keep the API's description for those working on the runtime, and change the rule that `src/` holds one directory per image to one per image plus `src/cli/`, which runs on the user's machine. Verify every command it gives runs as written once the live check (task 9) passes.

## 6. Creating, listing, stopping and opening roots

- [x] 6.1 Add `src/cli/api.ts`, the owner's client of the runtime's API: spawn with a name, list, start, stop, post a message and open the event stream with `Last-Event-ID`, with the runtime's errors shown as they come. Verify with tests in `api.test.ts` against an in-process stand-in of the runtime's API.
- [x] 6.2 Add `jen new <name>` (grant `{"spawn": true, "workspace": true}`, a malformed or taken name an error creating nothing), `jen list` (named roots sorted by name with `running` or `stopped`, then unnamed roots by ID marked as having no name), `jen stop @<name>` (stops that root and leaves the runtime running) and `jen stop all` (stops every root through the runtime, starting it first when agents run without it, then removes `<name>-runtime`, and says so when nothing is running). An unknown name is an error suggesting `jen new <name>`. Verify with tests for each scenario in the "creates a named root", "lists their roots" and "stops one root or everything" requirements.
- [x] 6.3 Add `src/cli/browser.ts` and `jen @<name> open`: start the root if it's stopped, print `http://127.0.0.1:<port>/agents/<id>/page#token=<owner token>`, and open it with `$BROWSER`, `open` on macOS, or `xdg-open` on Linux with a display, exiting 0 when none applies or the opener fails. Verify with tests in `browser.test.ts` for each opener, no opener, and a failing one.

## 7. Following a query

- [x] 7.1 Add `src/cli/follow.ts` and `jen @<name> <query>` as the design's "Following a root's work" says: start a stopped root, read history up to the first `synced` without showing it, post the query, print one stderr line per tool call (its name and an input summary cut to the terminal's width), per message from a sub-agent and per `error` event, and write to stdout the text of the first whole response with no tool call after the query's own message from `owner`, then exit 0. Verify with tests in `follow.test.ts` against a stand-in event stream for each scenario in the "query shows the root's progress" and "reply is only the text of a whole response" requirements, including text before a tool call and a second query not reprinting the first.
- [x] 7.2 When the stream ends before the reply, wait for the runtime as long as a start may take, reopen with `Last-Event-ID` while the root is `running`, and exit 1 saying the root stopped when it's `stopped`. Ctrl-C closes the stream, says the root is still working and how to open it, and exits 130 without stopping or messaging the root. Verify with tests for a stream cut mid-turn that resumes without repeating a line, a runtime that's unreachable for a while then answers, a root that's stopped, and Ctrl-C.
- [x] 7.3 Update `docs/architecture.html`: the `jen` command on the user's machine, which keeps its settings in a volume of its own and starts the runtime, and a query's flow from `jen` through the runtime to the root and back on `/events` with `synced`. Add `src/cli` to its `describes` tag. Verify the page opens in a browser and shows them.

## 8. Uninstalling

- [x] 8.1 Add `src/cli/uninstall.ts` and `jen uninstall` as the design's "Uninstalling" says: ask for `y`, fail without a terminal, then remove `<name>-runtime`, every container and then every volume labelled `jen.runtime=<name>`, the `<name>` network and the three images (skipping a missing one), carrying on past each failure and reporting it at the end, and print what it removed. It goes through no runtime. When the real path of `main.ts` is inside `npm root -g`'s `jenai` folder it runs `npm uninstall -g jenai`, and otherwise says the command was installed another way. Verify with tests in `uninstall.test.ts` for each scenario in the "Uninstalling deletes everything" requirement, against a fake of `docker.ts` and a stubbed `npm`.

## 9. The command's live check

- [x] 9.1 Add `src/cli/jen.live.test.ts`, run under a `JEN_RUNTIME_NAME` of its own and image tags of its own copied from the built images, with a fake terminal answering `jen config`. It creates a root, gets the reply to `Reply with just the word heron.` on stdout, sees a `run_command` progress line on stderr for a query that needs a command, runs `jen @<name> open` with no `$BROWSER` or display and fetches the printed URL's page, lists, stops the root, stops everything, and uninstalls, then finds no container, volume, network or image tag of its runtime left. It removes whatever it started in a `finally`, and skips without `JEN_LIVE_API_KEY` and `JEN_LIVE_MODEL`. Verify it passes with credentials and Docker, and skips without credentials.
- [x] 9.2 In `record/environment.md`, describe the command's live check: what it needs, what it runs under, and how to remove what it leaves when stopped by hand. Verify the clean-up commands match its runtime name and tags.

## 10. Record

- [x] 10.1 Add dated entries to `record/decisions.md` under JEN-25 for the design's decisions not yet there: `jen` reaches the engine through the `docker` command, not the socket, since only the command resolves the user's context; settings are asked for in the terminal rather than edited in `$EDITOR`, which would leave the key in files outside Docker; a new image is detected by image ID, not version; every root must have a name; and `synced` marks the end of history and of a step, rather than a quiet moment or matching the query's text. Fix 2026-10-26's TypeScript entry, which gives the npm emit step to JEN-25: it's JEN-26's. Verify each entry has its reason.
- [x] 10.2 In `record/plan.md`, record that deleting or organizing roots from `jen` is still open, under the open question on organizing and cleaning up agents. Verify the question names it.

## 11. Verification

- [x] 11.1 `npm run check` and `npm test` pass.
- [x] 11.2 The command's live check passes, and the runtime, UI, behavior, container and boundary checks still pass with named roots.
- [x] 11.3 By hand, from the checkout after `npm link`: `jen new home`, a query with progress, `jen @home open` in the browser, `jen config` with a new model while `home` runs, a rebuilt `jen-agent` stopping and restarting `home` on its next query, and `jen uninstall` leaving nothing of jen's in Docker.

## 12. The maintainer's review

- [x] 12.1 Start every line of `jen`'s own lowercase, write a blank line to stderr with a command's first output and as it exits when stderr is a terminal, and after the answers to its questions, require the base URL with no default endpoint (asking only for it when settings were saved without one), and say in the usage how to pass an unquoted `?` or `*` in zsh. Verify with `npm test`, and in a pseudo-terminal that the blank lines appear only there.

## Workflow follow-up

- Review the implementation with `review-change` until a re-review finds nothing new, then hand it to the maintainer with `deliver-change`.
- Once approved, archive the change and merge the pull request through `deliver-change`.
