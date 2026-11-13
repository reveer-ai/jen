## ADDED Requirements

### Requirement: A root with workspace publishes its UI
The agent SHALL offer `publish_ui`, taking no input, only when it is a root (its parent is `owner`) and its grant has `workspace`. The tool SHALL read `ui/index.html` in the agent's workspace and every file it references, bundle them into one HTML document, and save it as the agent's next UI version. Its result SHALL name the new version, the document's size and the files inlined.

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
- **WHEN** a root that has published nothing calls `publish_ui` on a valid `ui/`
- **THEN** the UI becomes version 1, and the result says so

### Requirement: Publishing inlines every referenced file
`publish_ui` SHALL parse HTML as a browser does, and SHALL replace each reference to a file in `ui/` with a `data:` URL of that file, typed by its extension. It SHALL follow every attribute that loads a file (`src`, `srcset`, `poster`, and `href` on `link` and SVG `image` and `use`), and `url()` and `@import` in stylesheets, `<style>` elements and `style` attributes. A stylesheet's own references SHALL be inlined before it is. Scripts SHALL be inlined without being read.

#### Scenario: Script, stylesheet and image
- **WHEN** `ui/index.html` references `app.js`, `style.css` and `img/logo.png`, and `style.css` holds `url(fonts/a.woff2)`
- **THEN** the published document references each as a `data:` URL, and the stylesheet's `data:` URL holds the font as a `data:` URL

#### Scenario: A reference in a script's text
- **WHEN** a script in `ui/index.html` holds the text `src="missing.png"` in a string
- **THEN** it isn't read as a reference

### Requirement: References resolve within ui/
A reference SHALL resolve against the file that holds it, and one starting with `/` against `ui/`. A query string SHALL be dropped and a fragment kept. `data:` and `blob:` URLs, fragment-only references and `<a href>` SHALL be left as they are.

#### Scenario: A root-relative reference from a nested stylesheet
- **WHEN** `ui/css/main.css` holds `url(/img/bg.png?v=2#x)`
- **THEN** `ui/img/bg.png` is inlined, with the fragment `#x`

#### Scenario: A link to another page
- **WHEN** `ui/index.html` holds `<a href="about.html">`
- **THEN** the link is left as it is, and `about.html` isn't read

### Requirement: A publish is all or nothing
`publish_ui` SHALL refuse, saving nothing and leaving the version unchanged, when `ui/index.html` is missing, when a reference has a scheme or starts with `//`, leaves `ui/` or names a file that doesn't exist, when a stylesheet isn't UTF-8, when stylesheets import each other in a cycle, or when the document would be over 4 MiB. Its error SHALL list every problem found, and for the size bound SHALL name the largest files.

#### Scenario: A CDN script and a missing image
- **WHEN** `ui/index.html` references `https://cdn.example.com/lib.js` and `missing.png`
- **THEN** the call fails naming both, and the latest version is unchanged

#### Scenario: Too large
- **WHEN** the bundled document would be over 4 MiB
- **THEN** the call fails naming the largest files

### Requirement: Every agent starts with a textbox
An agent that has published nothing SHALL serve the textbox shipped in its image as version 0. The textbox SHALL show the conversation's messages and errors and send what the user types through `jen.act`, as any UI does.

#### Scenario: A new root
- **WHEN** the owner opens a new root agent's page
- **THEN** it shows the textbox, version 0

### Requirement: The page connects as the viewer
`GET /page` SHALL serve jen's fixed page. It SHALL read the viewer's token from the URL's fragment, keep it in `sessionStorage` and remove the fragment. It SHALL load the latest UI from `ui` and stream `events` with the token, reconnecting after a drop with `Last-Event-ID`. It SHALL draw nothing but the UI's frame and a bar for its own failures.

#### Scenario: Opened with a token
- **WHEN** the owner opens a root's page with `#token=<owner token>`
- **THEN** the address bar no longer holds the token, and the page shows the latest UI

#### Scenario: Opened without a token
- **WHEN** the page is opened with no token in its fragment or `sessionStorage`
- **THEN** its bar says it needs one, and it requests nothing else

### Requirement: The page runs the UI in a sandboxed frame
The page SHALL run the UI in an `<iframe sandbox="allow-scripts">` whose document starts with `<!doctype html>`, a Content Security Policy that allows no network access, and the bridge, followed by the published document. The page's own policy SHALL include `frame-src 'none'` and `frame-ancestors 'none'`.

