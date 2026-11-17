## MODIFIED Requirements

### Requirement: The page runs the UI in a sandboxed frame
The page SHALL run the UI in an `<iframe sandbox="allow-scripts">`. The frame's document SHALL start with `<!doctype html>`, then a Content Security Policy that allows no network access, then the bridge, followed by the published document. The page's own policy SHALL include `frame-src 'none'` and `frame-ancestors 'none'`. WebRTC is the known exception: an `RTCPeerConnection` in the frame, or in a `srcdoc` frame nested in it, sends to any host it names in Chromium and WebKit, and no policy or sandbox flag the page can set stops it.

#### Scenario: The frame can't reach the network
- **WHEN** a published UI calls `fetch`, loads an image from a server, opens a WebSocket, submits a form, opens a window or sets `location.href`
- **THEN** no request reaches any server

#### Scenario: The frame can't read the token
- **WHEN** a published UI reads `parent.document`, `sessionStorage` or `document.cookie`
- **THEN** each read throws
