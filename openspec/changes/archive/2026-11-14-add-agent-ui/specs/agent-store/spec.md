## ADDED Requirements

### Requirement: The store keeps the latest UI version
The store SHALL keep the latest published UI document and its version number. Publishing a document SHALL save it as the next version, counting from 1, in one transaction, and return its number. The store SHALL return the latest version and document, or nothing when none has been published, including after it is closed and opened again.

#### Scenario: Two publishes and a reopen
- **WHEN** two documents are published and the store is closed and reopened
- **THEN** the latest is the second document, as version 2
