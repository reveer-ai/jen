# Design

## Context

An agent is reached only through its protocol, `POST /messages` and `GET /events` (`src/agent/server.ts`). The runtime relays both, stamping the sender in `Jen-From`, after checking that the caller's token reaches the agent (`relay` in `src/runtime/server.ts`). Since [JEN-19](https://linear.app/reveer/issue/JEN-19), an agent with `workspace` reads and writes files in `/home/agent` through the file tools, and its own code reads a file's exact bytes with `RuntimeClient.readFile` (`src/agent/delegation.ts`). The conversation, inbox and outbox live in SQLite in `/state` (`src/agent/store.ts`).

See proposal.md for what this change builds and why, and `record/decisions.md` (2026-11-10) for the decisions it builds on: agents write their UI as code, the UI runs in a sandboxed frame inside a fixed page the agent serves, interfaces are dumb, and only a root agent's UI is opened, only locally.

## Goals / Non-Goals

**Goals:**

- **The frame's only way out is an action handed to the page.** The viewer's token is out of the model's code's reach, and the frame reaches no server.
- **An action is a message the user made.** The UI can't send the agent messages on its own, such as on load.
- **A broken publish fails at once, saying why**, so the agent can fix it in the same turn.
- **Nothing changes for an agent that never writes a UI**, or for an application using `/messages` and `/events`.

**Non-Goals:**

- Sub-agents' UIs. Only a root is offered `publish_ui`, and the runtime relays the UI routes only for a root (see decisions.md, 2026-11-10).
- Real auth, TLS, and reaching a UI from anywhere but the owner's machine. They belong to [JEN-4](https://linear.app/reveer/issue/JEN-4).
- A data channel from the agent to its UI other than its conversation and the files it publishes (see "How the agent updates its UI").
- Reporting a UI's runtime errors to the agent (see Risks).
- Keeping old versions. Only the latest is kept, as decided on 2026-11-10.

## Decisions

### Where the UI lives, and who may publish it

The UI is the folder `ui/` in the agent's workspace, `/home/agent/ui/`, entered at `ui/index.html`. The agent writes it with `write_file` and `edit_file`. Nothing reads the folder until the agent calls `publish_ui`.

`publish_ui` is offered to an agent that is a root (its parent is `owner`) and has `workspace`. A root without `workspace` keeps the textbox, version 0, for good. A sub-agent isn't offered the tool, since nobody can open its UI.

*Why tie it to `workspace`:* the UI is files, and files live in the workspace. Granting a UI without a workspace would need a second place to write files.

### Publishing bundles the folder into one document

The frame can't make network requests (below), so it can't load the files `index.html` references, such as its scripts, stylesheets and images, the way a browser normally would. `publish_ui` therefore reads `ui/index.html` and every file it references, and inlines each reference as a `data:` URL. The result is one HTML document, saved as the next version.

References followed, each resolved against the file that holds it:
- In HTML: `src` on `script`, `img`, `source`, `audio`, `video`, `track` and `input`; `srcset` on `img` and `source`; `poster` on `video`; `href` on `link`; `href` on SVG `image` and `use`.
- In CSS, from `.css` files, `<style>` elements and `style` attributes: every `url()` and `@import`. A stylesheet is rewritten before it's inlined, so its own references are inlined too.

Left as they are: `data:` and `blob:` URLs, references to a fragment alone (`#id`), and `<a href>`, which is navigation, not a fetch.

A reference starting with `/` is read from `ui/`, which is the UI's root. A reference with a scheme or starting with `//` is refused, because the frame can't reach it. So is a path that leaves `ui/` or a file that doesn't exist. A query string is dropped and a fragment kept. A stylesheet that isn't UTF-8 is refused. Each file's type comes from its extension, from a fixed table.

Scripts are inlined whole and not read, so an `import` of another file in `ui/` won't load in the frame, and neither will a `fetch` of one. The tool's description tells the agent to keep each module in one file and put data in a script.

The bundle holds at most 4 MiB. Past that, the tool refuses and names the largest files.

A publish is all or nothing. It collects every problem it finds and refuses with the whole list, so one call shows the agent everything to fix. Nothing is saved and the version doesn't change. On success, the result names the new version, its size and the files inlined.

The HTML is parsed with `parse5`, a dependency of the agent's image. It's the WHATWG-conformant parser jsdom is built on, so a reference is found where a browser would find it, never inside a comment, a string or a script's text.

