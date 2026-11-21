## ADDED Requirements

### Requirement: Node older than 26 is refused
Every command, `jen help` included, SHALL first check Node's version, and below 26 SHALL fail naming the version it found, that jen needs Node 26 or later, and where to get it, having done nothing else.

#### Scenario: Node 22
- **WHEN** the user runs `jen list` with Node 22
- **THEN** it exits non-zero saying jen needs Node 26 or later and this is Node 22

### Requirement: A missing Docker is named with what to install
When the `docker` command doesn't exist, every command that needs the engine SHALL fail saying what to install for the user's system, Docker Desktop on macOS and Docker Engine on Linux, with where to get it, and that jen needs Engine 28.0 or later.

#### Scenario: No Docker on a Mac
- **WHEN** the user runs `jen new home` on macOS with no `docker` command
- **THEN** it exits non-zero naming Docker Desktop, where to get it, and Engine 28.0

### Requirement: Docker that isn't running is started
When the engine doesn't answer and Docker Desktop is installed, every command that needs the engine SHALL say it's starting Docker, start Docker Desktop and wait up to 120 seconds for the engine to answer before carrying on. When `jen` can't start the engine, or it doesn't answer in time, the command SHALL fail saying how to start it by hand, having changed nothing.

#### Scenario: Docker Desktop is quit
- **WHEN** the user runs `jen list` while Docker Desktop is installed but not running
- **THEN** jen says it's starting Docker, starts it, and lists the roots

#### Scenario: Docker Engine on Linux is stopped
- **WHEN** the user runs `jen list` on Linux with Docker Engine installed but stopped
- **THEN** it exits non-zero saying how to start the engine

### Requirement: An engine older than 28.0 is refused
When the engine answers with a version below 28.0, or one that isn't Docker's `x.y` form, every command that needs the engine SHALL fail naming the version it found, that jen needs Engine 28.0 or later, and how to update, having changed nothing.

#### Scenario: Engine 27
- **WHEN** the user runs `jen list` against Engine 27.5.1
- **THEN** it exits non-zero naming 27.5.1 and Engine 28.0

### Requirement: Stopping doesn't start Docker
When the engine doesn't answer, `jen stop @<name>` and `jen stop all` SHALL start nothing, and SHALL say that Docker isn't running, so nothing of jen's is, and exit 0.

#### Scenario: Stopping with Docker quit
- **WHEN** the user runs `jen stop all` while Docker Desktop is quit
- **THEN** Docker stays quit, and jen says nothing of jen's is running and exits 0

### Requirement: An installed jen uses its own version's images
An installed `jen` SHALL use the images `ghcr.io/reveer-ai/jen-runtime`, `jen-agent` and `jen-workspace` tagged with its own version, and a checkout SHALL use `jen-runtime`, `jen-agent` and `jen-workspace`. `JEN_RUNTIME_IMAGE`, `JEN_AGENT_IMAGE` and `JEN_WORKSPACE_IMAGE` SHALL override either.

#### Scenario: Version 0.1.0
- **WHEN** `jen` 0.1.0, installed from npm, starts the runtime
- **THEN** the runtime runs `ghcr.io/reveer-ai/jen-runtime:0.1.0` and starts agents on `ghcr.io/reveer-ai/jen-agent:0.1.0`

### Requirement: An installed jen pulls its missing images
When an image an installed `jen` names by default is missing, every command that needs it SHALL say it's pulling the image and pull it before carrying on. A pull that fails SHALL fail the command with Docker's reason, having started nothing.

#### Scenario: The first command after installing
- **WHEN** the user runs `jen new home` for the first time after `npm install -g jen-ai`
- **THEN** jen pulls its three images, asks for its settings and creates `home`

#### Scenario: Offline
- **WHEN** the first command runs with no network
- **THEN** it exits non-zero with Docker's reason the pull failed, and no container of jen's exists

### Requirement: Old versions' images are removed after an upgrade
After a command moves the agents and the runtime onto a new version's images, or pulls a new version's image with nothing of jen's running on an old one, an installed `jen` SHALL remove every image of `ghcr.io/reveer-ai/jen-runtime`, `jen-agent` and `jen-workspace` tagged with another version, passing over any that a container still uses. It SHALL leave alone the registry's images of a repository whose image the environment names, which it also never pulls.

