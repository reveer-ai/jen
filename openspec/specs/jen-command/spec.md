# jen-command Specification

## Purpose
The `jen` command: how a user creates, talks to, opens, lists and stops their root agents from a terminal, how the command keeps its settings and the runtime it drives, and how it deletes everything of jen's.

## Requirements

### Requirement: The command reaches the engine through Docker's own command
`jen` SHALL reach the engine only through the `docker` command, as the user's Docker context and `DOCKER_HOST` configure it. When `docker` is missing, or its engine doesn't answer and `jen` can't start it, every command but `jen help` and the stops SHALL fail with an error saying so, having changed nothing.

#### Scenario: No engine
- **WHEN** the user runs `jen list` while Docker isn't running and can't be started
- **THEN** it exits non-zero with an error saying Docker isn't reachable and how to start it

### Requirement: Settings are asked for and kept by the command
`jen config` SHALL ask for the model, the base URL and the model key, with the key not echoed. An empty answer SHALL keep the current value. It SHALL keep them, with an owner token it makes up once, in a Docker volume labelled as jen's, replaced whole on each save, and SHALL write nothing of jen's outside Docker. The key SHALL never appear on a command line. Without a terminal on stdin, `jen config` SHALL fail.

#### Scenario: First settings
- **WHEN** the user runs `jen config` and answers each question
- **THEN** a volume labelled `jen.runtime=jen` holds the answers and an owner token, and nothing of jen's is written in the user's home folder

#### Scenario: Keeping a value
- **WHEN** the user runs `jen config` again and leaves the key empty
- **THEN** the key is unchanged, and so is the owner token

#### Scenario: No terminal
- **WHEN** `jen config` runs with stdin from a pipe
- **THEN** it exits non-zero, and the settings are unchanged

### Requirement: Every setting is required
The model, the base URL and the key SHALL each be required, with no default endpoint. An empty answer with no current value SHALL be asked again, and settings saved without a base URL SHALL ask only for it, keeping the other settings and the owner token.

#### Scenario: No base URL
- **WHEN** the user leaves the base URL empty and none is saved
- **THEN** `jen config` asks for it again

### Requirement: A running runtime is reached without reading the settings volume
While the runtime is running, a command SHALL get the owner token and the runtime's port from the runtime's container, and SHALL start no container to read the settings.

#### Scenario: A query to a running runtime
- **WHEN** the user sends a query while the runtime is running
- **THEN** no container is started besides any the root itself starts

### Requirement: The first command asks for missing settings
A command that needs the runtime and finds no settings SHALL ask `jen config`'s questions first when stdin is a terminal, then carry on. Without a terminal, it SHALL fail with an error saying to run `jen config`.

#### Scenario: A first query without settings
- **WHEN** the user runs `jen new home` from a terminal with no settings
- **THEN** it asks for the settings, saves them, and then creates the root

### Requirement: Changed settings reach the runtime without stopping agents
When `jen config` saves settings while the runtime is running, it SHALL replace the runtime with one that has the new settings, and SHALL leave every agent running.

#### Scenario: A new model
- **WHEN** the user changes the model with `jen config` while a root is running
- **THEN** the root is still running, and its next model call uses the new model

### Requirement: The runtime starts on demand and keeps running
Every command that needs the runtime SHALL start it when it isn't running, publish it only on `127.0.0.1`, and wait until it answers. The runtime SHALL be published on the same host port at each start while that port is free. No command SHALL stop the runtime except `jen stop all`, and replacing it for new settings or a new image. If the runtime exits at start, the command SHALL fail showing why.

#### Scenario: A query starts the runtime
- **WHEN** the user sends a query to a root while the runtime isn't running
- **THEN** the runtime is started, the query reaches the root, and the runtime is still running after the reply

#### Scenario: The same port
- **WHEN** the runtime is stopped with `jen stop all` and started again by a later command
- **THEN** it's published on the port it had before

#### Scenario: Two commands at once
- **WHEN** the user runs two queries in two terminals while the runtime isn't running
- **THEN** one runtime is started, and both queries get their replies

#### Scenario: A bad key
- **WHEN** the runtime exits at start because a setting is missing
- **THEN** the command exits non-zero and shows the runtime's error

