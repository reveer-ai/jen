# Proposal

[JEN-30](https://linear.app/reveer/issue/JEN-30): make the test suite pass reliably.

## Why

Tests fail now and then for reasons unrelated to the change under test, so CI turns red at random and every failure is suspect. On 2026-11-24, on `main` at d5580e7, 30 full `npm test` runs on macOS failed 4 times, and 25 on Linux (`node:26`, 4 CPUs, like GitHub's runner) all passed. The runs and measurements are in [JEN-30's comment](https://linear.app/reveer/issue/JEN-30) of that day. Each failure has a cause in the test, in the code, or one not found yet:

- **The agent's oversized-body test sends what the server won't read.** Its declared half posts a whole 1 MiB body through `fetch`. The agent answers 413 and closes, as `agent-protocol` requires, and closing on unread data resets the connection, so the client can lose the 413 (`write EPIPE` or `ECONNRESET`, reproduced in run 28). The runtime's spec already says a client still sending "may see the connection reset instead of the `413`", and its 17 MiB test avoids the race by declaring the length and sending one byte. The reviewer's local failure that [JEN-29](https://linear.app/reveer/issue/JEN-29) recorded against `workspace.test.ts` was very likely this test, since `RuntimeClient` doesn't use `fetch`. The runtime's 16 KiB spawn test and 64 KiB command test send whole bodies through `fetch` the same way.
- **`identify` can call a dirty tree clean.** A bug in `scripts/eval/build.ts`, not only its test: 6 of 400 tries reproduced it. `identify` copies the real index to a temporary one so git needn't rehash unchanged files. The copy gets a fresh mtime, which can fall in the next second. git then trusts a file's stat data even if it was written in the same second as the index, so a same-size edit goes unseen. That breaks `agent-evaluation`'s requirement that a build be identified by its contents, so the spec needs no change.
- **The watcher-buffer test is slow under disk load, not stuck.** It must send more than the kernel's socket buffers hold, so it stores about 8 MB, one SQLite transaction per turn. It takes 0.7 s alone and 5.2 to 7.4 s with the disk busy, past vitest's 5 s default.
- **The runtime live check's deliberate crash kills its own `docker exec`.** Sending PID 1 `SIGTERM` stops the container, which takes the exec'd process with it unless it exits first. So the command exits 0 or 137 depending on timing.
- **Causes not found yet:** CI's `connect ECONNRESET` in `run_command`'s result test (not reproduced in 55 runs), the release test's `ENOTEMPTY` while removing its repo (once in 30), and the container live check's timeout (needs live runs).

## What Changes

- **The oversized-body tests stop racing the close.** The agent's declared case, and the runtime's spawn and command tests, declare a length over the bound and send only part of it, then read the 413 from the response, as the runtime's 17 MiB test does. The servers don't change.
- **`agent-protocol` says what a client can see.** Its 413 requirement gains the sentence `agent-runtime`'s already has: a client still sending when the connection closes may see it reset instead.
- **`identify` builds its temporary index from the commit, not a copy.** `git read-tree` of the commit fills it with no stat data, so `git add -A` hashes every file and can't trust a stale timestamp.
- **The watcher-buffer test gets a timeout that fits its work**, with its setup saved in one transaction.
- **The runtime live check accepts 137 from the exec that crashes the agent**, and only from that one.
- **Each cause not found yet is found before it's fixed:** each is reproduced under load with what's left behind recorded, then fixed where the cause lies.
- **"Reliably" is measured:** 20 full runs in a row on macOS and on Linux, the Linux ones in a container like CI's.

*Alternative: the agent drains an oversized body before closing.* Reading and discarding the rest for a bounded time would let a client still sending see its 413. No client sends more than 1 MiB: the page refuses before sending, and agents' messages are model output. A drain would be machinery for a case that doesn't exist, and the runtime already accepts the same reset for its own bounds.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `agent-protocol`: the oversized-body requirement says a client still sending may see the connection reset instead of the 413.

## Impact

- **Code:** `identify` in `scripts/eval/build.ts`. Any fix a cause not yet found calls for.
- **Tests:** `src/agent/server.test.ts`, `src/runtime/server.test.ts`, `src/runtime/runtime.live.test.ts`, and the tests behind the causes not yet found.
- **Behavior:** nothing a model sees or a tool call does changes, so no evaluation runs, unless a cause not yet found puts the fix under `src/agent/` or `src/runtime/`.
- **Record:** the known flakes in `edda/environment.md` are retired, and the decision not to drain goes in `edda/decisions.md`.
