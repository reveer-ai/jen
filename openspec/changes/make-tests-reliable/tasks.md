# Tasks

A bug fix, so there's no design. The mechanism is here, and the measurements behind it are in the proposal and in [JEN-30's comment](https://linear.app/reveer/issue/JEN-30) of 2026-11-24.

## 1. Oversized bodies

- [ ] 1.1 In `src/agent/server.test.ts`, "a body over 1 MiB gets 413, declared or chunked, and changes nothing": send the declared case with `http.request`, declaring a `Content-Length` of `MAX_MESSAGE + 1` and writing one byte. Ignore request errors, and read the status and `Connection` header from the response, as the runtime's 17 MiB test does. The chunked case writes exactly `MAX_MESSAGE + 1` bytes, all of which the agent reads before it answers, so it stays as it is.
- [ ] 1.2 In `src/runtime/server.test.ts`, send the declared cases of "a spawn body over the bound gets 413" (16 KiB) and "a body over 64 KiB gets 413 and closes the connection" the same way. Factor the declared request into one helper if the three tests can share it.

## 2. A build's identity

- [ ] 2.1 In `identify` in `scripts/eval/build.ts`, stop copying the real index. Fill the temporary index with `git read-tree <commit>` under `GIT_INDEX_FILE`, then `git add -A` and `git write-tree` as now. With no stat data in the index, git hashes every file, so no timestamp can hide an edit. Replace the comment about saving rehashing with one saying why the copy was dropped: its fresh mtime defeated git's racy-clean check.
- [ ] 2.2 Time `identify` on this repo before and after. Record both in the pull request.
- [ ] 2.3 Verify by repeating `build.test.ts`'s dirty-tree case 400 times, as the investigation did (6 misses before the fix). Pass with none.

## 3. The watcher-buffer test

- [ ] 3.1 In `src/agent/server.test.ts`, "its buffer stays bounded, others are served, and it gets everything once it reads": save its 128 prestored items in one `store.save` call instead of 64, and give the test a 30-second timeout, with a comment saying its work must exceed the kernel's socket buffers. Keep its sizes.
- [ ] 3.2 Verify it under the disk load that slowed it to 7.4 s: 15 runs alone, each well inside the new timeout. Record the times in the pull request.

## 4. The runtime live check's crash

- [ ] 4.1 In `src/runtime/runtime.live.test.ts`, let `docker()` take the exit codes it accepts, defaulting to 0. The exec that sends PID 1 `SIGTERM` accepts 0 and 137, with a comment saying why: the container stops when PID 1 exits, and takes the exec'd process with it unless it exits first.

## 5. Causes not found yet

Each is reproduced and its cause found before anything changes. If one won't reproduce within the runs below, stop and bring the evidence to the maintainer rather than guessing at a fix.

- [ ] 5.1 **`run_command`'s `connect ECONNRESET`** (`src/agent/workspace.test.ts`, CI only). Run the full suite 100 times on Linux in `node:26` limited to 4 CPUs, while a second container loads its CPU and disk. On a failure, find what reset the connection. Fix it where the cause lies.
- [ ] 5.2 **The release test's `ENOTEMPTY`** (`scripts/release.test.ts`, macOS). Temporarily make the `afterEach` list what's left in the folder, with each entry's times, before failing. Run the full suite up to 100 times on macOS under load until it fails, then find what wrote there. Fix it where the cause lies. `scripts/eval/build.test.ts` removes a git repo the same way, so check the fix covers it too. Take out the listing once the cause is known.
- [ ] 5.3 **The container live check's timeout.** Run `npm run test:live` 5 times. On a timeout, read the check's transcript (`--silent=false`) to see whether the model, the stand-in route or the agent stalled. Note whether it coincided with the other checks' image builds. Fix it where the cause lies.

## 6. Record

- [ ] 6.1 In `edda/environment.md`, take the known flakes out of `npm run test:live`'s note, and add anything a cause in task 5 shows that a future agent needs.
- [ ] 6.2 Add a dated entry to `edda/decisions.md`: the agent doesn't drain an oversized body before closing, so a client still sending may see a reset instead of the 413, as with the runtime's bounds. *Why:* no client sends more than 1 MiB, since the page refuses before sending and agents' messages are model output. A drain would be machinery for a case that doesn't exist.

## 7. Verification

- [ ] 7.1 `npm run check` passes.
- [ ] 7.2 20 full `npm test` runs in a row pass on macOS, and 20 on Linux in `node:26` limited to 4 CPUs. Record the counts in the pull request.
- [ ] 7.3 The runtime live check passes 5 times in a row, and the full live suite passes.
- [ ] 7.4 The pull request says why no evaluation ran, unless a fix from task 5 changed code under `src/agent/` or `src/runtime/` that a model sees or a tool call runs, in which case it's evaluated against `main` as `edda/conventions.md` says.