### Requirement: A missing image is named
When an image the runtime needs is missing and isn't one an installed `jen` pulls, every command that needs the runtime SHALL fail naming the image and the command that builds it, having started nothing. So SHALL `jen config` when the runtime's image is missing, since it keeps the settings with it.

#### Scenario: No workspace image
- **WHEN** the user runs `jen list` from a checkout without a `jen-workspace` image
- **THEN** it exits non-zero naming `jen-workspace` and the `docker build` command that makes it

### Requirement: A new image stops the agents on the old one
When the runtime, or any of its agents or workspaces, runs an image other than the one its image name now refers to, the next command that needs the runtime SHALL stop every agent through the runtime, replace the runtime with one on the current image, and say so. Each agent's conversation and files SHALL be kept, and it SHALL start on the current image at its next message.

#### Scenario: A rebuilt agent image
- **WHEN** the user rebuilds `jen-agent` while a root is running, then sends that root a query
- **THEN** jen says it stopped the agents for the new image, and the root answers from a container on the new image with its earlier conversation

### Requirement: The user creates a named root
`jen new <name>` SHALL create a root agent with that name and the grant `{"spawn": true, "workspace": true}`. A name that's malformed or already a root's SHALL be an error, creating nothing.

#### Scenario: A new root
- **WHEN** the user runs `jen new home`
- **THEN** a running root named `home` exists, with `spawn` and `workspace`

#### Scenario: A name in use
- **WHEN** the user runs `jen new home` while a root named `home` exists
- **THEN** it exits non-zero, and no agent is created

### Requirement: A query shows the root's progress and its reply
`jen @<name> <query>` SHALL send the remaining arguments, joined with spaces, to the root named `<name>` as the owner. While the root works, it SHALL write to stderr one line for each tool call, each message from a sub-agent and each error event that follows the query, and nothing saved before it. It SHALL write the root's reply to the query to stdout, and exit 0.

#### Scenario: A reply
- **WHEN** the user runs `jen @home Reply with just the word heron.`
- **THEN** stdout is `heron` and a newline, and it exits 0

#### Scenario: Progress
- **WHEN** the root runs a command before replying
- **THEN** stderr has a line naming `run_command` before the reply appears on stdout

#### Scenario: A stopped root
- **WHEN** the user sends a query to a root that's stopped
- **THEN** the root is started, and its reply reaches stdout

#### Scenario: History isn't shown
- **WHEN** the user sends a second query to a root that already answered one
- **THEN** nothing from the first query's turn is written

#### Scenario: An unknown root
- **WHEN** the user sends a query to `@work` and no root has that name
- **THEN** it exits non-zero, suggesting `jen new work`, and sends nothing

### Requirement: A reply is only the text of a whole response with no tool call
The reply SHALL be the text of the first model response after the query's message with no tool call, read only once every item saved with it has arrived.

#### Scenario: Text before a tool call
- **WHEN** the root's first response after the query has text and then a tool call, and a later response has only text
- **THEN** the reply written is the later response's text

### Requirement: A query survives the root's restart
If the root's event stream ends before the reply, `jen` SHALL carry on from where it stopped reading when the root is running again, and SHALL exit non-zero saying the root stopped when it's stopped.

#### Scenario: The root crashes and restarts
- **WHEN** the root's process exits while it works on a query and the engine restarts it
- **THEN** the reply still reaches stdout, and nothing written before the crash is written again

#### Scenario: The runtime is replaced
- **WHEN** `jen config` replaces the runtime while another terminal follows a query
- **THEN** that query's reply still reaches stdout

### Requirement: A root that gives up ends the query
When the root stops trying after its model kept failing, `jen @<name> <query>` SHALL write the root's notice to stderr in full and exit 1. A notice from before the query SHALL NOT end it.

#### Scenario: The model keeps failing
- **WHEN** every model call fails while the root works on a query, and the root gives up
- **THEN** stderr ends with the root's notice, and the command exits 1 without waiting for Ctrl-C

### Requirement: Interrupting a query leaves the root working
On Ctrl-C, `jen @<name> <query>` SHALL stop reading and exit 130. Once the query may have reached the root, it SHALL say the root is still working and how to open it. Before that, it SHALL say nothing was sent, and SHALL NOT send the query. It SHALL NOT stop the root or send it anything else.

