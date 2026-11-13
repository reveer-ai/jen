# Proposal

## Why

jen's core concept is that the agents are the UI (see `record/product.md`), and today an agent has none. It can be reached only through `POST /messages` and `GET /events`, which suits an application but not a person. This change ([JEN-18](https://linear.app/reveer/issue/JEN-18)) gives a root agent a UI it writes itself, following the decisions recorded on 2026-11-10 in [JEN-3](https://linear.app/reveer/issue/JEN-3). It's done when the owner opens a root agent's UI in a local browser, clicks something in it, and sees the UI update with the agent's response.

## What Changes

- **An agent writes its UI as files and publishes it.** The UI is one file in the agent's workspace, `ui/index.html`, written and edited with the file tools from [JEN-19](https://linear.app/reveer/issue/JEN-19) in HTML, CSS and JavaScript. The agent can keep whatever else it likes in its workspace, but the file must stand alone once sent, with its scripts, styles and images inline, because the frame has no network to fetch anything else. Edits are drafts. A `publish_ui` tool sends the file as it is and makes it the agent's UI, under a new version number. The agent decides when to publish. Like any tool call, the publish is saved to the conversation and streamed on `/events` as soon as it's saved. That stream is how an open page learns a new version exists, so no new event type is added.
- **Every agent starts with a plain textbox, and from there its UI is all the agent's.** The image ships a starting UI, served as version 0: a box to type a message in, showing nothing of the conversation. It runs in the same sandbox as anything the agent writes later, so the textbox and generated UI share one path. The agent answers it by publishing a UI, and decides what every UI after it shows. Its instructions say so.
- **The agent serves a fixed page that runs its UI in a sandboxed frame.** The page is jen's code, not the model's. It holds the viewer's token and the connection to the agent. It loads the latest version from the agent, and runs it in a frame with no network access. A UI shows only what the agent published: the agent's text replies aren't shown, so it answers the user by publishing. When the stream carries a publish, the page fetches that version and swaps it in. It never reads a UI out of the conversation. The frame's only way out is an action handed to the page.
- **An action reaches the agent as an ordinary message.** The page sends it through the existing `POST /messages`, from the viewer. It says which UI version was acted on, carries the context the agent's UI passed to `jen.act` when the user acted (a phrase or structured data, written into the UI by the agent, passed through unread), and the current value of every input in the UI that has a name or ID, which the agent is told to give its inputs. The agent acts on it like any message, and may answer, rewrite its UI, or both.
- **UI is optional.** An agent that never writes a UI works exactly as it does today, and an application reaching it through `/messages` and `/events` sees no change. The instructions don't steer an agent to write a UI when nothing calls for one.
- **The runtime relays the UI's routes.** It relays the page and the latest UI the way it relays `/messages` and `/events`, and who may open an agent's UI follows who may reach it. Only the UI of a root agent with `workspace` is opened, since a root without one can't publish an answer, and only from a local browser. Real auth stays with [JEN-4](https://linear.app/reveer/issue/JEN-4).
- **A live check of the whole path, on Sol.** The agent writes a UI, an action on it reaches the agent as a message, and the UI updates. It runs on Sol (`openai/gpt-6-sol`), not Luna, since whether Luna's class must handle generative UI isn't decided (see `record/decisions.md`, 2026-11-10).

## Capabilities

### New Capabilities

- `agent-ui`: `ui/index.html`, `publish_ui` and its versions, the starting textbox, the fixed page and its sandboxed frame, how an action becomes a message, and the instructions about writing a UI.

### Modified Capabilities

- `agent-protocol`: the routes that serve the page and the latest UI.
- `agent-store`: the agent's published versions and their numbers, kept in `/state`.
- `agent-runtime`: relays the UI's routes, for a root agent only.

## Impact

- **Depends on [JEN-19](https://linear.app/reveer/issue/JEN-19)**, which gives agents a workspace and file tools. This change is designed against it and implemented after it merges.
- **Agent code:** a new module for `publish_ui`, the page and the starting UI in `src/agent/`, with the tool wired into the loop's tools and instructions, and the new routes in `src/agent/server.ts`.
- **Runtime code:** the relay in `src/runtime/server.ts`.
- **Dependencies:** Playwright as a dev dependency, to drive a real browser in the checks. The agent's image gains none. CI gains a job that runs the sandbox check in Chromium (see design.md).
- **Instructions are behavior.** The UI tool's description and instructions change how agents act, so the behavior check (`src/runtime/behavior.live.test.ts`) runs again on Luna to show delegation still holds.
- **Docs:** `docs/architecture.html` gains the page, the frame and the action path.
