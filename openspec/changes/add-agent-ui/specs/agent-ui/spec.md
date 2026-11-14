## ADDED Requirements

### Requirement: A root with workspace publishes its UI
The agent SHALL offer `publish_ui`, taking no input, only when it is a root (its parent is `owner`) and its grant has `workspace`. The tool SHALL read `ui/index.html` in the agent's workspace and save its bytes, unchanged, as the agent's next UI version. Its result SHALL name the new version and the document's size.

#### Scenario: A root with workspace
- **WHEN** a root agent whose grant has `workspace` calls the model
- **THEN** the model is offered `publish_ui`

#### Scenario: A sub-agent with workspace
- **WHEN** a sub-agent whose grant has `workspace` calls the model
- **THEN** the model isn't offered `publish_ui`

#### Scenario: A root without workspace
- **WHEN** a root agent whose grant has no `workspace` calls the model
- **THEN** the model isn't offered `publish_ui`

#### Scenario: A first publish
- **WHEN** a root that has published nothing calls `publish_ui` on a valid `ui/index.html`
- **THEN** the UI becomes version 1, and the result says so

### Requirement: Publishing sends ui/index.html as it is
`publish_ui` SHALL publish `ui/index.html` alone, without parsing it, rewriting it or reading any file it references.

#### Scenario: Other files in ui/
- **WHEN** `ui/` holds `index.html`, which references `app.js`, and `app.js`
- **THEN** the published document is `index.html` byte for byte, and `app.js` isn't read

### Requirement: A publish is all or nothing
`publish_ui` SHALL refuse, saving nothing and leaving the version unchanged, when `ui/index.html` is missing, isn't UTF-8, or is over 4 MiB. Its error SHALL say which.

#### Scenario: No entry
- **WHEN** a root calls `publish_ui` with no `ui/index.html` in its workspace
- **THEN** the call fails saying the file is missing, and the latest version is unchanged

#### Scenario: Too large
- **WHEN** `ui/index.html` is over 4 MiB
- **THEN** the call fails giving its size and the bound, and the latest version is unchanged

### Requirement: The description says what the page does
`publish_ui`'s description SHALL say that `ui/index.html` must stand alone once sent, with nothing fetched. It SHALL say what `jen.version` and `jen.ask` do, and that `jen.ask` works only from click or keydown handlers. It SHALL say that the owner's page shows the latest published version, starting with jen's textbox as version 0, and not the agent's text replies.

#### Scenario: The tool's description
- **WHEN** a root agent with `workspace` is offered `publish_ui`
- **THEN** its description says the page shows the latest version and not the agent's text replies

### Requirement: Nothing tells the agent how to answer
Neither `publish_ui`'s description nor an ask SHALL tell the agent how to answer an ask or what a UI must hold. No agent's instructions SHALL mention a UI.

#### Scenario: A root's instructions
- **WHEN** a root agent with `workspace` calls the model
- **THEN** its instructions don't mention `publish_ui` or a UI

### Requirement: Every agent starts with a textbox
An agent that has published nothing SHALL serve the textbox shipped in its image as version 0. The textbox SHALL hold only a box to type in, and SHALL send what the user types through `jen.ask`, as any UI does.

#### Scenario: A new root
- **WHEN** the owner opens a new root agent's page
- **THEN** it shows the textbox, version 0

### Requirement: The page connects as the viewer
`GET /page` SHALL serve jen's fixed page. The page SHALL:
- read the viewer's token from the URL's fragment, keep it in `sessionStorage`, and remove the fragment
- load the latest UI from `ui`, and stream `events` with the token, reconnecting after a drop with `Last-Event-ID`
- pass the frame nothing from the stream
- draw nothing but the UI's frame and a bar for its own failures and the agent's error events

#### Scenario: Opened with a token
- **WHEN** the owner opens a root's page with `#token=<owner token>`
- **THEN** the address bar no longer holds the token, and the page shows the latest UI

#### Scenario: Opened without a token
- **WHEN** the page is opened with no token in its fragment or `sessionStorage`
- **THEN** its bar says it needs one, and it requests nothing else

### Requirement: The page runs the UI in a sandboxed frame
The page SHALL run the UI in an `<iframe sandbox="allow-scripts">`. The frame's document SHALL start with `<!doctype html>`, then a Content Security Policy that allows no network access, then the bridge, followed by the published document. The page's own policy SHALL include `frame-src 'none'` and `frame-ancestors 'none'`.

#### Scenario: The frame can't reach the network
- **WHEN** a published UI calls `fetch`, loads an image from a server, opens a WebSocket, submits a form, opens a window or sets `location.href`
- **THEN** no request reaches any server

#### Scenario: The frame can't read the token
- **WHEN** a published UI reads `parent.document`, `sessionStorage` or `document.cookie`
- **THEN** each read throws

### Requirement: The page swaps in a new version when one is published
When the stream carries the result of a `publish_ui` call, the page SHALL fetch `ui`. If its version differs from the one showing, the page SHALL replace the frame with one running the new version. It SHALL have at most one fetch of `ui` in flight.

#### Scenario: The agent publishes while the page is open
- **WHEN** the agent publishes version 2 while the page shows version 1
- **THEN** the page shows version 2

### Requirement: The bridge is the frame's only way out
The bridge SHALL define `window.jen` with `jen.version`, the version the frame shows, and `jen.ask(context)`, which hands the page `context`, any JSON value, and nothing else from the UI.

#### Scenario: Structured context
- **WHEN** a UI calls `jen.ask({"choice": "approve", "note": "Looks good"})` from a click
- **THEN** the page receives `{"choice": "approve", "note": "Looks good"}`, and no value of the UI's inputs that the context doesn't hold

### Requirement: An ask becomes a message only when the user made it
The page SHALL post an ask to `messages`, as the viewer, with the text `Asked from your UI, version <n>:`, a newline, and the context as JSON. The page SHALL drop each of these, showing the refusal in its bar:
- an ask that doesn't come from the current frame, or that names another version
- an ask that arrives when `navigator.userActivation.isActive` is false
- an ask whose message would be over 1 MiB

#### Scenario: A click
- **WHEN** the user clicks a button whose handler calls `jen.ask({"choice": "b"})` in version 3
- **THEN** the agent receives a message from `owner` whose text is `Asked from your UI, version 3:` and `{"choice":"b"}` on the next line

#### Scenario: An ask on load
- **WHEN** a UI calls `jen.ask("loaded")` as it loads, with no user input
- **THEN** no message is sent

### Requirement: The whole path works live
With Docker running and model credentials configured, a UI live check SHALL:
1. start its own runtime on `openai/gpt-6-sol`, spawn a root with `workspace`, and open its page in a headless browser
2. ask in the textbox for a UI with a button that asks the agent
3. click that button once a version above 0 shows
4. pass when the agent receives a message from the owner asking from that version

Without credentials or Docker, it SHALL behave as the existing live checks do.

#### Scenario: Publish, swap and ask
- **WHEN** the check clicks the button in the UI the agent published
- **THEN** the agent receives a message from `owner` asking from that UI's version, with the button's context

### Requirement: The sandbox is checked on every push
A sandbox check SHALL run in CI on every push, with no model and no Docker. It SHALL:
- serve an agent's routes with a stored document that tries every network path above and reads the page's state
- open the page in headless Chromium

It SHALL fail if:
- any request reaches its probe server
- the frame reads the token
- an ask sent on load reaches the inbox
- a click's ask doesn't reach the inbox

#### Scenario: A hostile document
- **WHEN** the sandbox check runs
- **THEN** its probe server receives nothing, and the inbox holds only the clicked ask
