# jen-machine Specification

## Purpose

How jen brings its own engine on an Apple silicon Mac: a small Linux VM with Docker's engine in it, shipped in the platform package and started by the first command that needs it, sharing nothing with the Mac but its engine and the ports containers publish on `127.0.0.1`, so a Mac user installs only `jen-ai`.

## Requirements

### Requirement: On an Apple silicon Mac, jen's engine is its own machine
On macOS on Apple silicon, `jen` SHALL use a Linux VM of its own, the machine, as its only Docker engine, and SHALL NOT use Docker Desktop or any other engine, even when one is installed. `jen` SHALL refuse to run on an Intel Mac, saying jen needs Apple silicon, having done nothing.

#### Scenario: Docker Desktop is also installed
- **WHEN** a user with Docker Desktop running runs `jen new home` on an Apple silicon Mac
- **THEN** `home` runs in jen's machine, and Docker Desktop's engine has no container, volume or image of jen's

#### Scenario: An Intel Mac
- **WHEN** a user runs `jen list` on an Intel Mac
- **THEN** it exits non-zero saying jen needs Apple silicon

### Requirement: The machine comes with the package
The machine SHALL be installed by `npm install -g jen-ai` alone, through a platform package that npm installs only on Apple silicon Macs, and SHALL need no install script, no download of its own and no setup on the Mac. The machine's engine SHALL get jen's images from the registry as an installed `jen` does on Linux.

#### Scenario: A fresh Mac
- **WHEN** a user with only Node 26 installed runs `npm install -g jen-ai` and then `jen new home`
- **THEN** jen starts its machine, pulls its images and creates `home`, with nothing else installed

#### Scenario: Install scripts are blocked
- **WHEN** a user installs `jen-ai` with `--ignore-scripts`
- **THEN** `jen` works the same

### Requirement: The machine shares nothing with the Mac but its engine and published ports
The machine SHALL mount no folder of the Mac's. Its engine SHALL be reachable from the Mac only through a Unix socket in the machine's folder that only the user can open. Nothing in the machine SHALL listen on its network. A port that a container in the machine publishes on `127.0.0.1` SHALL be reachable on the Mac's `127.0.0.1` at the same number while that container runs and nothing else on the Mac answers there, and SHALL NOT be reachable from any other address.

#### Scenario: The runtime's port
- **WHEN** `jen` starts the runtime published on `127.0.0.1:52817` in the machine
- **THEN** `http://127.0.0.1:52817` on the Mac reaches the runtime, and the Mac's other addresses don't

#### Scenario: The runtime's saved port, held on the Mac
- **WHEN** the runtime's saved port is `52817` and another program on the Mac listens there
- **THEN** `jen` publishes the runtime on another port the Mac has free, saves it, and sends nothing to the other program

#### Scenario: A port no longer published
- **WHEN** the container that published a port stops
- **THEN** the Mac stops listening on that port

#### Scenario: Another user on the Mac
- **WHEN** another account on the same Mac tries to open the machine's engine socket
- **THEN** it's refused

### Requirement: The machine runs exactly as long as its launcher
The machine SHALL run inside a single launcher process of jen's, which keeps running after the command that started it exits. When the launcher exits for any reason, the VM SHALL stop with it. A recorded launcher that's no longer running, as after a reboot or a crash, SHALL be treated as no machine.

#### Scenario: After the command exits
- **WHEN** `jen new home` starts the machine and exits
- **THEN** the machine and `home` keep running

#### Scenario: After a reboot
- **WHEN** the user restarts their Mac and runs `jen list`
- **THEN** jen starts the machine again and lists the roots

### Requirement: The first command that needs the engine starts the machine
When the machine's engine doesn't answer, every command that needs the engine SHALL say it's starting jen's machine, start it and wait up to 60 seconds for its engine, failing with where the machine's console log is when it doesn't answer in time. Two commands at once SHALL start one machine, and the second SHALL wait for it.

#### Scenario: A stopped machine
- **WHEN** the user runs `jen list` with the machine stopped
- **THEN** jen says it's starting its machine, then lists the roots

