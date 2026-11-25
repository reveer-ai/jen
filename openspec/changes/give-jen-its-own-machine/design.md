# Design

## Context

On macOS, `jen` runs the user's `docker` command against Docker Desktop (`src/cli/docker.ts`). It starts Docker Desktop when the engine doesn't answer and checks that the engine is 28.0 or later. An installed `jen` pulls its version's three images from GHCR (`openspec/specs/jen-command/spec.md`). Everything else `jen` does, such as the settings volume, starting the runtime, reading its token and removing old images, goes through `docker` commands. The runtime reaches its engine only through the socket (`src/runtime/docker.ts`), and agents and workspaces run only as containers on that engine.

Measured on 2026-11-24 on the maintainer's Mac (Apple silicon, macOS 27.0.1, 24 GiB):

- **The three images, saved together and gzipped, come to 142 MB.** They share `node:26-slim`'s layers. Uncompressed they're 375 MB, 425 MB and 582 MB.
- **GitHub's hosted Apple silicon runners can't start a VM.** Community reports and actions that depend on it agree that the runners lack nested virtualization. GitHub doesn't document it.
- **vfkit** (`crc-org/vfkit`, Apache-2.0, Podman's VM launcher on macOS) has three options this design relies on:
  - `--device virtio-vsock,port=N,socketURL=<path>`, which exposes a vsock port in the VM as a Unix socket on the Mac. Its `connect` mode is for connections the Mac opens.
  - `--timesync vsockPort=N`, which sets the VM's clock through `qemu-guest-agent` after the Mac wakes.
  - a REST API to stop the VM.

  These come from its documentation, not a run. Task 1 runs them.

## Goals / Non-Goals

**Goals:**

- On a Mac, `npm install -g jen-ai` is all a user installs. The first command that needs the engine starts jen's machine, and nothing else changes about how `jen` behaves.
- The runtime, agents and workspaces are unchanged, so the workspace boundary, the internal network and the boundary check stay valid on the machine's engine.
- One code path in `jen` on both platforms: it runs a `docker` command against an engine. Only where the command and the engine come from differs.

**Non-Goals:**

- Intel Macs. macOS 26 was the last release for them, and the machine is built for arm64 only.
- A Linux install without Docker. Linux keeps the Docker Engine the user installs.
- Company proxies, TLS inspection and VPN routing, which jen doesn't handle today either.
- Booting the machine as a hosted account's VM, giving disk space back to the Mac, and a kernel per workspace.

## Decisions

### The machine: Alpine, booted read-only, with a data disk

The machine is Alpine Linux for arm64, chosen because it's the smallest base with Docker Engine packaged, and containers bring their own libc. It's three files, built by a `machine` target in the `Dockerfile` that exports them with `docker build --target machine --output <dir>`:

```text
vmlinuz      Alpine's virt kernel, uncompressed, since Virtualization.framework boots only an uncompressed arm64 kernel
initramfs    mounts the system disk read-only with a tmpfs over it, and the data disk at /var/lib/docker
system.img   squashfs: Docker Engine, containerd, runc, socat, qemu-guest-agent, OpenRC
```

vfkit boots the kernel directly, with no firmware or bootloader, which is the shortest boot. The system disk is squashfs, so it ships compressed, mounts without unpacking and can't be changed. An upgrade replaces it whole. The data disk, `data.img`, is a sparse 64 GiB file that `jen` creates on first start. The initramfs formats it as ext4 when it's blank. It holds `/var/lib/docker`, so images, volumes (agents' state, workspaces, the settings) and containers outlive versions, just as they outlive Docker Desktop updates today.

The engine listens only on `/var/run/docker.sock` inside the machine. Nothing in the machine listens on its network.

*Alternative: bake the three images into the system disk*, as first proposed. The engine would have to load them on the first boot of each version, which is a second way images arrive, beside the pull an installed `jen` already does on Linux, and it would roughly triple the machine's size. Instead the machine's engine pulls from GHCR exactly as it does on Linux, and the existing rules for pulling, showing progress and removing old versions' images apply unchanged.

*Alternative: Debian with systemd.* It's familiar, but several times the size, for nothing the machine needs.

### Where the machine comes from: a platform package

The machine ships in `@jen-ai/darwin-arm64`, an npm package that `jen-ai` lists in `optionalDependencies` at its own version, with `os: darwin` and `cpu: arm64`. npm installs it only on an Apple silicon Mac. It holds the three machine files, vfkit's binary and Docker's static `docker` command for macOS:

```text
@jen-ai/darwin-arm64/
  machine/vmlinuz, machine/initramfs, machine/system.img
  bin/vfkit      vfkit's released binary, pinned and checked against its checksum
  bin/docker     Docker's static macOS client, pinned and checked against its checksum
```

Nothing runs at install, and the first command needs nothing downloaded beyond the images. The package's size is measured in task 1. Without the images it's expected to be well under 100 MB.

*Alternative: download the machine on the first command, from the GitHub release.* No large npm package, but a second host and a download path of jen's own, with its own progress and checks. With the images out of the machine, it's small enough for npm.

### `jen` keeps running `docker`, and on macOS brings its own

On macOS, `jen` runs the package's `bin/docker` with `DOCKER_HOST=unix://<machine>/engine.sock`. It ignores the user's `DOCKER_HOST`, contexts and any Docker Desktop. On Linux it runs the user's `docker` as today. Every command `jen` sends is the same on both, so `src/cli/` changes only in where its `Runner` finds `docker` and what it does when the engine doesn't answer.

*Alternative: talk to the Engine API directly*, as first proposed. One less binary (Docker's client is about 40 MB unpacked), but it rewrites every `docker run` and `docker exec` `jen` sends into create, attach and start calls, and breaks Linux users who rely on a Docker context. The bundled client changes none of that.

### The launcher: vfkit, run by a small supervisor of jen's own

`jen` starts the machine by starting a supervisor: `cli/machine-supervisor.js`, run with Node, detached from the terminal and outliving the command. The supervisor:

- starts vfkit as its child, with the kernel, the initramfs, the system disk read-only, the data disk, NAT networking, a random-number device, the console logged to `console.log`, `--timesync` and its REST API on `control.sock`, plus two vsock ports exposed as Unix sockets on the Mac:
  - `engine.sock`, relayed in the machine by socat to `/var/run/docker.sock`
  - `ports.sock`, relayed in the machine to a TCP port on its loopback named by the connection's first line
- **mirrors published ports.** It follows the engine's events through `engine.sock`, and for every running container with a port published on `127.0.0.1`, it listens on the same port on the Mac's `127.0.0.1` and carries each connection through `ports.sock`. That keeps the `jen-command` requirement that the runtime is published only on `127.0.0.1` true on the Mac. It also covers any runtime, whatever its name, including the live checks' and evaluations' when they're pointed at the machine.
- **stops the machine cleanly** on `SIGTERM`: vfkit's REST API asks the guest to shut down, and after 30 seconds it stops the VM outright.

Its files live in `~/.jen/machines/<runtime name>/`: the data disk, the sockets, `supervisor.pid`, `version` (the system disk it booted) and `console.log`. Short paths matter here, since macOS caps a Unix socket's path at 104 bytes. A runtime name of its own, such as a live check's `jen-live-<hex>`, gets a machine of its own, so a check's `jen uninstall` never deletes the user's machine.

*Alternative: publish the runtime on the machine's NAT address instead of relaying ports.* That needs no relay, but the UI's URL would be an address that changes, reachable by anything on the Mac's VM network, and the `127.0.0.1` requirement would no longer mean anything on a Mac.

*Alternative: a launcher of jen's own in Swift.* Without its own signing, it's unclear whether macOS grants the virtualization entitlement: Apple's forums have a report of it failing without a developer account. vfkit's released binary is signed already, which task 1 confirms. jen's own Swift remains the fallback if vfkit falls short.

### Starting, stopping and upgrading

- **Start.** Before the first `docker` call, `jen` checks the engine through `engine.sock`. If it doesn't answer, `jen` takes a lock in the machine's folder, starts the supervisor, says it's starting jen's machine, and waits up to 60 seconds for the engine. A second `jen` that finds the lock waits for the same engine.
- **Stop.** `jen stop all` stops every agent and the runtime as today, then signals the supervisor and waits for it to exit. `jen stop @<name>` leaves the machine running.
- **Upgrade.** When `version` names a different system disk from the package's, the next command that needs the engine:
  1. stops every agent through the runtime, as the existing rule for a new image does
  2. stops the machine
  3. starts it on the new system disk

  The runtime then starts on the new version's images, which the engine pulls.
- **Mac sleep and reboot.** Sleep pauses the machine, and vfkit sets its clock on wake. A reboot leaves a stale `supervisor.pid`, which `jen` ignores when no process holds it.

### Resources

The machine gets every core the Mac has, since idle virtual CPUs cost nothing, and half the Mac's memory, at most 8 GiB. Neither is a setting. A workspace's command is already bounded at 2 GiB and 2 CPUs (`src/runtime/workspace.ts`), so 8 GiB runs several heavy commands at once beside idle agents.

### Uninstall

On macOS, `jen uninstall` stops the machine and deletes `~/.jen/machines/<name>/`. That folder holds every container, volume, network, image and setting jen has, so nothing is removed one by one. It then removes the package as today. On Linux it's unchanged.

### Checkouts and checks

- **A checkout on macOS** builds the machine with `docker build --target machine --output dist/machine .`, using any engine, and `jen` uses `dist/machine/` in place of the platform package. Its images go into the machine's engine with `DOCKER_HOST=unix://$HOME/.jen/machines/jen/engine.sock docker build ...`, using any `docker` command.
- **The machine's live check** (`src/cli/machine.live.test.ts`) runs only on an Apple silicon Mac. It starts a machine under a name of its own and checks that:
  - the engine answers within the 60 seconds
  - a container published on `127.0.0.1` answers on the Mac
  - the machine stops and starts again with its data kept
  - the clock is right after a `pmset` sleep, by hand, since a check can't sleep the Mac reliably
- **The boundary check** runs against the machine by pointing `DOCKER_HOST` at its `engine.sock`. CI keeps running it on Linux.
- **The command's live check** runs the installed package on macOS through the machine.

Since CI can't start a VM on macOS, these run by hand on the maintainer's Mac for this change and for any later change to the machine, the supervisor or the release's machine build.

### Release

`release.yml` builds the `machine` target on an arm64 Linux runner, downloads vfkit's and Docker's pinned binaries and checks their checksums, and packs `@jen-ai/darwin-arm64` at the release's version. It publishes the platform package before `jen-ai`, so a published `jen-ai` never names a platform package that doesn't exist. The existing check before publishing, which installs the package and runs `jen help`, installs both. CI builds the `machine` target on every push, so a broken machine build fails before it reaches `main`.

## Risks / Trade-offs

- **vfkit may not behave as documented.** Its vsock connect mode, its time sync on wake or its signature could fall short. → Task 1 boots a machine with every option this design uses before anything is built on it. jen's own Swift launcher is the fallback, at the cost of signing.
- **Everything about the machine is checked by hand.** → The machine's live check makes the hand check one command. A change that touches the machine names that check in its pull request.
- **jen ships an OS.** A vulnerability in Alpine's kernel, Docker Engine or runc is jen's to release. → Alpine and Docker versions are pinned in the `Dockerfile`, and `tend` checks them each cycle.
- **A second VM beside Docker Desktop.** A user who keeps Docker Desktop pays for both VMs' memory. → Accepted: one engine path to test, and jen kept apart from the user's containers.
- **The supervisor can die and leave vfkit running**, with nothing mirroring ports. → `jen` treats an engine that answers on `engine.sock` with no supervisor holding `supervisor.pid` as orphaned. It stops that VM through `control.sock` and starts the machine again.

## Migration

A Mac user upgrading from a release that used Docker Desktop starts with an empty machine. Their roots, conversations and settings stay in Docker Desktop, where `jen` no longer looks. There's one user so far, the maintainer, so the release notes say to run the previous `jen uninstall` first, or to remove jen's containers and volumes from Docker Desktop by hand. Nothing migrates them.

## Open Questions

- Whether `@jen-ai` can be claimed on npm, or the platform package needs an unscoped name such as `jen-ai-darwin-arm64`. The maintainer checks when claiming it.
