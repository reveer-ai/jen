// What the runtime runs in an agent's workspace, and how it reads the result.
// The workspace container's bounds are fixed here, as are the bash scripts
// sent with every exec, which run each command and move each file's bytes,
// and the parsers for what the command wrapper prints. Runtime in runtime.ts
// decides who may call them and runs them through the engine.

import type { Sandbox } from "./docker.ts";

// A command's outcome. exitCode is null when the command was killed by its
// timeout, and cut is set when the output was cut to its start and end.
export interface CommandResult {
  exitCode: number | null;
  output: string;
  timedOut: boolean;
  cut?: { bytes: number; file: string };
}

// A workspace's home directory, where its volume is mounted and every command
// starts, and what bounds it. These are fixed: no caller can change them.
export const HOME = "/home/agent";
export const SANDBOX: Sandbox = {
  user: "agent",
  tmp: { path: "/tmp", bytes: 512 * 2 ** 20 },
  shmBytes: 64 * 2 ** 20,
  memoryBytes: 2 * 2 ** 30,
  nanoCpus: 2e9,
  pids: 512,
};
// The longest a command may run, in seconds.
export const MAX_TIMEOUT = 600;
// Output within OUTPUT_CAP bytes is returned whole, and longer output is cut
// to its first OUTPUT_START and last OUTPUT_END bytes.
const OUTPUT_CAP = 8 * 1024;
const OUTPUT_START = 2 * 1024;
const OUTPUT_END = OUTPUT_CAP - OUTPUT_START;
// The most the runtime reads from a command's exec. The wrapper's own output
// is at most OUTPUT_CAP and two short lines, so only a command that writes
// around its output file comes near it.
export const READ_BOUND = 16 * 1024;
// How long a command's report may take once its timeout has passed, and how
// long any kill may take.
export const GRACE_MS = 5_000;
// How long a stream that ended without a report is given to show whether its
// workspace stopped: the stream can end before the engine says so.
export const STOPPED_MS = 1_000;
// Runs each command, sent with every exec, so nothing in the workspace can
// change how commands run. Its arguments are the command, never spliced into
// the script, and the file its output goes to. It prints, in order:
// 1. its own PID and the process group the command runs in. The command's
//    shell prints this line before it starts the command, so it's the
//    wrapper's own: whatever follows may be the command's.
// 2. once the command's shell exits, its exit code and the output's size
// 3. the output, whole within OUTPUT_CAP, or else its start and end.
// setsid gives the command a process group of its own, which the runtime
// kills on a timeout or a hang-up. It doesn't fork, since a background
// command of a shell without job control never leads its group, so the line
// names the wrapper and the group. Without job control, wait returns only
// once the command ends, and bash starts it with SIGINT and SIGQUIT ignored,
// which env undoes. Job control (set -m and wait -f) isn't used: bash 5.2's
// wait -f sometimes spins forever once its job is killed, about once in 150
// timeouts under load. Output goes to a file, not the exec's stream, so a
// background process holds the file and not the call, and long output is
// kept whole. A file that's printed whole is deleted first.
export const WRAPPER = `mkdir -p -- "\${2%/*}"
setsid env --default-signal=INT,QUIT bash -c 'echo "$PPID $$"; exec bash -c "$1" </dev/null >"$2" 2>&1' jen "$1" "$2" &
wait $!
code=$?
size=$(stat -c %s -- "$2" 2>/dev/null) || { size=0; : >"$2"; }
if [ "$size" -le ${OUTPUT_CAP} ]; then
  exec 3<"$2"
  rm -f -- "$2"
  printf '%s %s\n' "$code" "$size"
  head -c "$size" <&3
else
  printf '%s %s\n' "$code" "$size"
  head -c ${OUTPUT_START} -- "$2"
  tail -c ${OUTPUT_END} -- "$2"
fi
`;
// The largest file the runtime reads or writes, in bytes. It holds a whole
// file in memory while it moves it, so this caps what any caller can make the
// shared runtime hold.
export const MAX_FILE = 16 * 2 ** 20;
// The most the runtime reads from a file operation's exec: the file, its
// status line and the stream's frame headers.
export const FILE_READ_BOUND = MAX_FILE + 64 * 1024;
// How long a file operation may take. 16 MiB takes well under a second.
export const FILE_MS = 30_000;
// The longest status line a file script prints, which holds a tool's error.
export const STATUS_MAX = 4096;
// How long a file script lets a step that can block run, in seconds: opening
// a pipe nothing writes to, or reads from, waits forever. It's under FILE_MS,
// so the script ends the step and answers itself, leaving nothing running.
const FILE_STEP_S = 25;
// Each file script is sent with every exec, as the wrapper is, and its
// arguments are the path and a size, never spliced into it. It runs as agent
// in the home directory, so a file operation reaches exactly what a command
// can: a relative path is relative to the home, a symlink is followed, and the
// kernel decides what may be read or written. It prints a status line before
// anything else, and an error's message is the failing tool's own, its text
// after the last ": ", such as "Permission denied". LC_ALL=C keeps messages in
// English.
//
// A step that can block, such as opening a pipe, is bounded by FILE_STEP_S.
//
// The read script copies at most its bound plus one byte of the file into
// /tmp and measures the copy, since a pseudo-file's stat size is 0. It prints
// "ok <size>" and then exactly the copy's bytes, "missing", "large <size>", or
// "error <message>". The copy is deleted before it's sent, and held open.
export const READ_SCRIPT = `export LC_ALL=C
reason() { printf '%s' "\${1##*: }" | head -n 1; }
tmp=$(mktemp /tmp/.jen-read.XXXXXXXX 2>&1) || { printf 'error %s\\n' "$(reason "$tmp")"; exit 0; }
err=$(timeout -s KILL ${FILE_STEP_S} head -c $(($2 + 1)) -- "$1" 2>&1 >"$tmp")
code=$?
if [ $code -ne 0 ]; then
  rm -f -- "$tmp"
  [ $code -eq 137 ] && { echo "error the read didn't finish within ${FILE_STEP_S} seconds, as when the file is a pipe nothing writes to"; exit 0; }
  err=$(reason "$err")
  if [ "$err" = "No such file or directory" ]; then echo missing; else printf 'error %s\\n' "$err"; fi
  exit 0
fi
size=$(stat -c %s -- "$tmp")
if [ "$size" -gt "$2" ]; then
  rm -f -- "$tmp"
  real=$(stat -L -c %s -- "$1" 2>/dev/null) || real=$size
  [ "$real" -gt "$size" ] || real=$size
  printf 'large %s\\n' "$real"
  exit 0
fi
exec 3<"$tmp"
rm -f -- "$tmp"
printf 'ok %s\\n' "$size"
cat <&3
`;
// The write script refuses a path that names a folder, such as one ending in
// a slash, then resolves the path through symlinks, as a redirect would
// follow them, creates its folders, and refuses a folder and an existing file
// it can't write: a rename needs only the folder to be writable, so without
// that check a write would replace a read-only file. It reads exactly the
// declared size from stdin into a temporary file beside the target, and
// deletes it if fewer bytes arrived, as when the caller hangs up. Otherwise
// it gives the temporary file the target's mode, or a new file's, and renames
// it over the target, which within one folder is atomic: a reader sees the
// old file or the new one, never part of one. It prints "ok" or
// "error <message>".
export const WRITE_SCRIPT = `export LC_ALL=C
tmp=
reason() { printf '%s' "\${1##*: }" | head -n 1; }
fail() { [ -z "$tmp" ] || rm -f -- "$tmp"; printf 'error %s\\n' "$1"; exit 0; }
case $1 in */ | */. | */.. | . | ..) fail "Is a directory" ;; esac
target=$(realpath -m -- "$1" 2>&1) || fail "$(reason "$target")"
[ -d "$target" ] && fail "Is a directory"
dir=\${target%/*}
name=\${target##*/}
err=$(mkdir -p -- "\${dir:-/}" 2>&1) || fail "$(reason "$err")"
if [ -e "$target" ]; then
  err=$(timeout -s KILL ${FILE_STEP_S} bash -c ': >>"$1"' jen "$target" 2>&1)
  code=$?
  [ $code -eq 137 ] && fail "the write didn't finish within ${FILE_STEP_S} seconds, as when the file is a pipe nothing reads from"
  [ $code -eq 0 ] || fail "$(reason "$err")"
fi
tmp=$(mktemp -- "$dir/.$name.jen-XXXXXXXX" 2>&1) || { err=$tmp; tmp=; fail "$(reason "$err")"; }
err=$(head -c "$2" 2>&1 >"$tmp") || fail "$(reason "$err")"
got=$(stat -c %s -- "$tmp")
[ "$got" = "$2" ] || fail "the write was cut short: $got of $2 bytes arrived"
if [ -e "$target" ]; then
  err=$(chmod --reference="$target" -- "$tmp" 2>&1) || fail "$(reason "$err")"
else
  chmod "$(printf '%o' $((0666 & ~$(umask))))" -- "$tmp"
fi
err=$(mv -fT -- "$tmp" "$target" 2>&1) || fail "$(reason "$err")"
echo ok
`;

