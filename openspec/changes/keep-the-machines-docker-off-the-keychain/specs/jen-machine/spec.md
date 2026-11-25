## ADDED Requirements

### Requirement: jen's own docker uses none of the user's logins
On macOS, the `docker` command `jen` runs against the machine SHALL use neither the user's Docker configuration file nor any login they've stored, the keychain's included, and SHALL pull every image anonymously. Its engine and context are `jen-command`'s requirement that jen's engine is its own. The machine's live check SHALL pull from ghcr.io through jen's `docker` with a stand-in credential helper first on `PATH`, and fail if the helper is asked.

#### Scenario: A stale login in the keychain
- **WHEN** the Mac's keychain holds a login for ghcr.io that ghcr.io refuses, and a user runs `jen new home`
- **THEN** jen pulls its images from ghcr.io anonymously, and `home` starts

#### Scenario: Docker Desktop's configuration
- **WHEN** the user's `~/.docker/config.json` names a credential helper and holds logins
- **THEN** jen's `docker` asks that helper nothing and sends none of those logins

#### Scenario: A machine started by an earlier jen
- **WHEN** a machine started by `jen-ai@0.2.0` is running, and the user upgrades to a version with this requirement and runs a command that pulls
- **THEN** the pull is anonymous, whether or not the upgrade restarts the machine

#### Scenario: The live check
- **WHEN** the machine's check runs on an Apple silicon Mac
- **THEN** it passes only if jen's `docker` pulled from ghcr.io without asking the stand-in helper
