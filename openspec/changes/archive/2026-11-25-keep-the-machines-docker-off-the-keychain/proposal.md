# Proposal

[JEN-35](https://linear.app/reveer/issue/JEN-35): on a Mac, pull jen's images whatever the keychain holds for ghcr.io.

## Why

On an Apple silicon Mac whose keychain holds a stale ghcr.io login, as Docker Desktop leaves behind, `jen new home` from `jen-ai@0.2.0` fails with `docker pull failed: Error response from daemon: error from registry: denied`. jen gives its own `docker` a `DOCKER_CONFIG` in the machine's folder so the user's configuration can't reach it ([decisions.md](../../../../edda/decisions.md), 2026-11-24), but that folder holds no `config.json`. A `docker` command whose config names no credentials falls back on macOS to `docker-credential-osxkeychain` when it's on `PATH`, so it hands the engine the keychain's login. ghcr.io answers that login's token request with `403`, where an anonymous one gets a token. Reproduced on 2026-11-25 against 0.2.0's machine: the engine's log shows the `403`, and the same pull succeeds with the helper off `PATH`. It's also why every engine on the maintainer's Mac was denied ghcr.io during [JEN-31](https://linear.app/reveer/issue/JEN-31).

## What Changes

- **On a Mac, jen writes its own `docker`'s `config.json`**, `{"auths": {"ghcr.io": {}}}`: ghcr.io, with no credentials. A config that names any registry keeps `docker` from falling back to a credential helper, so every pull in the machine is anonymous, from ghcr.io and Docker Hub alike. Tried on 2026-11-25 with the stale login in place: both pull.
- **It's written every time the machine answers**, so a machine started by 0.2.0 gets it at the next command, without a restart.
- **`jen-machine` gains a requirement** that jen's own `docker` uses neither the user's Docker configuration file nor any login they've stored, the keychain's included. The requirements were silent on it; `jen-command` already keeps the user's engine and context out. The machine's live check pulls from ghcr.io with a stand-in credential helper that mustn't be asked.
- **The record's leftovers from JEN-31 are fixed**: `edda/environment.md` stops saying the first release's notes were edited for Mac users, which wasn't needed with no users yet, and says CI's `machine` and `launcher` jobs aren't required checks.

Linux doesn't change: there jen uses the user's own Docker, their logins included, on purpose.

*Alternatives, each rejected:*
- *Leave credential helpers off `PATH` for jen's `docker`.* A helper can sit anywhere on `PATH`, Homebrew's beside `node` and `jen` in `/opt/homebrew/bin`, so some would still be found.
- *An empty `config.json`, `{}` or `{"auths": {}}`.* Tried: `docker` still falls back, since it does so whenever the config names no credentials.
- *A `credsStore` naming a helper that doesn't exist.* Every credential lookup would fail, and so would every pull.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `jen-machine`: a new requirement that jen's own `docker` uses none of the user's logins, checked by the machine's live check.

## Impact

- **Code:** `Machine` in `src/cli/machine.ts`.
- **Tests:** `src/cli/machine.test.ts`, `src/cli/docker.test.ts`, the machine's live check in `src/cli/machine.live.test.ts`, and a check by hand on the maintainer's Mac against the stale login.
- **Record:** `edda/decisions.md` and `edda/environment.md`.