#### Scenario: Two commands at once
- **WHEN** two `jen` commands start while the machine is stopped
- **THEN** one machine starts, and both commands carry on with it

### Requirement: The machine stops cleanly
Asked to stop, the launcher SHALL ask the machine's Linux to shut down and wait up to 30 seconds before stopping the VM outright, and SHALL exit once the VM has stopped.

#### Scenario: Stopping a running machine
- **WHEN** the launcher is asked to stop while the machine runs
- **THEN** the machine's Linux shuts down, and the launcher exits within 30 seconds

### Requirement: The machine's data outlives stops and upgrades
Images, volumes and containers in the machine SHALL be kept when the machine stops, when the Mac restarts and when jen is upgraded. Only `jen uninstall` SHALL delete them.

#### Scenario: Restarting the machine
- **WHEN** the user runs `jen stop all` and then `jen @home What did I ask you to remember?`
- **THEN** `home` answers from its conversation, and no image is pulled again

### Requirement: An upgrade restarts the machine on the new version
When the running machine booted a different version's system or launcher than the installed package holds, the next command that needs the engine SHALL stop every agent through the runtime, stop the machine and start it on the installed version's system and launcher, keeping its data.

#### Scenario: Upgrading jen
- **WHEN** the user upgrades `jen-ai` from 0.2.0 to 0.2.1 with `home` running and runs `jen list`
- **THEN** the machine runs 0.2.1's system, `home` is stopped with its conversation kept, and it starts again on 0.2.1's images at its next message

#### Scenario: An upgrade that changes only the launcher
- **WHEN** the user upgrades `jen-ai` to a version whose machine has the same system and a new launcher, with the machine running, and runs `jen list`
- **THEN** the machine is stopped and started again by the new launcher, keeping its data

### Requirement: The machine's clock follows the Mac's
The machine's clock SHALL be set from the Mac's once the machine boots, before its engine is reachable from the Mac, and again whenever the Mac wakes from sleep.

#### Scenario: After sleep
- **WHEN** the Mac sleeps for an hour with the machine running and wakes
- **THEN** the machine's clock is within a second of the Mac's

### Requirement: The machine's resources are fixed
The machine SHALL get every CPU core the Mac has and half its memory, at most 8 GiB. Neither SHALL be a setting.

#### Scenario: A 24 GiB Mac with 8 cores
- **WHEN** the machine starts on a Mac with 24 GiB and 8 cores
- **THEN** it has 8 GiB and 8 virtual CPUs

### Requirement: Each runtime name has its own machine
A machine SHALL belong to one runtime name, with its files in `~/.jen/machines/<name>/`, so a runtime under another name, such as a live check's, starts and removes a machine of its own and never the user's.

#### Scenario: A live check's machine
- **WHEN** the command's live check runs `jen uninstall` under `JEN_RUNTIME_NAME=jen-live-1a2b`
- **THEN** `~/.jen/machines/jen-live-1a2b/` is gone, and the user's `~/.jen/machines/jen/` is untouched

### Requirement: A checkout runs the machine it builds
A checkout on macOS SHALL run the machine and launcher it builds into `dist/machine/`, and SHALL fail naming the command that builds them when they're missing.

#### Scenario: No machine built
- **WHEN** someone runs the checkout's `jen list` on a Mac without building the machine
- **THEN** it exits non-zero naming `npm run build:machine`

### Requirement: The machine is checked on a real Mac
A live check SHALL run only on an Apple silicon Mac and skip elsewhere. It SHALL start a machine under a name of its own, see its engine answer within 60 seconds, reach a container's port published on `127.0.0.1` from the Mac, stop the machine and start it again with a volume's data kept, and remove the machine even when it fails. The launcher's logic that needs no VM SHALL have unit tests that CI runs on every push.

#### Scenario: On Linux
- **WHEN** the live checks run on Linux
- **THEN** the machine's check is skipped

#### Scenario: On a Mac
- **WHEN** the machine's check runs on an Apple silicon Mac
- **THEN** it passes only once the machine has started, served a published port, stopped and started again with its data, and been removed

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