#### Scenario: The frame can't reach the network
- **WHEN** a published UI calls `fetch`, loads an image from a server, opens a WebSocket, submits a form, opens a window or sets `location.href`
- **THEN** no request reaches any server

#### Scenario: The frame can't read the token
- **WHEN** a published UI reads `parent.document`, `sessionStorage` or `document.cookie`
- **THEN** each read throws

### Requirement: The page swaps in a new version when one is published
When the stream carries the result of a `publish_ui` call, the page SHALL fetch `ui`, and if its version differs from the one showing, SHALL replace the frame with one running the new version and replay the conversation into it. It SHALL have at most one fetch of `ui` in flight.

#### Scenario: The agent publishes while the page is open
- **WHEN** the agent publishes version 2 while the page shows version 1
- **THEN** the page shows version 2, with the conversation passed in

### Requirement: The bridge gives a UI the conversation
The frame SHALL have `window.jen` with `version` and `subscribe(fn)`, which calls `fn` with every item so far and each new one. Items SHALL be as `/events` sends them, plus `{"type": "error", "message"}` for each error event. A user message that is an action SHALL carry `action: {version, context, inputs}`.

#### Scenario: Subscribing after items arrived
- **WHEN** a UI calls `jen.subscribe(fn)` after the page passed in three items
- **THEN** `fn` is called with those three, in order, and then with each later one

### Requirement: The bridge hands the page actions with the UI's inputs
`jen.act(context)` SHALL hand the page `context`, any JSON value, with `inputs`: the value of every `input`, `select` and `textarea` that has a `name` or `id`, keyed by it. Checkboxes that share a name SHALL give the array of their checked values.

#### Scenario: Inputs with an action
- **WHEN** a UI with a text input named `note` holding "Looks good" and a checked checkbox `urgent` calls `jen.act("approve")` from a click
- **THEN** the page receives context `"approve"` and inputs `{"note": "Looks good", "urgent": true}`

#### Scenario: A group of checkboxes
- **WHEN** three checkboxes named `t` with values `a`, `b` and `c` have `a` and `b` checked, and the UI calls `jen.act("pick")` from a click
- **THEN** the page receives inputs `{"t": ["a", "b"]}`

### Requirement: An action becomes a message only when the user made it
The page SHALL post an action to `messages`, as the viewer, with the text `UI action on version <n>:`, a newline, and `{"context": …, "inputs": …}` as JSON. It SHALL drop an action that doesn't come from the current frame or names another version, one that arrives when `navigator.userActivation.isActive` is false, and one whose message would be over 1 MiB, showing each refusal in its bar.

#### Scenario: A click
- **WHEN** the user clicks a button whose handler calls `jen.act({"choice": "b"})` in version 3
- **THEN** the agent receives a message from `owner` whose text starts `UI action on version 3:`

#### Scenario: An action on load
- **WHEN** a UI calls `jen.act("loaded")` as it loads, with no user input
- **THEN** no message is sent

### Requirement: A root with workspace is told about its UI
The instructions of a root agent whose grant has `workspace` SHALL also say:
- that the user sees it through a page showing its UI, a plain textbox until it publishes one
- to write a UI in `ui/` and publish it with `publish_ui` when the task would be easier for the user with one, and not when a reply is enough
- that a message starting "UI action on version" is the user acting on its UI

#### Scenario: A sub-agent's instructions
- **WHEN** a sub-agent with `workspace` calls the model
- **THEN** its instructions don't mention `publish_ui` or a UI

### Requirement: The whole path works live
With Docker running and model credentials configured, a UI live check SHALL start its own runtime on `openai/gpt-6-sol`, spawn a root with `workspace`, open its page in a headless browser, ask in the textbox for a UI with a button that asks the agent for a number and shows the latest one, click the button once a version above 0 shows, and pass when the frame shows the agent's new number. Without credentials or Docker it SHALL behave as the existing live checks do.

#### Scenario: Click and update
- **WHEN** the check clicks the button in the published UI
- **THEN** the frame shows a number the agent sent after the click

### Requirement: The sandbox is checked on every push
A sandbox check SHALL run in CI on every push with no model and no Docker. It SHALL serve an agent's routes with a stored document that tries every network path above and reads the page's state, open the page in headless Chromium, and fail if any request reaches its probe server, if the frame reads the token, if an action sent on load reaches the inbox, or if a click's action doesn't.

#### Scenario: A hostile document
- **WHEN** the sandbox check runs
- **THEN** its probe server receives nothing, and the inbox holds only the clicked action
