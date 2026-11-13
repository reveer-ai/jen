# agent-workspace Specification

## Purpose
Defines an agent's workspace: a container of its own beside the agent's, where the agent's commands run, what a command can and can't reach from it, how it follows its agent's lifecycle, and the `run_command` tool that runs commands in it.

## Requirements

### Requirement: An agent with the workspace grant has a workspace
Each agent whose grant has `workspace` SHALL have a workspace: a container of its own, separate from the agent's container, with a volume of its own mounted as its home directory, `/home/agent`. An agent without `workspace` SHALL have no workspace container or volume.

#### Scenario: A root agent with the grant
- **WHEN** the owner spawns an agent with `{"spawn": false, "workspace": true}`
- **THEN** the agent has a running workspace container and a workspace volume, both separate from its own

#### Scenario: A sub-agent without the grant
- **WHEN** an agent spawns a child with `{"spawn": false}`
- **THEN** no workspace container or volume exists for the child

### Requirement: A workspace can't reach jen
A workspace container SHALL hold no state volume and no engine socket, and SHALL have none of jen's settings in its environment. Nothing a command runs SHALL be able to see the agent's process, the agent's state, or any `JEN_*` variable.

#### Scenario: Looking for jen's settings
- **WHEN** a command lists its environment and every process it can see
- **THEN** no `JEN_*` variable appears, and no process of the agent's

#### Scenario: Looking for the agent's state
- **WHEN** a command looks for `/state` or the agent's database
- **THEN** neither exists in the workspace

### Requirement: A workspace has no network
A workspace container SHALL have no network but its own loopback. A command SHALL NOT be able to reach the runtime, any agent, another workspace or the internet.

#### Scenario: Reaching out
- **WHEN** a command tries to connect to the runtime, its own agent, or a host on the internet
- **THEN** each connection fails

#### Scenario: Its own loopback
- **WHEN** a command starts a server on a loopback port in the background and then fetches from it
- **THEN** the fetch succeeds

### Requirement: A workspace is bounded and unprivileged
A workspace container SHALL run as the unprivileged user `agent`, with every capability dropped and `no-new-privileges`, and SHALL be limited to 2 CPUs, 2 GiB of memory and 512 processes. A command SHALL be able to write only under `/home/agent`, `/tmp` (at most 512 MiB) and `/dev/shm` (at most 64 MiB). These limits SHALL be fixed and SHALL NOT be changed by any caller.

#### Scenario: Writing outside the workspace
- **WHEN** a command tries to write a file anywhere outside `/home/agent`, `/tmp` and `/dev/shm`, and reads it back
- **THEN** no write it can read back succeeds

#### Scenario: Too many processes
- **WHEN** a command tries to start more than 512 processes
- **THEN** the processes past the limit fail to start

#### Scenario: Building in /tmp
- **WHEN** a command writes an executable to `/tmp` and runs it
- **THEN** it runs

### Requirement: The workspace follows what's done to its agent
Spawning or starting an agent SHALL start its workspace before the agent, so a running agent always has a running workspace. Stopping an agent SHALL remove its workspace container, ending every process in it and keeping its files. Deleting an agent SHALL remove its workspace container and volume. A crash of the agent's process SHALL leave its workspace running. When an agent's restarts run out, its workspace container SHALL be removed.

#### Scenario: Files survive a stop and start
- **WHEN** a command writes a file in the home directory, and the agent is stopped and started
- **THEN** a later command reads the file back

#### Scenario: Deleting removes the files
- **WHEN** an agent with a workspace is deleted
- **THEN** neither its workspace container nor its workspace volume remains

#### Scenario: Restarts run out
- **WHEN** an agent's process keeps exiting until its restarts run out
- **THEN** its workspace container is removed and its workspace volume kept

### Requirement: A workspace that dies comes back
If a workspace container's first process exits while its agent runs, the engine SHALL restart the workspace container, keeping its files. Its background processes SHALL be gone, and its agent SHALL keep running.

#### Scenario: The workspace's first process is killed
- **WHEN** a workspace container's first process exits while its agent runs
- **THEN** the workspace runs again with its files, and the agent is still `running`

### Requirement: The workspace image holds the agent's tools and none of jen
Workspaces SHALL run from a workspace image of its own, named by `JEN_WORKSPACE_IMAGE` (default `jen-workspace`), holding Node, bash, git, python3, `ps`, `kill`, `curl`, ripgrep and jq, and no file from `src/`. Its user SHALL be `agent` with home `/home/agent`.