*Alternatives:*
- **Serving `ui/` as files to the frame**, scoped by CSP to the version's own path. The frame's requests carry no token, so the files would have to be served without auth, and they're the owner's data.
- **Bundling in the page with the browser's `DOMParser`**, storing the folder as files. The agent would learn of a missing file only if someone opened the UI, and it would need a way to list the folder.
- **Matching references with regular expressions.** They misread HTML, for example a `src=` inside a script's text.
- **Following `import`s between scripts.** That needs a JavaScript parser and a module bundler. Models write single-file UIs well, and the description asks for them.

### Versions, kept in `/state`

The store gains one row: the latest version's number and document. `publish` saves a document as the next number, in one transaction, and returns the number. Versions count from 1. Version 0 is the textbox, which isn't stored: the agent serves it while it has published nothing.

The publish is saved before `publish_ui`'s result. If the agent stops between the two, the version stands and the call's result says it was interrupted. That's true either way, and the page still finds the new version (below).

### The textbox, version 0

The image ships `src/agent/ui/textbox.html`, one self-contained document. It shows the conversation's messages and errors, and has a box to type in. Sending calls `jen.act(text)`, the same call any UI makes, so the textbox exercises the whole path: frame, bridge, page and message.

### The page

`GET /page` on the agent serves jen's fixed page, `src/agent/ui/page.html`. It's the same for every agent of an image and holds no agent data. Opened in a browser, the page:

1. Reads the viewer's token from the URL's fragment (`#token=…`), which never reaches a server. It keeps the token in `sessionStorage`, so a reload keeps working, and removes the fragment from the address bar.
2. Fetches `ui` (relative to its own path), `{"version", "document"}`, with the token.
3. Opens `events` with `fetch`, not `EventSource`, because `EventSource` can't send an `Authorization` header. It reads Server-Sent Events from the body, and reconnects with `Last-Event-ID` after a drop, waiting longer after each failure, up to 30 seconds.
4. Runs the document in a frame (below) that fills the page, and passes it every item and error event.
5. When an item is a `tool_result` for a `publish_ui` call, which it matches by the call's ID, it fetches `ui` again. If the version is new, it swaps the frame for the new one and replays the conversation into it. Replayed old publishes each fetch `ui` too, but no more than one fetch is in flight, and an unchanged version changes nothing.
6. Posts each action the frame hands it (below) to `messages`, as the viewer.

The page draws nothing of its own except a thin bar for its own failures: no token, `401`, a refused action or a dropped connection.

The page's own response carries `Content-Security-Policy: default-src 'none'; script-src 'unsafe-inline' data:; style-src 'unsafe-inline' data:; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'self'; frame-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`. `frame-ancestors 'none'` stops another site framing the page to steer clicks. `frame-src 'none'` refuses a navigation of the frame away from its document, in a browser that lets a sandboxed frame navigate itself. Chromium 156 refused it from the sandbox alone, even with no policy on the page (below), so the directive's own effect is unmeasured. A srcdoc frame inherits the page's policy, so the page's policy allows whatever the frame needs except network access.

### The frame

The frame is `<iframe sandbox="allow-scripts">` whose `srcdoc` the page builds as:

```
<!doctype html>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' data:; style-src 'unsafe-inline' data:; img-src data: blob:; font-src data:; media-src data: blob:; form-action 'none'; base-uri 'none'">
<script>/* the bridge */</script>
<!-- the published document, as it is -->
```

- **No `allow-same-origin`**, so the frame has an opaque origin. It can't read the page's DOM, `sessionStorage` or cookies, and so never sees the token.
- **The frame's own CSP** has no `connect-src`, so `default-src 'none'` blocks every fetch, XHR, WebSocket, beacon and prefetch. It comes first, so it applies before any of the model's code runs. Later policies can only tighten it, and removing the element leaves it in force.
- **The page's `<!doctype html>` comes first**, so the document renders in standards mode even if the agent left the doctype out. The document's own doctype then counts as a parse error and is ignored. Its `<html>` and `<head>` merge with the ones the parser opened.
- **No `allow-forms`, `allow-popups` or `allow-top-navigation`.**

Measured on 2026-11-13 in Chromium 156, the desktop app's built-in browser, with a probe server logging every request it got. A frame built as above:
- ran inline scripts, classic and module scripts from `data:` URLs, a `data:` stylesheet and a `data:` image
- got a `SecurityError` reading `parent.document`, `document.cookie` and `localStorage`, and its origin was `null`
- sent nothing to the server from any of these: `fetch` (same host and external), an image, CSS `@import` and `url()`, `<link rel=prefetch>`, `sendBeacon`, a WebSocket, a form `submit()`, `window.open`, a click on a `target=_top` link, or setting `location.href`. The last two sent nothing even with no policy on the page, while an unsandboxed frame's navigation reached the server.

