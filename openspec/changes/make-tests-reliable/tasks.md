# Tasks

A bug fix, so there's no design. The mechanism is here, and the measurements behind it are in the proposal and in [JEN-30's comment](https://linear.app/reveer/issue/JEN-30) of 2026-11-24.

## 1. Oversized bodies

- [x] 1.1 In `src/agent/server.test.ts`, "a body over 1 MiB gets 413, declared or chunked, and changes nothing": send the declared case with `http.request`, declaring a `Content-Length` of `MAX_MESSAGE + 1` and writing one byte. Ignore request errors, and read the status and `Connection` header from the response, as the runtime's 17 MiB test does. The chunked case writes exactly `MAX_MESSAGE + 1` bytes, all of which the agent reads before it answers, so it stays as it is.
- [x] 1.2 In `src/runtime/server.test.ts`, send the declared cases of "a spawn body over the bound gets 413" (16 KiB) and "a body over 64 KiB gets 413 and closes the connection" the same way. Factor the declared request into one helper if the three tests can share it.

## 2. A build's identity

- [x] 2.1 In `identify` in `scripts/eval/build.ts`, stop copying the real index. Fill the temporary index with `git read-tree <commit>` under `GIT_INDEX_FILE`, then `git add -A` and `git write-tree` as now. With no stat data in the index, git hashes every file, so no timestamp can hide an edit. Replace the comment about saving rehashing with one saying why the copy was dropped: its fresh mtime defeated git's racy-clean check. *Done instead with the real index's entries and no stat data (`git ls-files --stage` into `git update-index --index-info`), since `read-tree` of the commit dropped what was staged, such as a force-added ignored file. Paths pass through as latin1 so a name that isn't UTF-8 survives. `build.test.ts` gains a case for each: a same-size edit whose stat data matches, a force-added ignored file, and an ignored file whose name isn't UTF-8 (skipped where the filesystem refuses such names, as macOS's does).*
- [x] 2.2 Time `identify` on this repo before and after. Record both in the pull request.
- [x] 2.3 Verify by repeating `build.test.ts`'s dirty-tree case 400 times, as the investigation did (6 misses before the fix). Pass with none.

## 3. The watcher-buffer test

- [x] 3.1 In `src/agent/server.test.ts`, "its buffer stays bounded, others are served, and it gets everything once it reads": save its 128 prestored items in one `store.save` call instead of 64, and give the test a 30-second timeout, with a comment saying its work must exceed the kernel's socket buffers. Keep its sizes.
- [x] 3.2 Verify it under the disk load that slowed it to 7.4 s: 15 runs alone, each well inside the new timeout. Record the times in the pull request.

## 4. The runtime live check's crash

- [x] 4.1 In `src/runtime/runtime.live.test.ts`, let `docker()` take the exit codes it accepts, defaulting to 0. The exec that sends PID 1 `SIGTERM` accepts 0 and 137, with a comment saying why: the container stops when PID 1 exits, and takes the exec'd process with it unless it exits first.

## 5. Causes not found yet

Each is reproduced and its cause found before anything changes. If one won't reproduce within the runs below, stop and bring the evidence to the maintainer rather than guessing at a fix.

- [x] 5.1 **`run_command`'s `connect ECONNRESET`** (`src/agent/workspace.test.ts`, CI only). Run the full suite 100 times on Linux in `node:26` limited to 4 CPUs, while a second container loads its CPU and disk. On a failure, find what reset the connection. Fix it where the cause lies. *Not reproduced: 100 of 100 runs passed. Left as a known flake.*
- [x] 5.2 **The release test's `ENOTEMPTY`** (`scripts/release.test.ts`, macOS). Temporarily make the `afterEach` list what's left in the folder, with each entry's times, before failing. Run the full suite up to 100 times on macOS under load until it fails, then find what wrote there. Fix it where the cause lies. `scripts/eval/build.test.ts` removes a git repo the same way, so check the fix covers it too. Take out the listing once the cause is known. *Not reproduced: 100 full runs under disk load and 300 of the two git-repo tests under CPU load passed. Left as a known flake, and the listing is out.*
- [x] 5.3 **The container live check's timeout.** Run `npm run test:live` 5 times. On a timeout, read the check's transcript (`--silent=false`) to see whether the model, the stand-in route or the agent stalled. Note whether it coincided with the other checks' image builds. Fix it where the cause lies. *Not reproduced: 5 of 5 passed. Left as a known flake.*

## 5a. Found in review

- [x] 5a.1 **The boundary check's timeout test answered in 6.03 s** (`src/runtime/workspace.live.test.ts`, CI, once in about 200 runs). *Found:* bash 5.2's `wait -f`, under the wrapper's job control, sometimes spins forever once its job is killed, so no report comes and the runtime answers from its grace fallback, at timeout plus 5 seconds and with no output. Reproduced through the runtime's own exec path (2 of 300 timeouts under load) and inside a workspace (7 of 1,000 with the wrapper leading its session, as under `docker exec`). *Fixed in `WRAPPER`* (`src/runtime/workspace.ts`): the wrapper has no job control. A one-line `perl` puts the command in a process group of its own, in the wrapper's session, and restores SIGINT and SIGQUIT, which bash ignores in a background command without job control. A plain `wait` then returns only once the command ends. Under load, 0 of 3,000 hung, against 9 of 1,500 for the old wrapper alongside, and 0 of 4,000 commands that stop themselves ended their call. New live tests check that a command starts with no signal ignored and that one that sends itself TSTP keeps its call until its timeout. *Rejected, each shown in review:* dropping `-f` alone, since under job control a plain `wait` returns when the command merely stops, ending the call early. `setsid` with `env --default-signal`, which made the command lead its own session, so a TSTP, TTIN or TTOU it sent itself was discarded, and it could take a controlling terminal whose hang-up killed its background processes. And `set +m` before the wait, which left a window: a command that stopped itself before `set +m` ran still ended its call (1 in 8,000 under load), and its orphaned group got SIGHUP.

## 6. Record

- [x] 6.1 In `edda/environment.md`, take the known flakes out of `npm run test:live`'s note, and add anything a cause in task 5 shows that a future agent needs. *The three causes not found stay in the note, as known flakes.*
- [x] 6.2 Add a dated entry to `edda/decisions.md`: the agent doesn't drain an oversized body before closing, so a client still sending may see a reset instead of the 413, as with the runtime's bounds. *Why:* no client sends more than 1 MiB, since the page refuses before sending and agents' messages are model output. A drain would be machinery for a case that doesn't exist.

## 7. Verification

- [x] 7.1 `npm run check` passes.
- [x] 7.2 20 full `npm test` runs in a row pass on macOS, and 20 on Linux in `node:26` limited to 4 CPUs. Record the counts in the pull request.
- [x] 7.3 The runtime live check passes 5 times in a row, and the full live suite passes.
- [x] 7.4 The pull request says why no evaluation ran, unless a fix from task 5 changed code under `src/agent/` or `src/runtime/` that a model sees or a tool call runs, in which case it's evaluated against `main` as `edda/conventions.md` says.
