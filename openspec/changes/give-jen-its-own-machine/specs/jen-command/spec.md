## MODIFIED Requirements

### Requirement: The command reaches the engine through Docker's own command
`jen` SHALL reach the engine only through a `docker` command. On macOS it SHALL run the `docker` command its package holds, pointed at jen's machine, whatever the user's `DOCKER_HOST` and Docker context say. On Linux it SHALL run the user's `docker` command, as the user's Docker context and `DOCKER_HOST` configure it. When `docker` is missing, or its engine doesn't answer and `jen` can't start it, every command but `jen help` and the stops SHALL fail with an error saying so, having changed nothing.

#### Scenario: No engine
- **WHEN** the user runs `jen list` on Linux while Docker isn't running and can't be started
- **THEN** it exits non-zero with an error saying Docker isn't reachable and how to start it

#### Scenario: A Docker context on a Mac
- **WHEN** the user's Docker context points at Docker Desktop and they run `jen list` on a Mac
- **THEN** jen lists the roots in its machine, and sends nothing to Docker Desktop

### Requirement: The user stops one root or everything
`jen stop @<name>` SHALL stop that root and everything under it, keeping their conversations and files, and SHALL leave the runtime running. `jen stop all` SHALL stop every agent and then the runtime, keeping everything they hold, and on macOS SHALL then stop jen's machine. When nothing of jen is running, `jen stop all` SHALL say so and exit 0.

#### Scenario: Stopping one root
- **WHEN** the user runs `jen stop @home` while `home` and `work` are running
- **THEN** `home` and its sub-agents are stopped, and `work` and the runtime are still running

#### Scenario: Stopping everything
- **WHEN** the user runs `jen stop all`
- **THEN** no agent, workspace or runtime container of jen's is left, every volume is kept, and the next query starts them again with their conversations

#### Scenario: Stopping everything on a Mac
- **WHEN** the user runs `jen stop all` on a Mac
- **THEN** jen's machine is stopped too, and the next command starts it again

### Requirement: Uninstalling deletes everything of jen's
`jen uninstall` SHALL ask for confirmation, and do nothing unless the user answers `y`; without a terminal on stdin it SHALL fail. On `y`, on Linux, it SHALL remove every container, volume and network that's jen's, the settings and jen's images, every version of the registry's included, without needing the runtime to start, carrying on past a failure and reporting each one. It SHALL leave alone the registry's images of a repository whose image the environment names. On macOS it SHALL instead stop jen's machine and delete its folder, which holds all of those. When `jen` was installed globally with npm, it SHALL then uninstall the `jen-ai` package; otherwise it SHALL say how the command remains.

#### Scenario: Uninstalling
- **WHEN** the user runs `jen uninstall` with two roots, a sub-agent and a workspace, and answers `y`
- **THEN** no container, volume, network or image of jen's is left, and the settings are gone

#### Scenario: Uninstalling on a Mac
- **WHEN** the user runs `jen uninstall` on a Mac and answers `y`
- **THEN** jen's machine is stopped and `~/.jen/machines/jen/` is gone

#### Scenario: Declining
- **WHEN** the user runs `jen uninstall` and answers anything but `y`
- **THEN** nothing is removed

#### Scenario: Without a runtime that can start
- **WHEN** the user runs `jen uninstall` while the runtime's image is missing
- **THEN** the agents' containers and volumes, the settings and the other images are still removed

#### Scenario: Images an earlier version left
- **WHEN** the user uninstalls `jen` 0.1.1 on Linux while a 0.1.0 image is still there
- **THEN** both versions' images are removed

#### Scenario: Installed with npm
- **WHEN** `jen` runs from a global npm install and the user uninstalls
- **THEN** the `jen-ai` package is uninstalled too, and `jen` is no longer on the path

#### Scenario: Run from a checkout
- **WHEN** `jen` runs through `npm link` and the user uninstalls
- **THEN** everything of jen's in its engine is removed, the checkout is untouched, and jen says the command was installed another way

