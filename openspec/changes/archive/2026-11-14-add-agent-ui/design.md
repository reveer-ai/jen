# Design

## Context

An agent is reached only through its protocol, `POST /messages` and `GET /events` (`src/agent/server.ts`). The runtime relays both after checking that the caller's token reaches the agent, and stamps the sender in `Jen-From` (`relay` in `src/runtime/server.ts`). Since [JEN-19](https://linear.app/reveer/issue/JEN-19), an agent with `workspace` reads and writes files in `/home/agent` through the file tools. Its own code reads a file's exact bytes with `RuntimeClient.readFile` (`src/agent/delegation.ts`). The conversation, inbox and outbox live in SQLite in `/state` (`src/agent/store.ts`).

This change builds on the decisions in `record/decisions.md`:
- **2026-11-10:** agents write their UI as code. It runs in a sandboxed frame inside a fixed page the agent serves. Only a root agent's UI is opened, and only locally.
- **2026-11-14:** an agent's app runs without the agent, and the agent sees everything that happens in it. jen ships capabilities, not components: a shell, a bridge with a small fixed set of requests, and the data sync behind them. A message to the agent still needs a person to have acted. The web is the first surface.

This change is the web shell's foundation under that direction: the parts every agent-built app will run inside, whatever the data layer turns out to be. See proposal.md for what it builds and why.

## Goals / Non-Goals

**Goals:**

- **The frame's only way out is the bridge.** The viewer's token is out of reach of the model's code, and the frame reaches no server.
- **A request to the agent is one a person made.** A UI can't ask the agent anything on its own, such as on load.
- **A broken publish fails at once and says why**, so the agent can fix it in the same turn.
- **Nothing changes for an agent that never publishes**, or for an application using `/messages` and `/events`.
- **Nothing here decides what the data layer will.** That covers how an app gets live data, how the agent answers what people do, and what wakes the agent.

**Non-Goals:**

- App data and the bridge's other requests: read, watch and write data, who's here, files, and opening another app. These come with the data layer and the shell (see `record/ideas.md`).
- Telling the agent how to answer an ask, or what a UI must hold.
- Sub-agents' UIs, and a UI for a root without `workspace` (see decisions.md, 2026-11-10).
- Real auth, TLS, more than one viewer, and reaching a UI from anywhere but the owner's machine. These belong to [JEN-4](https://linear.app/reveer/issue/JEN-4).
- Any way for a UI to read the conversation.
- Reporting a UI's runtime errors to the agent (see Risks).
- Keeping old versions. Only the latest is kept, as decided on 2026-11-10.
- Publishing more than one file. A framework's build can produce one file. Installing packages in an offline workspace is its own idea (see `record/ideas.md`).

## Decisions

### What this change builds, and what it leaves out

It builds:
- the fixed page
- the sandboxed frame
- the bridge, with one request
- publishing with versions, and the live swap
- the textbox as version 0
- the runtime's routes

Each of these is needed whatever the data layer becomes.

It leaves out every rule about how the agent answers. Until the data layer exists, a published version is the only thing the agent can change on the page. Whether and when it publishes is the agent's decision.

*Why:* set by the maintainer on 2026-11-14. The first implementation told every agent to answer each action by republishing, and to give every UI a way to keep talking to it. That taught the habit the 2026-11-14 direction rules out: a model turn and a new version for every interaction. How an app shows what the agent says belongs to the data layer.

### Where the UI lives, and who may publish it

The UI is the file `ui/index.html` in the agent's workspace, `/home/agent/ui/index.html`. The agent writes it with `write_file` and `edit_file`, and may keep anything else it likes beside it. Nothing reads the file until the agent calls `publish_ui`.

`publish_ui` is offered to an agent that is a root (its parent is `owner`) and has `workspace`. A sub-agent isn't offered it, since nobody can open its UI. A root without `workspace` has no place to write one. The runtime refuses its page (see "The routes"), and it's reached through `/messages` and `/events` as before.

*Why tie it to `workspace`:* the UI is files, and files live in the workspace. Granting a UI without a workspace would need a second place to write files.

### Publishing sends `ui/index.html` as it is

The frame can't make network requests (below), so a UI can't load other files the way a page in a browser normally would. The agent may keep whatever it likes in its workspace, such as source files, notes or a build step. What it publishes is one file, `ui/index.html`, which must stand alone once sent: scripts and styles inline, images and fonts as `data:` URLs, and nothing fetched. `publish_ui` reads the file's bytes and saves them, unchanged, as the next version. It doesn't parse or rewrite the file.