// The wrapper's first line: its own PID, the command's process group, and the
// line's length in bytes.
export interface Head {
  wrapper: number;
  group: number;
  length: number;
}

// The wrapper's first line, once it has arrived whole.
export function parseHead(received: Buffer): Head | "partial" | "malformed" {
  const text = received.subarray(0, 32).toString("latin1");
  const line = /^(\d{1,10}) (\d{1,10})\n/.exec(text);
  if (line) return { wrapper: Number(line[1]), group: Number(line[2]), length: line[0].length };
  return /^\d{0,10}( \d{0,10})?$/.test(text) && received.length < 32 ? "partial" : "malformed";
}

// The report that follows the first line: the exit code and the output's
// size, then the output, whole within OUTPUT_CAP or else its start and end.
// Anything after it is ignored. file is where a cut output was kept.
export function parseReport(received: Buffer, file: string): CommandResult | "partial" | "malformed" {
  const text = received.subarray(0, 32).toString("latin1");
  const line = /^(\d{1,3}) (\d{1,15})\n/.exec(text);
  if (!line) return /^\d{0,3}( \d{0,15})?$/.test(text) && received.length < 32 ? "partial" : "malformed";
  const exitCode = Number(line[1]);
  const bytes = Number(line[2]);
  const output = received.subarray(line[0].length);
  if (bytes <= OUTPUT_CAP) {
    if (output.length < bytes) return "partial";
    return { exitCode, output: output.subarray(0, bytes).toString("utf8"), timedOut: false };
  }
  if (output.length < OUTPUT_CAP) return "partial";
  // A character split by the cut decodes as a replacement character.
  const start = output.subarray(0, OUTPUT_START).toString("utf8");
  const end = output.subarray(OUTPUT_START, OUTPUT_CAP).toString("utf8");
  return { exitCode, output: start + end, timedOut: false, cut: { bytes, file } };
}
