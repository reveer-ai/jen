## ADDED Requirements

### Requirement: A run reaches a model under exactly one of two credentials

A run SHALL reach a model through either of two credentials — an API key, or a subscription token — each supplied to the runner as an environment variable under its own name. A run SHALL hold exactly one of them.

Both forms SHALL be accepted on equal terms. Neither SHALL be the default and neither SHALL be the fallback: they differ in what they cost the adopter rather than in what they enable, and the choice is the adopter's to make knowingly.

Where neither credential is set, the run SHALL fail before starting a session and SHALL name both accepted credentials. Naming only one would direct an operator toward the form they had chosen not to use, and this is the same refusal the run already makes for every other credential it reads: before a session starts, naming what is absent, rather than partway through work that cannot be completed.

Where both credentials are set, the run SHALL fail before starting a session, and SHALL NOT resolve the ambiguity by precedence. Which credential a run spends is not a detail a pipeline may settle on an operator's behalf: one form bills a key and the other consumes a usage window shared with the adopter's own work, so choosing silently is wrong in both directions and is wrong invisibly. The refusal SHALL state that exactly one is to be held, because — unlike an absent credential — the name alone does not say what to do about it.

A credential set to an empty value SHALL be treated as not set, under either name. A secret that a hosted runner was never given expands to an empty value rather than being absent, so a managed workflow can pass both names through unconditionally and an adopter who supplied one is not told they supplied two.

The session SHALL be given the credential the run holds, under that credential's own name. The name the run does not hold SHALL NOT be present in the session's environment, whether or not the runner's own environment carried it — a session that could see both would leave the choice to be made downstream, which is the ambiguity the refusal above exists to prevent.

#### Scenario: A run holds a subscription token

- **WHEN** a session is started for a run whose environment supplies a subscription token
- **THEN** the session receives it under the subscription token's own name
- **AND** the API key's name is absent from the session's environment

#### Scenario: A run holds an API key

- **WHEN** a session is started for a run whose environment supplies an API key
- **THEN** the session receives it under the API key's own name
- **AND** the subscription token's name is absent from the session's environment

#### Scenario: Neither credential is set

- **WHEN** a run is to be started with no model credential in its environment
- **THEN** no session is started
- **AND** both accepted credentials are named

#### Scenario: Both credentials are set

- **WHEN** a run is to be started with both model credentials in its environment
- **THEN** no session is started
- **AND** neither is chosen over the other
- **AND** the refusal states that the run is to hold exactly one

#### Scenario: A credential is present but empty

- **WHEN** a run's environment carries one model credential and the other as an empty value
- **THEN** the empty one is treated as not set
- **AND** the run holds the one that carries a value