It refuses when `ui/index.html` is missing, isn't UTF-8, or is over 4 MiB, saving nothing and leaving the version unchanged. On success, the result names the new version and its size.

If the file still refers to another file or a server, that reference fails in the frame, and the agent isn't told (see Risks).

*Why:* set by the maintainer in the design review on 2026-11-13. Models write self-contained pages well, and the agent stays free to work however it likes before it publishes. jen keeps no bundler and no list of the HTML and CSS that loads files. Publishing a built folder can come later and adds to this tool without replacing it.

*Alternatives:*
- **jen bundling the folder.** jen would parse `ui/index.html` with `parse5`, follow every attribute, CSS `url()` and `@import` that loads a file, and inline each as a `data:` URL. That's a parser dependency and a hand-kept list of references, to do what the agent can do itself.
- **Serving `ui/` as files to the frame**, scoped by CSP to the version's own path. The frame's requests carry no token, so the files would have to be served without auth, and they're the owner's data.

### Versions, kept in `/state`

The store gains one row: the latest version's number and document. `publish` saves a document as the next number in one transaction and returns the number. Versions count from 1. Version 0 is the textbox, which isn't stored: the agent serves it while it has published nothing.

The publish is saved before `publish_ui`'s result. If the agent stops between the two, the version stands and the call's result says it was interrupted. That's true either way, and the page still finds the new version (below).

### The page

`GET /page` on the agent serves jen's fixed page, `src/agent/ui/page.html`. It's the same for every agent of an image and holds no agent data. Opened in a browser, the page:

1. Reads the viewer's token from the URL's fragment (`#token=…`), which never reaches a server. It keeps the token in `sessionStorage`, so a reload keeps working, and removes the fragment from the address bar.
2. Fetches `ui` (relative to its own path), `{"version", "document"}`, with the token.
3. Opens `events` with `fetch`, not `EventSource`, because `EventSource` can't send an `Authorization` header. It reads Server-Sent Events from the body. After a drop it reconnects with `Last-Event-ID`, waiting longer after each failure, up to 30 seconds. An event's ID becomes that cursor only once the whole event has arrived, so a drop partway through an event resumes before it.
4. Runs the document in a frame (below) that fills the page. It passes the frame nothing from the stream.
5. Fetches `ui` again when an item is a `tool_result` for a `publish_ui` call, matched by the call's ID. If the version is new, it swaps the frame for the new one.
   - Old publishes in the stream each fetch `ui` too, but at most one fetch is in flight, and an unchanged version changes nothing.
   - A failed fetch is tried again, waiting longer after each failure, up to 30 seconds. The publish that called for it won't come again, because a reconnect resumes after it.
6. Posts each ask the frame hands it (below) to `messages`, as the viewer.

The stream is how an open page learns of a new version, so no new event type is added.

The page draws nothing of its own except a thin bar for failures: no token, `401`, a refused ask, a dropped connection, or an error event from the agent, such as a failed model call. The bar shows the agent's errors because nothing else on the page would.

The page's own response carries `Content-Security-Policy: default-src 'none'; script-src 'unsafe-inline' data:; style-src 'unsafe-inline' data:; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'self'; frame-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`.
- `frame-ancestors 'none'` stops another site framing the page to steer clicks.
- `frame-src 'none'` refuses a navigation of the frame away from its document, in a browser that lets a sandboxed frame navigate itself. Chromium 156 refused it from the sandbox alone, even with no policy on the page (below), so the directive's own effect is unmeasured.
- A srcdoc frame inherits the page's policy, so the page's policy allows whatever the frame needs except network access.

### The frame

The frame is `<iframe sandbox="allow-scripts">`. The page builds its `srcdoc` as:

```
<!doctype html>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' data:; style-src 'unsafe-inline' data:; img-src data: blob:; font-src data:; media-src data: blob:; form-action 'none'; base-uri 'none'">
<script>/* the bridge */</script>
<!-- the published document, as it is -->
```

- **No `allow-same-origin`**, so the frame has an opaque origin. It can't read the page's DOM, `sessionStorage` or cookies, and so never sees the token.
- **The frame's own CSP** has no `connect-src`, so `default-src 'none'` blocks every fetch, XHR, WebSocket, beacon and prefetch. The policy comes first, so it applies before any of the model's code runs. Later policies can only tighten it, and removing the element leaves it in force.
- **The page's `<!doctype html>` comes first**, so the document renders in standards mode even if the agent left the doctype out. The document's own doctype then counts as a parse error and is ignored. Its `<html>` and `<head>` merge with the ones the parser opened.
- **No `allow-forms`, `allow-popups` or `allow-top-navigation`.**

