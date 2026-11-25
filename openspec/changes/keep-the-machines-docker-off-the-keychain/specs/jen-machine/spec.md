## ADDED Requirements

### Requirement: jen's own docker uses none of the user's Docker settings
On macOS, the `docker` command `jen` runs against the machine SHALL use none of the user's Docker settings: no configuration file, context, `DOCKER_` variable or stored login, the keychain's included. It SHALL pull every image anonymously.

#### Scenario: A stale login in the keychain
- **WHEN** the Mac's keychain holds a login for ghcr.io that ghcr.io refuses, and a user runs `jen new home`
- **THEN** jen pulls its images from ghcr.io anonymously, and `home` starts

#### Scenario: Docker Desktop's configuration
- **WHEN** the user's `~/.docker/config.json` names a credential helper and a current context, and `DOCKER_HOST` points at Docker Desktop
- **THEN** jen's `docker` reaches the machine's engine, and uses neither the helper nor the context

#### Scenario: A machine started by an earlier jen
- **WHEN** a machine started by `jen-ai@0.2.0` is running, and the user upgrades to a version with this requirement and runs a command that pulls
- **THEN** the pull is anonymous, without the machine restarting
