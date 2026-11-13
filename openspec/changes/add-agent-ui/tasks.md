# Tasks

## 1. Versions in the store

- [ ] 1.1 Add a one-row `ui` table to `src/agent/store.ts`, with `publish(document)`, which saves the next version from 1 in one transaction and returns its number, and `latestUi()`, which returns `{version, document}` or `undefined`. Verify with `store.test.ts`: none before a publish, two publishes and a reopen give version 2 and the second document.

## 2. Publishing

- [ ] 2.1 Add `parse5` to the agent's dependencies, and write the bundler in `src/agent/ui.ts`. It reads `ui/index.html` and what it references through `RuntimeClient.readFile`, follows the references the design lists, resolves them within `ui/`, and inlines each as a `data:` URL typed from a fixed extension table, rewriting stylesheets first. It collects every refusal (missing entry or file, a scheme or `//`, leaving `ui/`, a stylesheet that isn't UTF-8, an import cycle, over 4 MiB with the largest files named) and refuses with all of them. Verify with `ui.test.ts` against a fake `RuntimeClient`, for each scenario in the spec's publishing requirements.
- [ ] 2.2 Add `publish_ui` to `src/agent/ui.ts` with the description the design gives, offered by `toolsFor` in `src/agent/delegation.ts` only to a root with `workspace`. It saves through `store.publish` and returns the version, size and files inlined. Add the UI paragraph to `instructions` for a root with `workspace`. Verify with `delegation.test.ts` that the tool and the paragraph appear only for a root with `workspace`, and with `ui.test.ts` that a refused publish leaves the version unchanged.

## 3. The page, the bridge and the textbox

- [ ] 3.1 Write `src/agent/ui/textbox.html`: the conversation's messages and errors, and a box whose send calls `jen.act(text)`. Use the `action` field to show a user's action as what they typed.
- [ ] 3.2 Write `src/agent/ui/page.html`, holding the bridge:
  - the token from the fragment, kept in `sessionStorage`, with the fragment removed
  - `ui` and `events` fetched with the token, and events parsed from the body, reconnecting with `Last-Event-ID` and a backoff up to 30 seconds
  - the frame built as the design gives it
  - items, errors and parsed actions passed in
  - the swap on a `publish_ui` result, with one fetch of `ui` in flight
  - actions checked for source, version, `navigator.userActivation.isActive` and the 1 MiB bound, then posted to `messages` in the given format
  - the failure bar

  Verify in the sandbox check (5.1).
- [ ] 3.3 Add `GET /page` (with the design's CSP and `Cache-Control: no-store`) and `GET /ui` to `src/agent/server.ts`, and update its header comment. Verify with `server.test.ts`: both need the token, `/ui` gives version 0 and the textbox before a publish and the latest after, and `/page` carries the policy.

## 4. The runtime

- [ ] 4.1 In `src/runtime/server.ts`, route `GET /agents/:id/page` before authentication to a new `Runtime.pageTarget(id)`. It returns the address of a running root, and otherwise throws one `404`, `no running root agent <id>`, starting nothing. Relay `GET /agents/:id/ui` as `/events` is relayed, refused with `403` for a sub-agent. Update the header comment. Verify with `server.test.ts` and `runtime.test.ts` against `fake-docker.ts`:
  - the page relays with no token
  - a stopped root, a sub-agent and an unknown ID all get the same `404` and nothing starts
  - `/ui` needs a token that reaches the agent, and gets `403` for a sub-agent

## 5. Checks

- [ ] 5.1 Add Playwright as a dev dependency. Write `src/agent/sandbox.live.test.ts` as the design gives it: the agent's server in-process, with a scripted model and a store holding a hostile document, a probe server, headless Chromium, and the four assertions. Add a `sandbox` job to `.github/workflows/ci.yml` that installs Chromium and runs it on every push. Verify by running it locally, then by CI's `sandbox` job.
- [ ] 5.2 Write `src/runtime/ui.live.test.ts` as the design gives it, on `openai/gpt-6-sol` with the live credentials. Run it until it passes, and record in the design what Sol wrote and how many runs it took. Reword `publish_ui`'s description or the paragraph only on a run's evidence.
- [ ] 5.3 Count a `publish_ui` call as a fault in `src/runtime/behavior.live.test.ts`. Run the behavior check on `openai/gpt-6-luna` and hold it to the bar set on 2026-11-11.

## 6. Docs and record

- [ ] 6.1 Add the page, the frame, the bridge and the action path to `docs/architecture.html`, and add the new source paths to its `describes` meta. Verify by opening the page and reading the new section against the design.
- [ ] 6.2 In `record/environment.md`:
  - describe `ui.ts` and `src/agent/ui/` in the code layout
  - add the page and UI routes to the API paragraph, with how the owner opens a root's UI
  - describe the sandbox and UI checks under the commands

  Verify each claim against the code.
- [ ] 6.3 Add the WebRTC exit to [JEN-21](https://linear.app/reveer/issue/JEN-21)'s description in Linear, as something it must close or record why not.