One exit got through: WebRTC (see Risks).

### The bridge, and what an action carries

The bridge is jen's script, run in the frame before the document. It defines `window.jen`:
- `jen.version`: the version this frame shows.
- `jen.subscribe(fn)`: calls `fn` with every conversation item so far, then with each new one. Items are as `/events` sends them, plus `{"type": "error", "message"}` for an error event. A user message that is an action also gets an `action` field, `{version, context, inputs}`, parsed by the page, so a UI can show what the user did without parsing the text.
- `jen.act(context)`: hands the page an action. `context` is any JSON value the agent chose for the control: a phrase, or structured data. With it, the bridge collects `inputs`, the current value of every `input`, `select` and `textarea` that has a `name` or `id`, keyed by it. A checkbox gives a boolean, unless other checkboxes share its name, and then the group gives the array of its checked values, as a form would submit them. A radio group gives the checked value, a multiple `select` an array, and a file input nothing. An input with neither a `name` nor an `id` is left out, since it has no key the agent could act on, and the tool's description tells the agent to name its inputs.

The page sends an action as a message whose text is:

```
UI action on version 3:
{"context":"approve","inputs":{"note":"Looks good"}}
```

It's an ordinary message from the viewer. The runtime stamps the sender from the token, so it's `owner`, the root's parent. It reaches the agent like any message from the user, wakes it, and is owed a reply.

The page accepts an action only:
- **if it came from the current frame.** `event.source` must be the frame's window, and the version must be the one showing. An action from a frame being swapped out is dropped.
- **if the user just interacted with the frame.** The page reads `navigator.userActivation.isActive` when the action arrives. Activation in a frame activates its ancestors, so the page sees a click made in the frame. Measured on 2026-11-13 in the same browser: an action posted on load read `false`, one posted from a click `true`, and one posted 7 seconds after the click `false`. A dropped action shows in the page's bar. This is what makes "no control acts on its own" hold in code: a UI that calls `jen.act` on load or on a timer sends nothing.
- **if it fits.** A message over 1 MiB, the protocol's bound, is refused in the bar.

*Alternatives:*
- **Controls marked with an attribute**, such as `data-jen-action`, sending actions without script. It's a second way to do what `jen.act` does, and models write `onclick` as readily.
- **A rate limit on actions.** It allows automatic messages up to the limit. Requiring activation allows none.
- **Posting actions to a route of their own** for the agent to format. The proposal kept actions as ordinary messages through `/messages`, so an application could send one too.

### How the agent updates its UI

What the UI shows comes from two places: the files the agent publishes, and the conversation, which the UI reads through `jen.subscribe`. To change the UI, or the data baked into it, the agent edits `ui/` and publishes. To answer the user, it replies, and a UI that shows the conversation shows the reply. The tool's description tells the agent to show its replies in any UI it writes, since otherwise the user never sees them.

*Considered:* a channel for structured data from the agent to its open UI, such as a tool that pushes JSON to the frame. It's a second way to update the UI, and nothing in this milestone needs one that a publish doesn't cover. It can come later without changing anything here.

### The instructions and the tool's description

For a root with `workspace`, the instructions gain one paragraph:

> The user sees you through a page in their browser that shows your UI. Until you publish one, it's a plain textbox showing your conversation. When a task would be easier for the user with a UI of its own, such as a form to fill in, options to choose from or results to look over, write one in ui/ in your workspace and publish it with publish_ui. When a reply is enough, don't write one. A message that starts with "UI action on version" is the user acting on your UI. Act on it as on any message from the user.

`publish_ui` takes no input. Its description gives the contract:
- `ui/index.html` is the entry
- what is inlined, and that network references are refused
- that `fetch`, imports between files and links to other pages don't work
- `jen.subscribe` and `jen.act`, that actions must come from the user's clicks or keys, and to give each input a `name`
- to make each action's context say everything the agent will need to act on it, since nothing else on the page is sent with it, such as a heading beside the button
- to show replies
- the 4 MB bound

These are behavior, so the behavior check runs again (see Checks).

### The routes

On the agent, both behind its bearer token like every route:
- `GET /page`: the fixed page, `text/html`, with the CSP above and `Cache-Control: no-store`.
- `GET /ui`: `{"version": <n>, "document": "<html>"}` as `application/json`, the latest version or the textbox. JSON keeps the document from being rendered at the runtime's origin by any route.