#### Scenario: Ctrl-C
- **WHEN** the user presses Ctrl-C while the root works
- **THEN** the command exits 130, and the root keeps working and replies to its conversation

#### Scenario: Ctrl-C before the query is sent
- **WHEN** the user presses Ctrl-C while `jen` is still starting the runtime
- **THEN** the command exits 130 saying nothing was sent, and the root's conversation doesn't hold the query

### Requirement: The user opens a root's UI
`jen @<name> open` SHALL start the root if it's stopped, print the URL of its page with the owner token in the fragment, and open it with `$BROWSER` when set, otherwise the system's opener where one applies. A failure to open SHALL leave the printed URL as the result, and still exit 0.

#### Scenario: Opening a stopped root
- **WHEN** the user runs `jen @home open` while `home` is stopped
- **THEN** `home` is running, and the printed URL serves its page

#### Scenario: No browser
- **WHEN** the user runs `jen @home open` over SSH, with no `$BROWSER` and no display
- **THEN** it prints the URL and exits 0

### Requirement: The user lists their roots
`jen list` SHALL print one line per root, with its name and whether it's running or stopped, sorted by name, followed by any root without a name, shown by its ID and marked as having none.

#### Scenario: Two roots
- **WHEN** roots `work` (stopped) and `home` (running) exist
- **THEN** `jen list` prints `home` as running and then `work` as stopped

### Requirement: The user stops one root or everything
`jen stop @<name>` SHALL stop that root and everything under it, keeping their conversations and files, and SHALL leave the runtime running. `jen stop all` SHALL stop every agent and then the runtime, keeping everything they hold. When nothing of jen is running, `jen stop all` SHALL say so and exit 0.

#### Scenario: Stopping one root
- **WHEN** the user runs `jen stop @home` while `home` and `work` are running
- **THEN** `home` and its sub-agents are stopped, and `work` and the runtime are still running

#### Scenario: Stopping everything
- **WHEN** the user runs `jen stop all`
- **THEN** no agent, workspace or runtime container of jen's is left, every volume is kept, and the next query starts them again with their conversations

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

### Requirement: Usage is printed for anything else
`jen` with no arguments, `jen help`, or a first argument that isn't a command or `@<name>` SHALL print the usage. Only `jen help` SHALL exit 0; the others SHALL exit 2. The usage SHALL say how to pass an unquoted `?` or `*` in zsh, which otherwise fails the command before `jen` runs.

#### Scenario: An unknown command
- **WHEN** the user runs `jen start`
- **THEN** it prints the usage and exits 2

### Requirement: jen's own output starts lowercase and is set apart in a terminal
Every line `jen` writes of its own SHALL start with a lowercase letter; text from an agent or the user SHALL be written as it is. When stderr is a terminal, `jen` SHALL write a blank line to it just before its first output or question, not before, and another as it exits, however it exits, and none when stderr isn't a terminal. After the last answer to its questions, `jen` SHALL write a blank line before what follows.

#### Scenario: In a terminal
- **WHEN** the user runs `jen list` in a terminal
- **THEN** a blank line separates its output from the command above it and from the next prompt

#### Scenario: After the questions
- **WHEN** the user answers `jen config`'s last question
- **THEN** a blank line separates the answers from what `jen` writes next

#### Scenario: Piped
- **WHEN** `jen @home <query>` runs with stdout and stderr redirected
- **THEN** neither holds a blank line jen added

### Requirement: The command is checked against a real runtime
A live check SHALL install the packed package globally into a temporary npm prefix and run that `jen` against real Docker and a real model, under a runtime name and image tags of its own. It SHALL create a root, get a reply, see a tool call's progress line, open the UI without a browser and fetch its page, list, stop the root, stop everything and uninstall, finding nothing of its runtime left and the package gone from the prefix, and remove whatever it started even when it fails. It SHALL skip without model credentials, as the other live checks do.

#### Scenario: Without credentials
- **WHEN** the live checks run without `JEN_LIVE_API_KEY`
- **THEN** the command's check is skipped

#### Scenario: The installed command
- **WHEN** the live check runs with credentials
- **THEN** every command it runs as a process is the packed package's `jen`, not the checkout's source

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
