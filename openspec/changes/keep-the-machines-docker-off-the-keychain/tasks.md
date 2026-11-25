# Tasks

A bug fix, so there's no design. The mechanism is here, and the reproduction is in the proposal.

## 1. jen's own docker config

- [x] 1.1 In `src/cli/machine.ts`, export the config jen's `docker` reads, `{"auths": {"ghcr.io": {}}}`. Its comment says why it names a registry: with a config that names no credentials, `docker` on macOS falls back to the keychain's helper.
- [x] 1.2 `Machine.ensure` writes it to `docker/config.json` in the machine's folder whenever it answers `true`, so a running machine an earlier jen started gets it at the next command. Write it only when the file differs, through a temporary file renamed over it, so a `docker` another jen runs at the same time never reads a partial file and falls back. `ensure` answering `false` writes nothing, so `jen stop` with no machine creates no folder.
- [x] 1.3 Correct `docker()`'s comment, which says the user's credential helpers are replaced, to say how.

## 2. Tests

- [x] 2.1 In `src/cli/machine.test.ts`: a machine that starts gets the config; a running machine whose folder has none gets it without a launch; a config that differs is replaced; and `ensure` without `start` on a machine that isn't running creates no folder.
- [x] 2.2 In `src/cli/machine.live.test.ts`, put a stand-in `docker-credential-osxkeychain` first on `PATH` that records being asked and answers with a login, then pull an image from ghcr.io through the machine's `docker`. Fail if the stand-in was asked. Without the fix, the `docker` command asks it.
- [x] 2.3 By hand on the maintainer's Mac, with the stale ghcr.io login still in the keychain: `jen new home` from the checkout, against a machine `jen-ai@0.2.0` started, pulls its images and starts `home`. *Done in two steps, since a checkout builds its images rather than pulling them: the checkout's `jen new home`, with the three images set to `0.2.0`'s, restarted the machine `jen-ai@0.2.0` had started and wrote the config. Then the installed `jen-ai@0.2.0`, whose own code writes none, pulled all three images from ghcr.io on 2026-11-25, where before it was denied. It stopped at the settings it had none of yet.*

## 3. Record

- [x] 3.1 Add a dated entry to `edda/decisions.md`: on a Mac, jen writes its own `docker`'s `config.json`, naming ghcr.io with no credentials, since a config naming none makes `docker` fall back to the keychain. Link it from the 2026-11-24 entry on `DOCKER_CONFIG`.
- [x] 3.2 In `edda/environment.md`, drop the sentence saying the first release's notes were edited for Mac users, and say CI's `machine` and `launcher` jobs run on every pull request but aren't required checks.