Measured on 2026-11-13 in Chromium 156, the desktop app's built-in browser, with a probe server logging every request it got. A frame built as above:
- ran inline scripts, classic and module scripts from `data:` URLs, a `data:` stylesheet and a `data:` image
- got a `SecurityError` reading `parent.document`, `document.cookie` and `localStorage`, and its origin was `null`
- sent nothing to the server from any of these:
  - `fetch`, to the same host and to an external one
  - an image, CSS `@import` and `url()`, and `<link rel=prefetch>`
  - `sendBeacon`, a WebSocket, a form `submit()` and `window.open`
  - a click on a `target=_top` link, and setting `location.href`. These two sent nothing even with no policy on the page, while an unsandboxed frame's navigation reached the server.

One exit got through: WebRTC (see Risks).

### The bridge and its one request

The bridge is jen's script, run in the frame before the document. It's the frame's only door. It hands requests out to the page, which knows the viewer and decides what each one may do. It defines `window.jen`:
- `jen.version`: the version this frame shows.
- `jen.ask(context)`: asks the agent something. `context` is any JSON value the app's code chose, such as a phrase or what the user typed. It's all the ask carries.

The bridge's other requests come later, as further members of `jen`, each checked by the page the same way. The bridge stays a small fixed set, and the apps built on it are generated.

The page sends an ask as a message whose text is:

```
Asked from your UI, version 3:
{"choice":"approve","note":"Looks good"}
```

It's an ordinary message from the viewer. The runtime stamps the sender from the token, so it's `owner`, the root's parent. It reaches the agent like any message from the user, wakes it, and is owed a reply. The text format is provisional. Once the data layer exists, a request from an app becomes a typed event in the protocol (see `record/ideas.md`).

The page accepts an ask only:
- **if it came from the current frame.** `event.source` must be the frame's window, and the version must be the one showing. An ask from a frame being swapped out is dropped.
- **if a person just acted in the frame.** The page reads `navigator.userActivation.isActive` when the ask arrives. Activation in a frame activates its ancestors, so the page sees a click made in the frame.
  - Measured on 2026-11-13 in the same browser: an ask posted on load read `false`, one posted from a click `true`, and one posted 7 seconds after the click `false`.
  - A dropped ask shows in the page's bar. A UI that calls `jen.ask` on load or on a timer sends nothing.
  - User activation is how the web shell vouches that a person acted. A host on another surface would vouch its own way, such as by a remote's button press.
- **if it fits.** A message over 1 MiB, the protocol's bound, is refused in the bar.

*Why `ask`:* asking the agent is one of the bridge's requests (decisions.md, 2026-11-14). The first implementation called it `jen.act`, after 2026-11-10's "interfaces are dumb", where every interaction was an action for the agent. Under 2026-11-14 most interactions are the app's own.

*Why only the context:* an earlier version also collected the page's `input`, `select` and `textarea` values. That puts the browser's form controls into the message the agent reads, and an app on another surface has none. The app knows what it means to send.

*Alternatives:*
- **Controls marked with an attribute**, such as `data-jen-action`, that send without script. It's a second way to do what `jen.ask` does, and models write `onclick` as readily.
- **A rate limit on asks.** It allows automatic messages up to the limit. Requiring activation allows none.
- **Posting asks to a route of their own** for the agent to format. Asks stay ordinary messages through `/messages`, so an application could send one too.

### The textbox, version 0

The image ships `src/agent/ui/textbox.html`, one self-contained document with a box to type in and a send button, and nothing else. Sending calls `jen.ask(text)`, the same call any UI makes. So the textbox runs the whole path: frame, bridge, page and message. After a send, the box clears and says the message was sent. It shows nothing of the conversation.

The page must show something before a first publish, and the textbox also gives the owner a way to ask a new root something from its page. It stands in for stock jen's first screen, which comes with the shell (see `record/ideas.md`).

*Alternative:* **the agent writing its first UI itself.** An agent runs a turn only when a message arrives. Writing a first UI would need one of three things, each with a cost:
- a turn on first start
- a model call for every root, including those only an application reaches
- a message sent when the page opens, which the user didn't make

Either way the user waits, and a broken first UI leaves no way in. The shipped textbox opens at once and always works.

### What the agent is told

