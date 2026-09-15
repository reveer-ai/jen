## ADDED Requirements

### Requirement: A process's standard input stays open for the life of the process

A process started in a sandbox SHALL be able to receive input for as long as it runs, and its caller SHALL be able to send to it more than once. Standard input SHALL NOT be closed as a consequence of the caller having sent what it had at the moment the process started.

The substrate's only real caller attaches a conversation to a long-running process, and a conversation requires both parties to be able to speak more than once. An input closed after the first thing said permits a caller to deliver a starting instruction and nothing else, which is sufficient only while there is nothing to answer.

This preserves everything the sandbox's credential delivery already establishes rather than relaxing any of it. Credentials SHALL still be delivered to the process on its standard input as it starts; they SHALL still precede anything else sent on that input, and SHALL still arrive ahead of it without the possibility of interleaving; and they SHALL still reach neither a command line nor any file. What changes is only that the input does not end where the credentials and the caller's first message end.

A caller SHALL be able to end the input when it has nothing further to send, and a process SHALL observe that ending as it would observe any input ending.

A failure to send to a process SHALL be reported to the caller. It SHALL NOT be reported as a success, and it SHALL NOT end the process that is doing the sending — the sending process is the supervisor, and one agent's broken channel must not take every other agent's run with it.

#### Scenario: A caller sends to a process more than once

- **WHEN** a process is started in a sandbox and its caller sends to it, and later sends again
- **THEN** the process receives both, in the order they were sent

#### Scenario: Credentials still arrive first and intact

- **WHEN** a process is started with credentials and the caller then sends to it
- **THEN** the process receives its credentials before anything the caller sent
- **AND** nothing the caller sent is interleaved with them

#### Scenario: Credentials still reach neither a command line nor a file

- **WHEN** a process is started with credentials in a sandbox whose input stays open
- **THEN** no command line assembled to start it contains a secret
- **AND** no file written to start it contains one

#### Scenario: A caller with nothing further ends the input

- **WHEN** a caller ends a process's input
- **THEN** the process observes the input as ended

#### Scenario: A send to a process that cannot receive is reported

- **WHEN** a caller sends to a process whose input can no longer be received
- **THEN** the failure is reported to the caller
- **AND** the caller's own process is not ended by it

#### Scenario: A long-running process converses while it runs

- **WHEN** a process that stays running is sent something, replies on its output, and is sent something further
- **THEN** it receives the second message
- **AND** neither its output nor its ending was required to collect the first reply