#### Scenario: Upgrading from 0.1.0 to 0.1.1
- **WHEN** the user upgrades to 0.1.1 and runs a query
- **THEN** the agents stop and the root answers on the 0.1.1 images, and no 0.1.0 image is left

#### Scenario: Upgrading with nothing running
- **WHEN** the user runs `jen stop all`, upgrades to 0.1.1 and runs `jen list`
- **THEN** jen pulls the 0.1.1 images, and no 0.1.0 image is left

#### Scenario: Images the environment names
- **WHEN** `jen` 0.1.1 runs with `JEN_AGENT_IMAGE`, `JEN_RUNTIME_IMAGE` and `JEN_WORKSPACE_IMAGE` set, and the registry's 0.1.0 images are present
- **THEN** it pulls nothing, and the 0.1.0 images are still there

## MODIFIED Requirements

### Requirement: The command reaches the engine through Docker's own command
`jen` SHALL reach the engine only through the `docker` command, as the user's Docker context and `DOCKER_HOST` configure it. When `docker` is missing, or its engine doesn't answer and `jen` can't start it, every command but `jen help` and the stops SHALL fail with an error saying so, having changed nothing.

#### Scenario: No engine
- **WHEN** the user runs `jen list` while Docker isn't running and can't be started
- **THEN** it exits non-zero with an error saying Docker isn't reachable and how to start it

### Requirement: A missing image is named
When an image the runtime needs is missing and isn't one an installed `jen` pulls, every command that needs the runtime SHALL fail naming the image and the command that builds it, having started nothing. So SHALL `jen config` when the runtime's image is missing, since it keeps the settings with it.

#### Scenario: No workspace image
- **WHEN** the user runs `jen list` from a checkout without a `jen-workspace` image
- **THEN** it exits non-zero naming `jen-workspace` and the `docker build` command that makes it

### Requirement: Uninstalling deletes everything of jen's
`jen uninstall` SHALL ask for confirmation, and do nothing unless the user answers `y`; without a terminal on stdin it SHALL fail. On `y`, it SHALL remove every container, volume and network that's jen's, the settings and jen's images, every version of the registry's included, without needing the runtime to start, carrying on past a failure and reporting each one. It SHALL leave alone the registry's images of a repository whose image the environment names. When `jen` was installed globally with npm, it SHALL then uninstall the `jen-ai` package; otherwise it SHALL say how the command remains.

#### Scenario: Uninstalling
- **WHEN** the user runs `jen uninstall` with two roots, a sub-agent and a workspace, and answers `y`
- **THEN** no container, volume, network or image of jen's is left, and the settings are gone

#### Scenario: Declining
- **WHEN** the user runs `jen uninstall` and answers anything but `y`
- **THEN** nothing is removed

#### Scenario: Without a runtime that can start
- **WHEN** the user runs `jen uninstall` while the runtime's image is missing
- **THEN** the agents' containers and volumes, the settings and the other images are still removed

#### Scenario: Images an earlier version left
- **WHEN** the user uninstalls `jen` 0.1.1 while a 0.1.0 image is still there
- **THEN** both versions' images are removed

#### Scenario: Installed with npm
- **WHEN** `jen` runs from a global npm install and the user uninstalls
- **THEN** the `jen-ai` package is uninstalled too, and `jen` is no longer on the path

#### Scenario: Run from a checkout
- **WHEN** `jen` runs through `npm link` and the user uninstalls
- **THEN** everything of jen's in Docker is removed, the checkout is untouched, and jen says the command was installed another way

### Requirement: The command is checked against a real runtime
A live check SHALL install the packed package globally into a temporary npm prefix and run that `jen` against real Docker and a real model, under a runtime name and image tags of its own. It SHALL create a root, get a reply, see a tool call's progress line, open the UI without a browser and fetch its page, list, stop the root, stop everything and uninstall, finding nothing of its runtime left and the package gone from the prefix, and remove whatever it started even when it fails. It SHALL skip without model credentials, as the other live checks do.

#### Scenario: Without credentials
- **WHEN** the live checks run without `JEN_LIVE_API_KEY`
- **THEN** the command's check is skipped

#### Scenario: The installed command
- **WHEN** the live check runs with credentials
- **THEN** every command it runs as a process is the packed package's `jen`, not the checkout's source