No agent's instructions mention a UI. `publish_ui` takes no input, and its description holds the contract:
- `ui/index.html` is the entry, and it must stand alone: scripts and styles inline, images and fonts as `data:` URLs
- `fetch`, references to other files and links to other pages don't work
- `jen.version`, and `jen.ask(context)`, whose context must hold everything the agent will need, since nothing else on the page is sent
- `jen.ask` works only from click or keydown handlers, and forms never submit
- the owner's page shows the latest published version, starting with jen's textbox as version 0, and doesn't show the agent's text replies
- the 4 MiB bound

That's what the tool does and what the page shows, and nothing about what to do with it. The agent decides how to answer an ask, whether to publish, and what a UI holds.

*Why the description and not the instructions:* only an agent offered the tool reads it, and it says what the tool does.

*Why no note on each ask:* an ask carries only its version and its context. The earlier note on each action told the agent to answer by publishing, which this change leaves out (above).

*Why the page's facts are stated:* without them an agent would expect its replies to show. What the agent does about it is its own call.

These texts are behavior, so the behavior check runs again (see Checks).

### The routes

On the agent, both behind its bearer token like every route:
- `GET /page`: the fixed page, `text/html`, with the CSP above and `Cache-Control: no-store`.
- `GET /ui`: `{"version": <n>, "document": "<html>"}` as `application/json`, the latest version or the textbox. JSON keeps any route from rendering the document at the runtime's origin.

On the runtime:
- **`GET /agents/:id/page` is relayed without a credential**, only to a running root agent with `workspace`.
  - Anything else gets one `404`, `no UI for agent <id>`: a stopped agent, a sub-agent, a root without `workspace` or an unknown ID.
  - It's the one route without a token, because a browser opening a URL can't send a header. It serves jen's fixed code, the same for every agent of an image.
  - The cost: anyone who can reach the runtime's port can learn whether a 12-hex-digit ID belongs to a running root with `workspace`. The runtime is published only on `127.0.0.1`.
- **`GET /agents/:id/ui` is relayed like `/events`**: the caller must reach the agent, and it must be running. It's refused with `403` unless the agent is a root with `workspace`.
- The page's messages and events use the existing `/messages` and `/events` routes, unchanged.

The owner opens a root's UI at `http://127.0.0.1:8080/agents/<id>/page#token=<owner token>`.

*Alternatives:*
- **The token in the query string.** It reaches the server, its logs and every relay. A fragment stays in the browser.
- **A cookie set by the runtime.** That's a login, which is JEN-4's.
- **The runtime serving the page from its own image.** The page and its bridge belong to the agent's version, and the runtime has no UI role (decisions.md, 2026-11-10).
- **Starting a stopped root for the page.** An unauthenticated request would then start agents. The owner starts it, or messages it, which starts it.

## Checks

- **Unit tests:**
  - `publish_ui` against a fake `RuntimeClient`: a file saved byte for byte, and each refusal
  - the store's versions
  - the routes and their refusals, on the agent and on the runtime
  - the tool offered only to a root with `workspace`
  - the description's contract, and instructions that never mention a UI
- **The sandbox check**, `src/agent/sandbox.live.test.ts`, needs no model or Docker. It serves an agent's routes in-process with a stored hostile document and opens the page in headless Chromium through Playwright. It asserts that:
  - nothing reaches a probe server
  - the token can't be read from the frame
  - an ask on load, on a timer, or naming another version is dropped
  - a click's ask reaches the inbox in the given format

  Like the boundary check, CI runs it on every push, in a `sandbox` job that installs Chromium. It skips WebRTC (see Risks).
- **The UI check**, `src/runtime/ui.live.test.ts`, runs the whole path on `openai/gpt-6-sol` through the live credentials, with Docker:
  1. It spawns a root with `workspace` and opens its page in Playwright, which shows the textbox.
  2. It types a task in the textbox, asking for a UI with a "Ping" button that asks the agent with the context `"ping"`.
  3. Once a version above 0 shows in the frame, it clicks the button.
  4. It passes when the agent's conversation holds a message from the owner asking from that version, with `ping` in its context.

  This checks every piece of the path: the textbox's ask, a publish, the live swap, and an ask from the agent's own UI. It doesn't check what the agent does with the ask.

  Run on 2026-11-14, it passed 3 runs of 3, each in about 11 seconds. Each time, Sol wrote one self-contained page whose button called `jen.ask('ping')`, published it as version 1, and replied in text that the UI was ready. The page doesn't show that reply.

  Earlier, before the cut on 2026-11-14, the check went further: it asked for a number and passed when the agent republished one. Its runs on Sol from 2026-11-13 found one fault that shaped the description. Sol wrote its message box as a `<form>` with a submit handler, and in a frame without `allow-forms`, Chromium 158 fires no submit event, from a click or from Enter (measured). The user's way to type was dead. The description has since said that forms never submit and to call `jen.ask` from click or keydown handlers, and Sol's later UIs used them.
