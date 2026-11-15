# Proposal

## Why

In Safari, the most common form in an agent's UI doesn't reach the agent. You type in an input, click its button, and the page drops the ask with "The UI asked the agent without a click or key press". The page sends an ask only when `navigator.userActivation.isActive` says a person just acted, and Safari loses that activation partway through the click. [JEN-22](https://linear.app/reveer/issue/JEN-22) measured why on 2026-11-15, in Safari 27.0.1 with jen's sandbox and frame policy (the issue's comments hold the runs):

- **Only a press that takes focus out of an `<input>` you typed in loses its activation.** The activation is there at `pointerdown` and `mousedown`, and gone by `pointerup` about 100 ms later. That happened 5 of 5 times, in the frame and on the page, 0.7 s and 10 s after typing, with or without `autocomplete="off"`.
- **Every other kind of press counts.** A `<textarea>`, a `contenteditable` and Enter in an input all work, and so does a press with no edited input to leave.
- **The trigger is the input ending its editing.** When a text `<input>` loses focus, WebKit hands it to the app's form client (`Editor::textFieldDidEndEditing`), which is Safari's own code. Textareas don't take that path. Playwright's WebKit has no Safari behind that hook, and doesn't reproduce the bug.
- **When the press doesn't move focus out of the input, the click keeps its activation.** A frame that cancelled `mousedown`'s default on the button kept focus in the input, and the ask got through, 1 of 1.

The activation check stays. It's what stops a UI the model wrote from messaging the agent as the owner on its own, for example on load or on a timer. That would let an agent's UI drive the agent in a loop with no one watching, and nothing yet caps an agent's spend (the 2026-11-15 discussion on JEN-22).

## What Changes

- **A press doesn't take focus out of a text field.** When an `<input>` that takes typed text has focus, the bridge cancels the default of a `mousedown` on anything that isn't a text field, textarea, select or editable text. So clicking a button, a checkbox, a link or a plain element leaves focus in the field, and the click keeps its activation in Safari. Clicking another text field, a textarea, a select or editable text moves focus as it does today. The bridge does it in every browser, so a UI behaves the same everywhere.
- **What a UI sees changes in two small ways.** A field that keeps focus doesn't fire `change` or `blur` before the click's handler runs, so a handler reads the field's value directly, as most do. A drag that starts outside a field while one has focus doesn't select text.
- **The page's check doesn't change.** It still reads activation itself when an ask arrives, and trusts nothing the frame says.
- **The sandbox check runs on Playwright's WebKit as well as Chromium.** In both, it types in an input and clicks a button, and fails unless the input kept focus and the ask reached the inbox. It can't reproduce Safari's bug, so a person checks Safari by hand before the change merges.

*Alternative: a confirm bar.* The page held an ask that arrived without activation in its own bar, focused the bar's Send button, and sent the ask on a press there. It worked in Safari, 2 of 2, but most forms in Safari would have taken two presses, and a UI could make the bar appear with no input at all. Keeping focus in the field makes the one press count.

*Alternative: dropping the activation check.* The plain form would work with nothing added, but any UI could message the agent without a person acting, as above.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `agent-ui`: the bridge keeps focus in a text field during a press, and the sandbox check covers it on Chromium and WebKit.

## Impact

- **Agent code:** the bridge in `src/agent/ui/page.html`. No tool description or instruction changes, so the behavior check doesn't need to run again.
- **Checks and CI:** `src/agent/sandbox.live.test.ts` runs on both browsers, and the `sandbox` job in `.github/workflows/ci.yml` installs WebKit too.
- **Record:** the archived `add-agent-ui` design left Safari's cause unmeasured. The measured cause, and that Playwright's WebKit can't reproduce it, go in `record/environment.md`'s note on the sandbox check.
- **Docs:** `docs/architecture.html` if its description of the bridge covers this.
