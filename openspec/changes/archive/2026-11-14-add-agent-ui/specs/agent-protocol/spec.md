## ADDED Requirements

### Requirement: The agent serves its page and its UI
`GET /page` SHALL answer `200` with jen's fixed page as `text/html`, with its Content Security Policy and `Cache-Control: no-store`. `GET /ui` SHALL answer `200` with `{"version": <n>, "document": "<html>"}` as `application/json`: the latest published version, or version 0, the textbox, when none has been published. Both SHALL require the agent's token, as every route does.

#### Scenario: Before any publish
- **WHEN** a client requests `/ui` from an agent that has published nothing
- **THEN** it gets version 0 and the textbox's document

#### Scenario: After a publish
- **WHEN** a client requests `/ui` after the agent published version 2
- **THEN** it gets version 2 and its document