#### Scenario: The tools are there
- **WHEN** a command runs `node --version && git --version && python3 --version && rg --version && jq --version && curl --version && ps -p $$`
- **THEN** it exits `0`

#### Scenario: No jen code
- **WHEN** the workspace image is built
- **THEN** it contains no file from `src/`

### Requirement: An agent runs commands in its own workspace through the runtime
`POST /workspace/commands` with `{"command": "<shell>", "timeout": <seconds>}` SHALL run the command with bash, as `agent`, in `/home/agent`, with stdin closed, in the caller's own workspace and no other. Once the command's shell exits, it SHALL answer `200` with `{"exitCode", "output", "timedOut"}`, where `output` is the command's stdout and stderr together. Each command SHALL start in the home directory, whatever an earlier one changed to.

#### Scenario: A command's result
- **WHEN** an agent with a workspace posts `{"command": "echo hi; echo err >&2; exit 3"}`
- **THEN** it gets `200` with `exitCode` 3, `timedOut` false, and output holding `hi` and `err`

#### Scenario: Bash, not sh
- **WHEN** a command uses `[[ ]]` and `set -o pipefail`
- **THEN** it runs as bash would run it

### Requirement: The command route refuses what it can't run
The route SHALL answer `403` to an agent whose grant lacks `workspace`, `404` to the owner, `400` to a body that isn't JSON or whose `command` isn't a string or whose `timeout` isn't a number from 1 to 600, and `413` to a body over 64 KiB, which it SHALL stop reading once it passes that size. A missing `timeout` SHALL mean 120 seconds.

#### Scenario: No grant
- **WHEN** an agent whose grant lacks `workspace` posts to `/workspace/commands`
- **THEN** it gets `403`

#### Scenario: The owner
- **WHEN** the owner posts to `/workspace/commands`
- **THEN** it gets `404`

#### Scenario: A timeout over the maximum
- **WHEN** an agent posts a command with `timeout` 601
- **THEN** it gets `400` and nothing runs

### Requirement: A timeout kills the command
When a command's timeout passes, the runtime SHALL kill the command's process group, and answer `200` with `timedOut` true and `exitCode` null. Every call SHALL be answered within its timeout plus 5 seconds, whatever the command does.

#### Scenario: A command that runs too long
- **WHEN** an agent posts `sleep 100` with `timeout` 1
- **THEN** it gets `200` with `timedOut` true within 6 seconds, and no `sleep` process from it is left running

#### Scenario: A command that stops the wrapper
- **WHEN** a command stops the process that runs it and never exits
- **THEN** the call is answered within its timeout plus 5 seconds

### Requirement: A command ends with its caller
When the caller hangs up before the command finishes, the runtime SHALL kill the command's process group. A caller that stays connected until the answer SHALL NOT count as hanging up, however long the command takes.

#### Scenario: A caller that waits
- **WHEN** a caller posts `sleep 3; echo done` and stays connected
- **THEN** it gets `200` with the output `done`, and nothing was killed

#### Scenario: A caller that hangs up
- **WHEN** a caller posts `sleep 100` and disconnects while it runs
- **THEN** the command's processes are killed

#### Scenario: Cancelled by an urgent message
- **WHEN** a `run_command` call is running and the agent gets an urgent message that cancels it
- **THEN** the command's processes are killed

### Requirement: Background processes outlive their call
The call SHALL end when the command's shell exits. A process the command started in the background SHALL keep running until the workspace container is removed, and SHALL NOT hold the call open.

#### Scenario: A server in the background
- **WHEN** a command runs `python3 -m http.server 8000 > server.log 2>&1 &`
- **THEN** the call returns at once, and a later command fetches from `localhost:8000`

#### Scenario: Stopping clears it
- **WHEN** the agent is stopped and started after that
- **THEN** no server process from before is running

### Requirement: Output is capped and a cut is saved whole
Output within 8 KiB SHALL be returned whole. Longer output SHALL be cut to its first 2 KiB and last 6 KiB, and the answer SHALL carry `cut` with the output's full size in bytes and the path of a file in the workspace that holds all of it. Output that wasn't cut SHALL leave no file behind.

#### Scenario: Long output
- **WHEN** a command prints 100 KiB
- **THEN** the answer's output is its first 2 KiB and last 6 KiB, `cut.bytes` is the full size, and the file at `cut.file` holds the whole output

#### Scenario: Short output
- **WHEN** a command prints 1 KiB
- **THEN** the answer carries no `cut` and no output file is left