### Requirement: The command is checked against a real runtime
A live check SHALL install the packed package globally into a temporary npm prefix and run that `jen` against a real engine and a real model, under a runtime name and image tags of its own: on macOS, a machine of its own; on Linux, real Docker. It SHALL create a root, get a reply, see a tool call's progress line, open the UI without a browser and fetch its page, list, stop the root, stop everything and uninstall, finding nothing of its runtime left and the package gone from the prefix, and remove whatever it started even when it fails. It SHALL skip without model credentials, as the other live checks do.

#### Scenario: Without credentials
- **WHEN** the live checks run without `JEN_LIVE_API_KEY`
- **THEN** the command's check is skipped

#### Scenario: The installed command
- **WHEN** the live check runs with credentials
- **THEN** every command it runs as a process is the packed package's `jen`, not the checkout's source

#### Scenario: On a Mac
- **WHEN** the live check runs on an Apple silicon Mac with credentials
- **THEN** its root runs in a machine of the check's own, which is gone once it ends

### Requirement: A missing Docker is named with what to install
On Linux, when the `docker` command doesn't exist, every command that needs the engine SHALL fail saying to install Docker Engine, with where to get it, and that jen needs Engine 28.0 or later. On macOS, `jen` SHALL need no Docker of the user's.

#### Scenario: No Docker on Linux
- **WHEN** the user runs `jen new home` on Linux with no `docker` command
- **THEN** it exits non-zero naming Docker Engine, where to get it, and Engine 28.0

#### Scenario: No Docker on a Mac
- **WHEN** the user runs `jen new home` on a Mac with no `docker` command of their own
- **THEN** jen creates `home` in its machine

### Requirement: Docker that isn't running is started
On Linux, when the engine doesn't answer and Docker Desktop is installed, every command that needs the engine SHALL say it's starting Docker, start Docker Desktop and wait up to 120 seconds for the engine to answer before carrying on. When `jen` can't start the engine, or it doesn't answer in time, the command SHALL fail saying how to start it by hand, having changed nothing. On macOS, jen's machine is started instead, as `jen-machine` requires.

#### Scenario: Docker Desktop is quit
- **WHEN** the user runs `jen list` on Linux while Docker Desktop is installed but not running
- **THEN** jen says it's starting Docker, starts it, and lists the roots

#### Scenario: Docker Engine on Linux is stopped
- **WHEN** the user runs `jen list` on Linux with Docker Engine installed but stopped
- **THEN** it exits non-zero saying how to start the engine

#### Scenario: Docker Desktop on a Mac is quit
- **WHEN** the user runs `jen list` on a Mac while Docker Desktop is installed but not running
- **THEN** Docker Desktop stays quit, and jen lists the roots from its machine

### Requirement: An engine older than 28.0 is refused
On Linux, when the engine answers with a version below 28.0, or one that isn't Docker's `x.y` form, every command that needs the engine SHALL fail naming the version it found, that jen needs Engine 28.0 or later, and how to update, having changed nothing.

#### Scenario: Engine 27
- **WHEN** the user runs `jen list` on Linux against Engine 27.5.1
- **THEN** it exits non-zero naming 27.5.1 and Engine 28.0

### Requirement: Stopping doesn't start Docker
When the engine doesn't answer, `jen stop @<name>` and `jen stop all` SHALL start nothing, and SHALL say that nothing of jen's is running, because Docker isn't on Linux or jen's machine isn't on macOS, and exit 0.

#### Scenario: Stopping with Docker quit
- **WHEN** the user runs `jen stop all` on Linux while Docker isn't running
- **THEN** Docker stays stopped, and jen says nothing of jen's is running and exits 0

#### Scenario: Stopping with the machine stopped
- **WHEN** the user runs `jen stop all` on a Mac while jen's machine isn't running
- **THEN** the machine isn't started, and jen says nothing of jen's is running and exits 0
