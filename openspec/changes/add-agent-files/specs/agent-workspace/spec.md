## ADDED Requirements

### Requirement: An agent reads and writes files in its own workspace through the runtime
`GET /workspace/files?path=<path>` SHALL answer `200` with the file's exact bytes, and `PUT /workspace/files?path=<path>` with the bytes as its body SHALL write them as the file and answer `204`, in the caller's own workspace and no other. Each SHALL act as `agent` in the workspace container, with a relative path relative to `/home/agent` and a symlink followed, so it reaches exactly what a command can, and a write SHALL be refused where a shell redirect would be.

#### Scenario: Bytes round-trip
- **WHEN** an agent with a workspace writes all 256 byte values to `data/bytes.bin` and reads it back
- **THEN** the read returns the same bytes, and a command's `stat` shows the file owned by `agent`

#### Scenario: A relative path
- **WHEN** an agent writes `notes.txt`
- **THEN** a command's `cat /home/agent/notes.txt` prints its content

#### Scenario: Outside what a command can write
- **WHEN** an agent writes `/etc/jen-probe`, or through a symlink in its home that points at `/etc/passwd`
- **THEN** it gets `400` with the workspace's reason, and nothing outside its home, `/tmp` and `/dev/shm` changes

#### Scenario: A read-only file
- **WHEN** an agent writes over a file with mode `444`
- **THEN** it gets `400` saying permission is denied, and the file is unchanged

#### Scenario: A pseudo-file
- **WHEN** an agent reads `/proc/self/status`, whose size reads as 0
- **THEN** it gets the file's content

#### Scenario: jen isn't there
- **WHEN** an agent reads `/state/agent.db`
- **THEN** it gets `404`

### Requirement: A write lands whole or not at all
A write SHALL create the file's missing folders and replace the file only once all of its bytes have arrived, so a reader or a watching program sees the old file or the new one and never part of one. A write cut short SHALL leave the file as it was. A write over an existing file SHALL keep its mode.

#### Scenario: Folders are created
- **WHEN** an agent writes `a/b/c.txt` and `a` doesn't exist
- **THEN** the file is written

#### Scenario: A cut write
- **WHEN** a write's bytes stop arriving before the declared size
- **THEN** the file keeps its old content, and no partial file is left in its place

#### Scenario: An executable stays executable
- **WHEN** an agent writes over a file with mode `755`
- **THEN** the file still has mode `755`

### Requirement: The file route refuses what it can't do
The file route SHALL answer `403` to an agent whose grant lacks `workspace`, `404` to the owner, `400` to a missing or empty `path`, one holding a NUL or one over 4 KiB, `404` to a read of a file that doesn't exist, `413` to a write body or a file read over 16 MiB, `400` with the workspace's reason to any other read or write the workspace refuses, such as a folder, and `409` when the workspace isn't running or stops during the call.

#### Scenario: No grant
- **WHEN** an agent whose grant lacks `workspace` reads a file
- **THEN** it gets `403`

#### Scenario: A large file
- **WHEN** an agent reads a 17 MiB file
- **THEN** it gets `413`, and no more than the bound is read from the workspace

#### Scenario: A large body
- **WHEN** an agent writes a body that declares 17 MiB
- **THEN** it gets `413` and the body isn't read

#### Scenario: A folder
- **WHEN** an agent reads or writes `/home/agent` itself
- **THEN** it gets `400` saying it's a folder

### Requirement: The runtime bounds what it reads from a file operation
The runtime SHALL read at most the 16 MiB file bound plus 64 KiB from a file operation's exec, SHALL answer `502` when the content is longer or shorter than the size the workspace reported, and SHALL answer every file call within 30 seconds, whatever the workspace does.

#### Scenario: More than reported
- **WHEN** a file read's stream carries more bytes than the size reported
- **THEN** the runtime answers `502`

#### Scenario: A stream that doesn't end
- **WHEN** a file operation's stream never ends
- **THEN** the runtime answers within 30 seconds

### Requirement: An agent with the grant is offered the file tools
An agent whose grant has `workspace` SHALL be offered `read_file`, `write_file` and `edit_file` beside `run_command`, each calling the file route with the agent's own token and the call's cancel signal. A runtime refusal SHALL be a tool error holding the runtime's status, except where a tool's requirement gives the error.

#### Scenario: Offered with the grant
- **WHEN** an agent whose grant has `workspace` calls the model
- **THEN** it offers `run_command`, `read_file`, `write_file` and `edit_file`

### Requirement: read_file returns numbered lines within a cap
`read_file` SHALL take `path` and an optional `offset` (the first line, from 1) and `limit` (a number of lines), and SHALL return each line prefixed with its number and a tab. It SHALL return at most 2000 lines and 32 KiB per call, cutting a single longer line and saying so. When it returns less than the whole file it SHALL say which lines these are, how many the file has, and the offset to read on from.

#### Scenario: A small file
- **WHEN** the model reads a three-line file
- **THEN** the result is its three lines numbered 1 to 3, with no note