### Requirement: The runtime bounds what it reads from a command
The runtime SHALL read at most 16 KiB from a command's exec. Past that, it SHALL stop reading, kill the command's process group and answer `502`. It SHALL answer as soon as the command's report is complete, without waiting for the exec's stream to end. A stream that ends without a complete report SHALL get `409` if the workspace stopped during the command, and `502` otherwise.

#### Scenario: Writing around the output file
- **WHEN** a command writes 1 MiB straight to the exec's stream through `/proc`
- **THEN** the call gets `502` at once

#### Scenario: A background process holding the stream
- **WHEN** a command leaves a background process that holds the exec's stream and keeps writing to it
- **THEN** the call is answered once the command's report is complete

#### Scenario: The agent stopped mid-command
- **WHEN** an agent's command is running and the agent is stopped
- **THEN** the call gets `409`

### Requirement: An agent with the grant is offered run_command
An agent whose grant has `workspace` SHALL be offered `run_command`, taking `command` and an optional `timeout` in seconds. It SHALL call the command route with the agent's own token and the call's cancel signal. Its result SHALL give the exit code, or say the command was killed by its timeout, then the output, and when output was cut, how many bytes there were and the file that holds them.

#### Scenario: A successful command
- **WHEN** the model calls `run_command` with `echo hi`
- **THEN** the result gives exit code 0 and the output `hi`

#### Scenario: A cut
- **WHEN** the runtime answers with `cut`
- **THEN** the result ends with the full size and the file's path

#### Scenario: A refusal
- **WHEN** the runtime refuses the call
- **THEN** the result starts with `Error:` and holds the runtime's status

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
`read_file` SHALL take `path` and an optional `offset` (the first line, from 1) and `limit` (a number of lines), and SHALL return each line prefixed with its number and a tab. It SHALL return at most 2000 lines and 32 KiB per call, and cut each line past 2000 characters, marking it cut. When it returns less than the whole file it SHALL say which lines these are, how many the file has, and the offset to read on from.

#### Scenario: A small file
- **WHEN** the model reads a three-line file
- **THEN** the result is its three lines numbered 1 to 3, with no note

#### Scenario: A large file
- **WHEN** the model reads a 5000-line file without a range
- **THEN** it gets lines 1 to 2000 at most, and a note saying the file has 5000 lines and to read on from the next line

#### Scenario: A range
- **WHEN** the model reads with `offset` 10 and `limit` 5
- **THEN** it gets lines 10 to 14, numbered 10 to 14

#### Scenario: A minified file
- **WHEN** the model reads a file whose one line is 50,000 characters
- **THEN** it gets that line's first 2000 characters, marked cut

### Requirement: read_file doesn't print what isn't text
`read_file` SHALL fail, giving the file's size, on a file holding a NUL byte or bytes that aren't valid UTF-8, saying to inspect it with `run_command`. On a file over 16 MiB it SHALL fail saying to search it with `run_command`. On a path where there is no file it SHALL fail saying so.

#### Scenario: A missing file
- **WHEN** the model reads `notes/release.md` and there is no such file
- **THEN** the result starts with `Error:` and says there's no file at that path

#### Scenario: A binary file
- **WHEN** the model reads a PNG
- **THEN** the result starts with `Error:`, gives its size, and names `run_command`

### Requirement: write_file writes a whole file
`write_file` SHALL take `path` and `content`, write the content as UTF-8 as the whole file, creating its folders, and return the path and the number of bytes written. It SHALL fail without calling the runtime on content over 16 MiB.

#### Scenario: Text that would break a heredoc
- **WHEN** the model writes content holding `$HOME`, backticks, both quotes, a trailing backslash and a line that is only `EOF`
- **THEN** the file holds exactly that content

### Requirement: edit_file replaces an exact string
`edit_file` SHALL take `path`, `old_string`, `new_string` and an optional `replace_all`, and replace `old_string` with `new_string` literally, with no pattern in either, then write the file back. It SHALL fail without writing when `old_string` is empty, equals `new_string`, isn't found, or is found more than once without `replace_all`, and on a file that is missing or isn't text.

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

### Requirement: edit_file shows what it changed
For one match, `edit_file` SHALL return the path and the edited lines with up to 4 lines either side, numbered as `read_file` numbers them, at most 40 lines. With `replace_all` it SHALL return the path and how many matches it replaced.

#### Scenario: The edited lines
- **WHEN** the model replaces a one-line string found once, on line 50 of a 100-line file
- **THEN** the result names the path and shows lines 46 to 54, numbered

#### Scenario: Every match counted
- **WHEN** the model replaces with `replace_all` a string found 3 times
- **THEN** the result names the path and says 3 matches were replaced