On the runtime:
- **`GET /agents/:id/page` is relayed without a credential**, only to a running root agent. Anything else, whether a stopped agent, a sub-agent or an unknown ID, gets one `404`: `no running root agent <id>`. It's the one route without a token, because a browser opening a URL can't send a header. It serves jen's fixed code, the same for every agent of an image. The cost is that anyone who can reach the runtime's port can learn whether a 12-hex-digit ID belongs to a running root. The runtime is published only on `127.0.0.1`.
- **`GET /agents/:id/ui` is relayed like `/events`**: the caller must reach the agent, and it must be running. It's refused with `403` unless the agent is a root.
- The page's messages and events use the existing `/messages` and `/events` routes, unchanged.

The owner opens a root's UI at `http://127.0.0.1:8080/agents/<id>/page#token=<owner token>`.

*Alternatives:*
- **The token in the query string.** It reaches the server, its logs and every relay. A fragment stays in the browser.
- **A cookie set by the runtime.** That's a login, which is JEN-4's.
- **The runtime serving the page from its own image.** The page and its bridge belong to the agent's version, and the runtime has no UI role (decisions.md, 2026-11-10).
- **Starting a stopped root for the page.** An unauthenticated request would then start agents. The owner starts it, or messages it, which starts it.

## Checks

- **Unit tests:** the bundler against a fake `RuntimeClient`: each reference kind, nested CSS, every refusal collected in one error, the bound. Also the store's versions; the routes and their refusals on the agent and runtime; the tool offered only to a root with `workspace`; and the instructions.
- **The sandbox check**, `src/agent/sandbox.live.test.ts`, needs no model or Docker. It serves an agent's routes in-process with a stored hostile document, opens the page in headless Chromium through Playwright, and asserts:
  - nothing reaches a probe server
  - the token can't be read from the frame
  - an action on load is dropped
  - a click's action reaches the inbox in the given format

  Like the boundary check, CI runs it on every push, in a `sandbox` job that installs Chromium. It skips WebRTC (see Risks).
- **The UI check**, `src/runtime/ui.live.test.ts`, runs the whole path on `openai/gpt-6-sol` through the live credentials, with Docker:
  1. A root is spawned with `workspace` and its page opened in Playwright, showing the textbox.
  2. The check types in it a task asking for a UI with a button that asks the agent for a number and shows the latest one.
  3. Once a version above 0 is up, the check clicks the button.
  4. It passes when the frame then shows the agent's new number.
- **The behavior check** runs again on `openai/gpt-6-luna`, since its command and file tasks' roots now see the UI paragraph and `publish_ui`. A run that calls `publish_ui` is a fault: none of its tasks asks for a UI. It's held to the bar set on 2026-11-11.

*Why Playwright:* it drives a real Chromium in CI and in the frame, with trusted clicks that give user activation. It's a dev dependency only. *Alternative:* driving Chrome over the DevTools protocol by hand with Node's WebSocket, which still needs a browser binary and rebuilds what Playwright gives.

## Risks / Trade-offs

- **WebRTC leaves the frame.** Measured on 2026-11-13: an `RTCPeerConnection` in the frame sent STUN packets over UDP to a host it named, with `webrtc 'block'` in the frame's policy or the page's. Chromium 156 doesn't enforce that directive. So a UI can send data out over UDP. Today that adds nothing: the agent that wrote the UI reaches the internet itself, and the frame holds only the conversation, which the agent already has. Once [JEN-21](https://linear.app/reveer/issue/JEN-21) cuts the agent off, the frame becomes the one way out, so JEN-21 must close it or record why not. Deleting `RTCPeerConnection` in the bridge doesn't close it: a nested `about:blank` frame has a fresh one.
- **The owner's token is in the URL they open**, so it can land in browser history before the page removes it. It's local, it's the owner's own browser, and JEN-4 replaces it.
- **A UI that breaks at runtime is invisible to the agent.** An `import` of another file, a `fetch` or a plain bug shows only in the browser's console, and the user tells the agent. Reporting errors automatically would send messages the user didn't make.
- **Swapping versions loses what the user typed** in the old frame. The agent decides when to publish.
- **Activation lasts a few seconds**, so a click's handler can send several actions, or one on a short timer. It can't send any without the user.
- **Only Chromium is checked.** Safari and Firefox implement the same sandbox, CSP and user-activation rules, but no check runs on them.