#### Scenario: A large file
- **WHEN** the model reads a 5000-line file without a range
- **THEN** it gets lines 1 to 2000 at most, and a note saying the file has 5000 lines and to read on from the next line

#### Scenario: A range
- **WHEN** the model reads with `offset` 10 and `limit` 5
- **THEN** it gets lines 10 to 14, numbered 10 to 14

### Requirement: read_file answers a missing file
`read_file` on a path where there is no file SHALL return a result saying so, not an error.

#### Scenario: Checking before creating
- **WHEN** the model reads `notes/release.md` and there is no such file
- **THEN** the result says there's no file at that path, and doesn't start with `Error:`

### Requirement: read_file doesn't print what isn't text
`read_file` SHALL fail, giving the file's size, on a file holding a NUL byte or bytes that aren't valid UTF-8, saying to inspect it with `run_command`. On a file over 16 MiB it SHALL fail saying to search it with `run_command`.

#### Scenario: A binary file
- **WHEN** the model reads a PNG
- **THEN** the result starts with `Error:`, gives its size, and names `run_command`

### Requirement: write_file writes a whole file
`write_file` SHALL take `path` and `content`, write the content as UTF-8 as the whole file, creating its folders, and return the path and the number of bytes written. It SHALL fail without calling the runtime on content over 16 MiB.

#### Scenario: Text that would break a heredoc
- **WHEN** the model writes content holding `$HOME`, backticks, both quotes, a trailing backslash and a line that is only `EOF`
- **THEN** the file holds exactly that content

### Requirement: edit_file replaces an exact string
`edit_file` SHALL take `path`, `old_string`, `new_string` and an optional `replace_all`, and replace `old_string` with `new_string` literally, with no pattern in either, then write the file back. It SHALL fail without writing when `old_string` is empty, equals `new_string`, isn't found, or is found more than once without `replace_all`, and on a file that is missing or isn't text. It SHALL return the path and how many matches it replaced.

#### Scenario: One match
- **WHEN** the model replaces a string found once
- **THEN** the file has that one change and nothing else

#### Scenario: No match
- **WHEN** `old_string` isn't in the file
- **THEN** the result starts with `Error:`, says the match must be exact, whitespace and indentation included, and without read_file's line numbers, and the file is unchanged

#### Scenario: Several matches
- **WHEN** `old_string` is found 3 times and `replace_all` isn't set
- **THEN** the result starts with `Error:`, says it matches 3 times and to add surrounding text or set `replace_all`, and the file is unchanged

#### Scenario: Every match
- **WHEN** `old_string` is found 3 times and `replace_all` is true
- **THEN** all three are replaced, and the result says 3

#### Scenario: Replacement text isn't a pattern
- **WHEN** `new_string` holds `$&` or `$1`
- **THEN** the file holds those characters as written

#### Scenario: No old string
- **WHEN** `old_string` is empty
- **THEN** the result starts with `Error:` and says to use `write_file`

## MODIFIED Requirements

### Requirement: run_command refuses what the runtime would
`run_command` SHALL fail, without calling the runtime, on a timeout over 600 seconds or below 1, or a command whose request body, as the UTF-8 JSON it would send with its timeout, would be over 64 KiB. The error for a long command SHALL say to write files with `write_file`. No command it sends SHALL get `413`.

#### Scenario: A long heredoc
- **WHEN** the model calls `run_command` with a command of 70 KiB
- **THEN** nothing is sent to the runtime, and the result starts with `Error:` and names `write_file`

#### Scenario: Escaping counts
- **WHEN** the model calls `run_command` with a timeout and a command of 64,000 bytes of short lines with quotes and backslashes, whose JSON body is over 64 KiB
- **THEN** nothing is sent to the runtime, and the result names `write_file`

### Requirement: run_command's description says how the workspace works
`run_command`'s description SHALL say that each command runs in bash in the home directory, which persists, with no network and no way to install anything; that the timeout defaults to 2 minutes and is at most 10; that a command which keeps running goes in the background with its output redirected; that output is capped at about 8 KB, so large output belongs in a file, and output cut anyway is saved whole; and that a command is limited to 64 KB as sent, escaping included, so files are written with `write_file`.

#### Scenario: The model is told the limits
- **WHEN** an agent with `workspace` calls the model
- **THEN** `run_command`'s description names the 2-minute default, the 10-minute maximum, the 8 KB output cap, the 64 KB command limit and `write_file`

### Requirement: The boundary live check
With Docker running, a live check SHALL start a runtime with placeholder model settings, spawn an agent with `workspace`, and call the command route and the file route with that agent's token. It SHALL fail if any scenario of this capability's boundary, lifecycle, timeout, background, cut, read bound, file round-trip, file reach, mode or file bound fails against a real workspace container. It SHALL need no model credentials, and CI SHALL run it on every push.

#### Scenario: The boundary holds
- **WHEN** the boundary live check runs with Docker
- **THEN** every probe passes, or the check fails naming the one that didn't

#### Scenario: CI
- **WHEN** a commit is pushed
- **THEN** CI builds the three images and runs the boundary live check
