# Design

## Context

Since [JEN-20](https://linear.app/reveer/issue/JEN-20), the runtime runs an agent's commands in its workspace container through the engine's exec, as `agent`, in `/home/agent` (`runCommand` in `src/runtime/runtime.ts`). The exec client in `src/runtime/docker.ts` attaches only stdout, and reads it to a byte bound and an abort signal. The command route is `POST /workspace/commands` (`src/runtime/server.ts`), and the agent calls it through `RuntimeClient` (`src/agent/delegation.ts`), which speaks only JSON. `run_command` lives in `src/agent/workspace.ts`.

See proposal.md for why files need tools of their own, and why the tools are generic.

## Goals / Non-Goals

**Goals:**

- **A file operation reaches exactly what a command can.** It runs as an exec in the same container, as the same user, with the kernel's permissions deciding. No rule in jen's code has to be right for the boundary to hold.
- **Exact bytes.** What's written is what lands, byte for byte, binary included, and a read returns the file's bytes unchanged.
- **A write lands whole or not at all.** An interrupted write never leaves a file cut short.

**Non-Goals:**

- Listing or searching files. `run_command` has `ls`, `find` and `rg`, which models already use for this.
- Deleting, moving or copying files, or changing their mode. `rm`, `mv`, `cp` and `chmod` do that.
- Anyone but the agent itself reaching its files, as with commands.
- Guarding against a file changing between an edit's read and its write (see Risks).

## Decisions

### Files move through exec, as the agent

The runtime reads and writes a file by running a short script, part of its own code, with the engine's exec in the caller's workspace container, as `agent`, in `/home/agent`. A relative path is relative to the home directory, an absolute one is used as given, and a symlink is followed as a shell redirect would follow it.

*Why:* a file operation then has exactly a command's reach: the same container, user, mounts and read-only root. Writing outside `/home/agent`, `/tmp` and `/dev/shm` fails with the kernel's own error, and `/state` doesn't exist there. JEN-20's boundary check already shows what that reach is.

*Alternatives:*
- The engine's archive API (`PUT` and `GET /containers/<id>/archive`), which `docker cp` uses. The engine itself resolves the path and writes the files, as root, outside the container's user and namespaces. That is a second boundary with rules of its own, and `docker cp`'s path resolution has had escapes (CVE-2018-15664, a symlink race that reached the host). It also writes whatever owner and mode the tar archive names.
- Building the tools on `run_command`, with base64 in the command and pages of `sed -n` out. The command route's 64 KiB body, 8 KiB output cap and untrusted report bound what passes through it, and the agent's own code still couldn't get a file's exact bytes.
- A daemon in the workspace that serves files. That puts jen's code inside the boundary, as JEN-20 rejected for commands.

### Bytes go in on stdin

A write sends the file's bytes on the exec's stdin. The exec client gains an optional input: it attaches stdin, starts the exec on an upgraded connection, and writes the input there. The client always starts an exec on an upgraded connection, with stdin attached only when there's input, so commands and files share one way of running an exec.

The script reads exactly the declared number of bytes with `head -c`, so it never waits for the end of the input, and the client never has to half-close a connection. Measured on Docker Desktop on 2026-11-12, against the `jen-workspace` image:
- `head -c` exits once it has its bytes, and the engine then ends the stream.
- 16 MiB went in in 123 ms and came back out on stdout in 80 ms, with matching hashes.
- A caller that hung up after 10 of 100 bytes left `head` exiting `0` with a 10-byte file. That's why writes go to a temporary file first (below).

*Alternative:* the bytes as an argument to the exec, which Linux limits to 128 KiB.

### A write lands whole: a temporary file, then a rename

The write script:
1. resolves the path, following symlinks, so a write through a link lands on its target, as `>` would
2. creates the target's folders, like `mkdir -p`
3. refuses a path that is a folder
4. reads the declared number of bytes from stdin into a new temporary file beside the target, named `.<name>.jen-<random>`
5. checks the temporary file holds exactly that many bytes, and otherwise deletes it and reports the write cut
6. gives it the target's mode when the target exists, so editing a script keeps it executable
7. renames it over the target

A rename within one folder is atomic. So a program watching the file, such as a dev server, sees the old file or the new one, never half of one, and an interrupted write leaves the old file as it was.

*Alternative:* writing in place, `head -c "$size" > "$path"`. That's simpler, but the hang-up measured above would leave the file cut short. That would happen to any write an urgent message cancels.

### What the scripts report

Each script prints a status line before anything else:

| Script | Lines |
|---|---|
| read | `ok <size>`, then exactly that many bytes; `missing`; `large <size>`; or `error <message>` |
| write | `ok`, or `error <message>` |

An error's message is the failing tool's own, such as `Permission denied`, `Read-only file system` or `Is a directory`, so the model hears the real reason.

The read script opens the file once and reports the size of what it opened. It sends no bytes for a file over the bound.

As with commands, any process in the workspace can write to the exec's stream through `/proc/<pid>/fd/1`, so it can forge a status line or a file's content. That only misleads the agent about its own workspace. The runtime trusts nothing from the stream that it enforces:
- It reads at most the file bound plus 64 KiB of frames and status.
- It answers `502` to content longer than the size reported, or a stream that ends before it.
- It ends every call within a fixed 30 seconds: 16 MiB took well under a second.

### The route

`/workspace/files?path=<path>` acts on the caller's own workspace, like the command route.
- `GET` answers `200` with the file's bytes as `application/octet-stream`.
- `PUT` with the bytes as its body answers `204`.

Refusals:
- `403` to an agent without `workspace`, and `404` to the owner, as for commands
- `400` to a missing or empty `path`, one holding a NUL, or one over 4 KiB
- `404` to a read of a file that doesn't exist
- `413` to a write body, or a file read, over 16 MiB. A declared body over it is refused unread, as `readBody` does today.
- `400` to any other read or write the workspace refuses, with the script's message
- `409` when the workspace isn't running or stops mid-call, told as `runCommand` tells it
- `502` to a stream that breaks the rules above, or a call past its 30 seconds

The body is raw bytes, not JSON, so binary needs no encoding and costs nothing extra. The path goes in the query because a `GET` has no body.

*Why 16 MiB:* the runtime holds a whole file in memory while it moves it, so the bound caps what any caller makes the shared runtime hold. 16 MiB is far past anything a model writes or reads into its conversation. It also leaves [JEN-18](https://linear.app/reveer/issue/JEN-18) room for a UI's images and fonts. It's a cap, not a reservation.

### The agent's side

`RuntimeClient` gains `readFile(path, signal)`, returning a `Buffer`, and `writeFile(path, bytes, signal)`. They send and receive raw bytes, and a refusal throws a `RuntimeRefusal`, as `request` does. These are what the file tools use and what JEN-18's `publish_ui` will use.

The three tools live in `src/agent/workspace.ts` beside `run_command`, and `workspaceTools` offers all four with `workspace`.

**`read_file`** takes `path`, and optional `offset` (the first line, from 1) and `limit` (how many lines).
- It returns the lines, each prefixed with its number and a tab, as `cat -n` does. Models read and cite line numbers, and a range is asked for by number.
- At most 2000 lines and 32 KiB come back per call. When that isn't the whole file, it ends with a note: which lines these are, how many the file has, and the `offset` to read on from. A single line over 32 KiB comes back cut, saying so.
- A file that holds a NUL byte or isn't valid UTF-8 isn't printed. The error gives its size and says to inspect it with `run_command`, such as with `file` or `xxd`.
- A file over the route's bound gets an error saying to search it with `rg` or `sed -n` through `run_command`.

*Why 32 KiB when a command's output is capped at 8 KiB:* a read is asked for on purpose, a range at a time, and a model reads the part of a file it will edit. Command output can be huge by accident. Every read stays in the conversation, so the cap still bounds what one call costs.

**`write_file`** takes `path` and `content`, encodes the content as UTF-8, and writes the whole file, creating its folders. Content over 16 MiB is refused before anything is sent. The result names the path and the bytes written.

**`edit_file`** takes `path`, `old_string`, `new_string`, and an optional `replace_all`. It reads the file, replaces in the agent's own code, and writes the file back. It fails without writing:
- when `old_string` is empty, saying to use `write_file` to create a file
- when `new_string` equals `old_string`
- when the file is binary, or missing
- when `old_string` isn't found, saying it must match exactly, whitespace and indentation included, and without `read_file`'s line numbers
- when `old_string` matches more than once and `replace_all` isn't set, saying how many times it matches and to include more of the surrounding text or set `replace_all`

The replacement is literal: it splits on `old_string` and joins with `new_string`, so a `$&` or `$1` in the new text isn't read as a pattern, as `String.prototype.replace` would read it. The result names the path and how many matches were replaced.

**The descriptions are behavior.** As built, the behavior check settles their wording (see Checks). The drafts say what each tool does, the limits above, and that `edit_file`'s match is exact. `run_command`'s description stops saying "write a large file in parts" and says instead to write files with `write_file`. Its error for a command over 64 KiB says the same. The command route's 64 KiB bound stays: nothing is gained by shrinking it, and a model may still write a short heredoc.

`src/agent/AGENTS.md`'s rule that `run_command`'s description is behavior widens to every tool description in `workspace.ts`.

### Checks

- **Unit tests:**
  - `docker.test.ts`, against its stub socket: an exec with input attaches stdin, upgrades the connection and writes the input; one without input still upgrades and attaches no stdin.
  - `fake-docker.ts`: exec gains the input, so runtime tests can assert what was sent.
  - `runtime.test.ts` and `server.test.ts`: the route's refusals, each status line, a stream longer or shorter than reported, the deadline, and that the path and size reach the script as arguments, never spliced into it.
  - `workspace.test.ts`: each tool's ranges, caps, notes and errors, the literal replacement, and the four tools offered with `workspace`.
- **The boundary check** (`src/runtime/workspace.live.test.ts`) gains file probes, run with the agent's token against a real workspace. It fails unless:
  - all 256 byte values written to a file in a new folder come back unchanged, and `stat` through a command shows the file owned by `agent`
  - an existing executable keeps its mode across a write
  - a write to `/etc/jen-probe` and to `/usr/local/bin/jen-probe` is refused, and a read of `/state/agent.db` gets `404`
  - a write through a symlink in the home directory that points at `/etc/passwd` is refused, and `/etc/passwd` is unchanged
  - a read of a 17 MiB file gets `413`
- **The behavior check** gains an eighth task, `files`, with the grant `{"workspace": true}` and one owner message. It asks the root to:
  - run a given command that writes `settings.conf`, about 30 KB with the line `cache_ttl = 300` in its middle
  - change that line to `cache_ttl = 900` and nothing else
  - create `notes/release.md` holding given text with `$HOME`, backticks, both quotes, a trailing backslash and a line that is just `EOF`
  - reply when it's done

  The check reads both files from the workspace with `docker exec`. It fails unless `settings.conf` matches the expected bytes exactly and `release.md` matches the given text, with or without a final newline. The check's existing rule that any failed tool call fails the run applies too, so an `edit_file` that doesn't match counts against the task. That is the evidence the proposal names for revisiting native tools. The task judges the files, not which tools wrote them. As built, the design records which tools Luna chose.

## Risks / Trade-offs

- **[A file changes between an edit's read and its write]** A background process writing the same file loses its change. → Rare: it needs the agent's own background process writing the file it's editing. An exact-match edit also fails rather than guessing when the text moved. A conditional write would add a version check to every call for a case nothing hits yet.
- **[A rename replaces the file's inode]** A hard link to the old file keeps the old content, and a program holding the old file open keeps reading it. → Editors that save atomically behave the same, and watchers handle it.
- **[A runtime crash mid-write leaves a temporary file]** → It's named `.<name>.jen-<random>`, beside its target, so it's plain what it is. Nothing else is left half-done.
- **[The runtime holds up to 16 MiB per call]** Ten agents reading at once can make it hold 160 MiB. → Bounded by `JEN_MAX_AGENTS` and the fixed cap.
- **[Line endings]** A file with CRLF line endings won't match an `old_string` written with LF. → Rare in a Linux workspace, and the error says the match must be exact. Normalizing line endings would make writes no longer byte-exact.

## Migration Plan

Nothing to migrate. Rebuild the runtime and agent images and restart the runtime. The workspace image is unchanged. Rolling back is running the previous images: no file or label changes shape.
