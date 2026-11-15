# Proposal

## Why

jen's core concept is that the agents are the UI (see `record/product.md`), and today an agent has none. It can be reached only through `POST /messages` and `GET /events`, which suits an application but not a person. Agents are meant to build the software an organization runs on: apps that run without the agent, that people use together, and that the agent sees and acts on (see `record/decisions.md`, 2026-11-14). Every such app needs the same foundation underneath it: a place where code a model wrote runs safely in a person's browser, a way to ship new versions of it, and a single narrow door from that code to jen.

This change ([JEN-18](https://linear.app/reveer/issue/JEN-18)) builds that foundation for the web, for a root agent, following the decisions recorded on 2026-11-10 in [JEN-3](https://linear.app/reveer/issue/JEN-3) and on 2026-11-14. It doesn't build the data layer that apps will read and write, or decide how an agent answers what people do in its apps. Both are scoped separately (see `record/ideas.md`). It's done when the owner opens a root agent's page, the app the agent published shows in it and changes live when the agent publishes again, and a click in that app asks the agent something.

## What Changes

- **An agent writes its UI as files and publishes it.** The UI is one file in the agent's workspace, `ui/index.html`, written with the file tools from [JEN-19](https://linear.app/reveer/issue/JEN-19). It's HTML, CSS and JavaScript. The agent can keep whatever else it likes in its workspace. The file must stand alone once sent, with its scripts, styles and images inline, because the frame has no network to fetch anything else. A `publish_ui` tool sends the file as it is and makes it the agent's UI under a new version number. Edits are drafts until then, and the agent decides when to publish.
- **The agent serves jen's fixed page, which runs its UI in a sandboxed frame.** The page is jen's code, not the model's: the start of jen's web shell. It holds the viewer's token and the connection to the agent. It shows the latest version as soon as it opens and swaps in each new one as it's published. The frame has no network and can't read the token. Its only way out is the bridge.
- **The bridge has one request, `jen.ask`.** `jen.ask(context)` asks the agent something, carrying whatever JSON the app passes. The page sends it only when a person just clicked or typed in the frame, as an ordinary message from the viewer through `POST /messages`. The bridge's other requests, such as reading, watching and writing data, come with the data layer.
- **Every agent starts with a plain textbox.** Until it publishes, the agent serves a textbox shipped in its image as version 0: a box whose text is sent through `jen.ask`, the same path as any UI. It's a stand-in for stock jen's first screen.
- **The agent is told what the page does, and nothing about how to answer.** `publish_ui`'s description gives the contract: what the file must be, the bridge, and what the page shows. No agent's instructions mention a UI, and nothing tells the agent how to answer an ask or what a UI must hold.
- **UI is optional.** An agent that never publishes works exactly as it does today, and an application reaching it through `/messages` and `/events` sees no change.
- **The runtime relays the UI's routes.** It relays the page and the latest UI the way it relays `/messages` and `/events`, and who may open an agent's UI follows who may reach it. Only the UI of a root agent with `workspace` is opened, and only from a local browser. Real auth stays with [JEN-4](https://linear.app/reveer/issue/JEN-4).
- **Checks of the sandbox and of the whole path.** A sandbox check runs in CI on every push. A live UI check on Sol (`openai/gpt-6-sol`) shows an agent publishing an app, the page swapping it in, and a click in it reaching the agent.

## Capabilities

### New Capabilities

- `agent-ui`: `ui/index.html`, `publish_ui` and its versions, the textbox, the fixed page and its sandboxed frame, the bridge and its one request, and what the agent is told.

### Modified Capabilities

- `agent-protocol`: the routes that serve the page and the latest UI.
- `agent-store`: the latest published version and its number, kept in `/state`.
- `agent-runtime`: relays the UI's routes, for a root agent only.
- `agent-delegation`: `publish_ui` among the tools a grant allows, and the behavior check counting a publish as a fault.

## Impact

- **Depends on [JEN-19](https://linear.app/reveer/issue/JEN-19)**, which gives agents a workspace and file tools.
- **Agent code:** a module for `publish_ui`, and the page and the textbox in `src/agent/ui/`. The tool is wired into the loop's tools, and the new routes go in `src/agent/server.ts`.
- **Runtime code:** the relay in `src/runtime/server.ts`.
- **Dependencies:** Playwright as a dev dependency, to drive a real browser in the checks. The agent's image gains none. CI gains a job that runs the sandbox check in Chromium.
- **Tools are behavior.** `publish_ui`'s description changes what every root with `workspace` sees, so the behavior check (`src/runtime/behavior.live.test.ts`) runs again on Luna.
- **Docs:** `docs/architecture.html` gains the page, the frame and the bridge.
