# Tasks

A bug fix, so there's no design. The mechanism is here, and the measurements behind it are in the proposal and on [JEN-22](https://linear.app/reveer/issue/JEN-22).

## 1. The bridge keeps focus

- [ ] 1.1 In `bridge()` in `src/agent/ui/page.html`, add a capture-phase `mousedown` listener on the frame's window. When `document.activeElement` is a text field and the event's target isn't inside one of the targets below, it calls `preventDefault()`.
  - A text field is an `<input>` of type `text`, `search`, `email`, `url`, `tel`, `password` or `number`, the types WebKit ends editing for.
  - The targets that keep their focus change are a text field, a `<textarea>`, a `<select>` and editable text (`isContentEditable`).

  The bridge runs before the published document, so its listener runs first. A UI can't remove it, because it holds no reference to the listener. Cancelling `mousedown` keeps focus where it is and leaves `click` firing in Chromium and WebKit. Update the bridge's comment and the page's header comment to say why, citing Safari's dropped activation. Verify in the sandbox check (2.1).

## 2. The sandbox check on both browsers

- [ ] 2.1 In `src/agent/sandbox.live.test.ts`:
  - Run every test in Playwright's Chromium and WebKit, with what's recorded (`probed`, `served`, the inbox) checked per browser.
  - Give the hostile document an input, a button whose handler records whether the input still has focus and calls `jen.ask` with the input's value, and a textarea.
  - After the existing asks, type in the input and click the button. Pass when the button's handler saw the input focused and the ask reached the inbox.
  - Then type in the input and click the textarea, and pass when the textarea has focus.
  - Adjust the count of `POST /messages` to the asks the test now makes.

  Check how Playwright's WebKit treats evaluating in a frame. If it activates the page as Chromium does, keep reading neither frame until the asks sent on load have been dropped.
- [ ] 2.2 In `.github/workflows/ci.yml`, have the `sandbox` job install WebKit with Chromium (`npx playwright install --with-deps chromium webkit`).

## 3. Record and docs

- [ ] 3.1 In `record/environment.md`, update the sandbox check's note:
  - it runs on both browsers and needs `npx playwright install chromium webkit`
  - it checks that focus stays in a text field through a click
  - Playwright's WebKit can't reproduce Safari's dropped activation, so a change to the bridge's focus handling or to the activation check needs a hand check in Safari
- [ ] 3.2 Add a dated entry to `record/decisions.md`: the activation check stays, and the bridge keeps focus in a text field so Safari counts the click. *Why:* set by the maintainer on 2026-11-15. Without the check, a UI could message the agent as the owner with no one acting, for example in a loop on load, and nothing caps an agent's spend yet. The confirm bar was rejected because most forms in Safari would have taken two presses.
- [ ] 3.3 Check whether `docs/architecture.html` describes the bridge closely enough to need this. If it does, update it.

## 4. Verification

- [ ] 4.1 `npm run check` and `npm test` pass, and the sandbox check passes in both browsers.
- [ ] 4.2 The UI live check (`src/runtime/ui.live.test.ts`) passes on Sol, since the bridge now changes how every published UI handles a press.
- [ ] 4.3 The maintainer opens a root's UI in Safari, types in an input and clicks its button, and the ask reaches the agent. This is the only check of Safari itself. If it's still dropped, the fix is wrong, whatever the automated checks say.
