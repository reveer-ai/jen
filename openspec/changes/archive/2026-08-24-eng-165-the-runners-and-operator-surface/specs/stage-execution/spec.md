## ADDED Requirements

### Requirement: A session's transcript is kept only where the operator asks for it

A run SHALL discard the session's transcript with the rest of the run's working state unless the operator has named a place to keep it. Where one is named, the run SHALL write that session's transcript there and the run's record SHALL name the file.

Keeping one SHALL be the operator's decision rather than jen's default. A transcript is the session's entire stream — the repository's content, every tool result, and whatever the stage read along the way — so a durable copy of it is a disclosure, and jen SHALL NOT make one on an operator's behalf.

Where a transcript is kept, it SHALL be written outside the run's own working directory, which is removed when the run ends. It SHALL NOT be written into the project's checkout, which is discarded, and SHALL NOT be committed or pushed by the run.

A failure to write a transcript SHALL NOT change the session's outcome. It SHALL be reported alongside the run's other failures rather than raised over them, on the same terms as a failed cleanup: the session's own result is what the report exists to carry.

#### Scenario: No location was named

- **WHEN** a run finishes and the operator named no place to keep transcripts
- **THEN** the transcript goes with the run's working state
- **AND** the run's record says no transcript was kept

#### Scenario: A location was named

- **WHEN** a run finishes and the operator named a directory for transcripts
- **THEN** the session's transcript is written there
- **AND** the run's record names the file it was written to

#### Scenario: The transcript outlives the run

- **WHEN** a kept transcript is looked for after the run has ended
- **THEN** it is still there
- **AND** the run's own working directory, with the credentials it held, is gone

#### Scenario: A transcript cannot be written

- **WHEN** the named location cannot be written to
- **THEN** the failure is reported with the run's other failures
- **AND** it does not turn a successful session into a failed one