- **The behavior check** runs again on `openai/gpt-6-luna`, since the roots in its command and file tasks now see `publish_ui`. A run that calls `publish_ui` is a fault, since none of its tasks asks for a UI. It's held to the bar set on 2026-11-11.

  Run on 2026-11-13 and 2026-11-14, no run called `publish_ui`. But with the tool offered, the files task cut `release.md` short at its `EOF` line in 11 of 45 runs, by writing it with a shell heredoc instead of `write_file`. Without the tool, on `main` and on this branch with the tool removed, it did so in 0 of 24. The UI guidance's wording and where it sat made no clear difference: in every root's instructions, on each action, or in a one-line description.

  Run again on 2026-11-14 after the cut, three passes had no `publish_ui` call. The files task failed 1 of 9 runs: Luna first wrote `release.md` with a heredoc, then rewrote it with `write_file` and dropped the `EOF` line itself. The command task passed 9 of 9. The delegation tasks failed 5 of 45 runs, on the known flakes: one `list_agents` call, and messages to a made-up receiver. See Risks.

*Why Playwright:* it drives a real Chromium, in CI and in the frame, with trusted clicks that give user activation. It's a dev dependency only. *Alternative:* driving Chrome over the DevTools protocol by hand with Node's WebSocket. That still needs a browser binary, and rebuilds what Playwright gives.

## Risks / Trade-offs

- **Offering `publish_ui` makes Luna write files worse.** Luna never calls the tool on tasks that don't ask for a UI. Even so, with it in the tool list, Luna gets the behavior check's `release.md` wrong in 12 of 54 runs, against 0 of 24 without it, mostly by writing it with a heredoc instead of `write_file` (see Checks). It's accepted as known, as the maintainer decided on 2026-11-14. *Rejected:* offering the tool only once the agent's page has been opened. The tools would change partway through a conversation, and an agent couldn't build an app before anyone opens its page, though agents build without being asked.
- **WebRTC leaves the frame.** Measured on 2026-11-13: an `RTCPeerConnection` in the frame sent STUN packets over UDP to a host it named, even with `webrtc 'block'` in the frame's policy or the page's. Chromium 156 doesn't enforce that directive, so a UI can send data out over UDP.
  - Today that adds nothing. The agent that wrote the UI reaches the internet itself. The frame holds only what the agent published and what the user types into it, which reaches the agent anyway.
  - Once [JEN-21](https://linear.app/reveer/issue/JEN-21) cuts the agent off, the frame becomes the one way out, so JEN-21 must close it or record why not.
  - Deleting `RTCPeerConnection` in the bridge doesn't close it, because a nested `about:blank` frame has a fresh one.
- **The page shows nothing new until the agent publishes.** It doesn't show the agent's replies, and until the data layer exists, a new version is the only thing the agent can change there. The description says so. What the agent does about it is its own call.
- **The owner's token is in the URL they open**, so it can land in browser history before the page removes it. It's local, it's the owner's own browser, and JEN-4 replaces it.
- **A UI that breaks at runtime is invisible to the agent.** A reference to another file, a `fetch` or a plain bug shows only in the browser's console, and the user tells the agent. Reporting errors automatically would send messages the user didn't make.
- **Swapping versions loses what the user typed** in the old frame.
- **Activation lasts a few seconds**, so a click's handler can send several asks, or one on a short timer. It can't send any without the user.
- **Only Chromium is checked, and Safari drops asks.** No check runs on Safari or Firefox. On 2026-11-14 the maintainer tried a root's UI in Safari: a click on a button whose handler called `jen.ask` at once showed "The UI asked the agent without a click or key press", and nothing reached the agent. The same document's click and Enter asks got through in headless Chromium. A probe the same day, with jen's sandbox and frame policy and no agent, in Safari 27.0.1: Enter counted as activation in every frame, 3 of 3. Clicks failed in 5 of 8, and in each failure the frame's own click handler read no activation either, including in a control frame with `allow-same-origin`. So it isn't the opaque origin, the frame swap or passing activation up to the page. The other 3 clicks, one of them on a button on the page itself, counted at every step from `pointerdown`. What makes a click fail is unmeasured. Two of the failures came right after typing in the frame. [JEN-22](https://linear.app/reveer/issue/JEN-22) fixes it, as the maintainer decided on 2026-11-14.
