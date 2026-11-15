## ADDED Requirements

### Requirement: A press keeps focus in a text field
While an `<input>` that takes typed text has focus in the frame, the bridge SHALL cancel the default action of a `mousedown`, so the press leaves focus in the field. It SHALL NOT cancel one on an `<input>` other than a button, checkbox or radio, a textarea, a select, editable text, or a draggable element, which behave as without the bridge. A click's `click` event SHALL still fire, in every browser.

#### Scenario: Type, then click a button
- **WHEN** the user types in an input and clicks a button whose handler calls `jen.ask({"text": "hello"})`
- **THEN** the input still has focus when the handler runs, and the agent receives the ask

#### Scenario: Type, then click a plain element
- **WHEN** the user types in an input and clicks a `<div>` whose click handler calls `jen.ask`
- **THEN** the input still has focus when the handler runs, and the agent receives the ask

#### Scenario: Type, then click another field
- **WHEN** the user types in one input and clicks another input or a textarea
- **THEN** focus moves to the field clicked

#### Scenario: Type, then drag
- **WHEN** the user types in an input, then drags a range slider's thumb or drags a draggable element onto a drop target
- **THEN** the slider's value changes, and the drop happens

#### Scenario: Nothing focused
- **WHEN** no text input has focus and the user clicks a button
- **THEN** the press behaves as it does without the bridge

## MODIFIED Requirements

### Requirement: The sandbox is checked on every push
A sandbox check SHALL run in CI on every push, with no model and no Docker. It SHALL:
- serve an agent's routes with a stored document that tries every network path above and reads the page's state
- open the page in headless Chromium and in headless WebKit, and run every check below in each

It SHALL fail if:
- any request reaches its probe server
- the frame reads the token
- an ask sent on load reaches the inbox
- a click's ask doesn't reach the inbox
- after typing in an input and clicking a button, the input lost focus before the button's handler ran, or the button's ask doesn't reach the inbox
- after typing in an input and clicking a textarea, the textarea doesn't have focus
- with an input focused, a range slider's thumb doesn't drag or a draggable element doesn't drop

#### Scenario: A hostile document
- **WHEN** the sandbox check runs
- **THEN** its probe server receives nothing, and the inbox holds only the clicked asks

#### Scenario: Typing, then a click
- **WHEN** the sandbox check types in the document's input and clicks its button, in either browser
- **THEN** the input kept focus through the click, and the button's ask reaches the inbox
