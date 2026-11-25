# Design

## Context

On macOS, `jen` runs the user's `docker` command against Docker Desktop (`src/cli/docker.ts`). It starts Docker Desktop when the engine doesn't answer and checks that the engine is 28.0 or later. An installed `jen` pulls its version's three images from GHCR (`openspec/specs/jen-command/spec.md`). Everything else `jen` does, such as the settings volume, starting the runtime, reading its token and removing old images, goes through `docker` commands. The runtime reaches its engine only through the socket (`src/runtime/docker.ts`), and agents and workspaces run only as containers on that engine.

Measured on 2026-11-24 on the maintainer's Mac (Apple silicon, macOS 27.0.1, 24 GiB):

- **The three images, saved together and gzipped, come to 142 MB.** They share `node:26-slim`'s layers. Uncompressed they're 375 MB, 425 MB and 582 MB.
- **A binary signed ad hoc, with no Apple Developer ID, can start a VM** once it carries the `com.apple.security.virtualization` entitlement. Without the entitlement, Virtualization.framework refused the configuration, naming the missing entitlement. With it, a 30-line Swift program booted Alpine's `linux-virt` kernel for arm64, decompressed from its EFI image, until it panicked at 0.038 seconds for lack of a root disk, as expected. The binary was built locally, so it wasn't flagged as downloaded from the web, as files npm unpacks aren't either, and macOS ran no notarization check.
- **GitHub's hosted Apple silicon runners can't start a VM.** Community reports and actions that depend on it agree that the runners lack nested virtualization. GitHub doesn't document it. They can build and sign Swift, which needs no VM.

Measured on 2026-11-24 on the same Mac, booting task 1.1's machine (Alpine 3.24.4, kernel 6.18.65, Docker Engine 29.9.3) with its launcher:

- **The engine answers 7.7 seconds after the launcher starts on a first boot**, which formats the data disk, and 3.2 seconds after on a later one. Linux reaches the initramfs in 0.09 seconds.
- **The guest ignores Virtualization.framework's stop request.** The VM's device tree offers a power button through gpio-keys, but Alpine's virt kernel has no driver for it (`CONFIG_INPUT_KEYBOARD` is unset). Asked through vsock instead, Linux shuts down in 4.3 seconds, unmounting the data disk first.
- **The VM has a real-time clock** (PL031), which Linux reads at boot, so the clock is wrong only after the Mac sleeps.
- **The platform package packs to 108 MB**, 157 MB unpacked: the system disk is 78 MB, the kernel 36 MB uncompressed, Docker's client 42 MB, the initramfs 1.3 MB and the launcher 0.15 MB.
- **Files `npm install -g` unpacks carry no `com.apple.quarantine`**, only `com.apple.provenance`, so Gatekeeper never assesses the launcher, whose ad hoc signature `spctl` would reject. The launcher, signed with the entitlement and packed, booted the machine from a temporary prefix. That install was from a local tarball; npm downloads from the registry with Node, which sets no quarantine either, and the command's live check runs from an installed tarball too.

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
vmlinuz      Alpine's virt kernel, decompressed, since Virtualization.framework boots only an uncompressed arm64 kernel
initramfs    mounts the system disk read-only with a tmpfs over it, and the data disk at /var/lib/docker
system.img   squashfs: Docker Engine, containerd, runc, socat, OpenRC, and the guest's relays
```

The launcher boots the kernel directly, with no firmware or bootloader, which is the shortest boot. The system disk is squashfs, so it ships compressed, mounts without unpacking and can't be changed. An upgrade replaces it whole. The data disk, `data.img`, is a sparse 64 GiB file that the launcher creates on first start. The initramfs formats it as ext4 when it's blank. It holds `/var/lib/docker`, so images, volumes (agents' state, workspaces, the settings) and containers outlive versions, just as they outlive Docker Desktop updates today.

The engine listens only on `/var/run/docker.sock` inside the machine. Nothing in the machine listens on its network. Four vsock ports, the VM's socket channel to the Mac, each run a socat relay:

| Port | In the machine, each connection goes to |
|---|---|
| 2375 | the engine's `/var/run/docker.sock` |
| 2376 | `127.0.0.1:<port>`, where `<port>` is the connection's first line, refused unless it's a number from 1 to 65535 |
| 2377 | a script that sets the clock to the Unix time in the connection's first line |
| 2378 | `poweroff`, since the kernel has no driver for the VM's power button |

*Alternative: bake the three images into the system disk*, as first proposed. The engine would have to load them on the first boot of each version, which is a second way images arrive, beside the pull an installed `jen` already does on Linux, and it would roughly triple the machine's size. Instead the machine's engine pulls from GHCR exactly as it does on Linux, and the existing rules for pulling, showing progress and removing old versions' images apply unchanged.

*Alternative: Debian with systemd.* It's familiar, but several times the size, for nothing the machine needs.

### Where the machine comes from: a platform package

The machine ships in `@jen-ai/darwin-arm64`, an npm package that `jen-ai` lists in `optionalDependencies` at its own version, with `os: darwin` and `cpu: arm64`. npm installs it only on an Apple silicon Mac. It holds the three machine files, jen's launcher and Docker's static `docker` command for macOS:

```text
@jen-ai/darwin-arm64/
  machine/vmlinuz, machine/initramfs, machine/system.img
  bin/jen-machine   jen's launcher, signed ad hoc with the virtualization entitlement
  bin/docker        Docker's static macOS client, pinned and checked against its checksum
```

Nothing runs at install, and the first command needs nothing downloaded beyond the images. The package packs to 108 MB (see Context).

*Alternative: download the machine on the first command, from the GitHub release.* No large npm package, but a second host and a download path of jen's own, with its own progress and checks. With the images out of the machine, it's small enough for npm.

### `jen` keeps running `docker`, and on macOS brings its own

On macOS, `jen` runs the package's `bin/docker` with `DOCKER_HOST=unix://<machine>/engine.sock`. It ignores the user's `DOCKER_HOST`, contexts and any Docker Desktop. On Linux it runs the user's `docker` as today. Every command `jen` sends is the same on both, so `src/cli/` changes only in where its `Runner` finds `docker` and what it does when the engine doesn't answer.

*Alternative: talk to the Engine API directly*, as first proposed. One less binary (Docker's client is about 40 MB unpacked), but it rewrites every `docker run` and `docker exec` `jen` sends into create, attach and start calls, and breaks Linux users who rely on a Docker context. The bundled client changes none of that.

### The launcher: `jen-machine`, one process that is the machine

`jen-machine` is a Swift program, in `src/machine/launcher/`, built against Virtualization.framework. The VM runs inside its process: while it runs, the machine runs, and when it exits, for any reason, the machine is gone. `jen` starts it detached from the terminal, so it outlives the command. It:

- **runs the VM** with the kernel, the initramfs, the system disk read-only, the data disk, NAT networking, an entropy device, a vsock device, the console written to `console.log`, every core the Mac has, and the memory below
- **relays the engine.** It listens on `engine.sock` in the machine's folder, a Unix socket only the user can open, and carries each connection to vsock port 2375.
- **mirrors published ports.** It follows the engine's events through port 2375. For every running container with a port published on `127.0.0.1`, it listens on the same port on the Mac's `127.0.0.1` and carries each connection through port 2376. That keeps the `jen-command` requirement that the runtime is published only on `127.0.0.1` true on the Mac. It also covers any runtime, whatever its name, including the live checks' and evaluations' when they're pointed at the machine.
- **sets the clock** through port 2377: once its relay first answers, before the launcher serves `engine.sock`, so nothing reaches the engine with a wrong clock, and whenever macOS says the Mac woke.
- **stops cleanly** on `SIGTERM`. It asks the guest to shut down through port 2378, and stops the VM outright after 30 seconds.

Its files live in `~/.jen/machines/<runtime name>/`: the data disk, `engine.sock`, `launcher.pid`, locked while the launcher runs, `version` (the system disk it booted, a hash of the machine's three files) and `console.log`, where the launcher's own messages go too. `jen` adds `start.lock` while it starts the machine, and `docker/`, the `DOCKER_CONFIG` of the `docker` it runs there. Short paths matter here, since macOS caps a Unix socket's path at 104 bytes. A runtime name of its own, such as a live check's `jen-live-<hex>`, gets a machine of its own, so a check's `jen uninstall` never deletes the user's machine.

*Alternative: vfkit*, Red Hat's launcher, which Podman uses on macOS, run by a Node supervisor of jen's that mirrors ports. It brings Podman's testing across macOS versions, but two processes on the Mac, a supervisor and vfkit, either of which can die and leave the other running, and a 10–20 MB third-party binary whose options this design would depend on unverified. It was chosen at first for its signature, until the measurement above showed jen can sign its own. Rejected by the maintainer on 2026-11-24.

*Alternative: publish the runtime on the machine's NAT address instead of mirroring ports.* That needs no mirroring, but the UI's URL would be an address that changes, reachable by anything on the Mac's VM network, and the `127.0.0.1` requirement would no longer mean anything on a Mac.

### Starting, stopping and upgrading

- **Start.** Before the first `docker` call, `jen` checks the engine through `engine.sock`. If it doesn't answer, `jen` takes a lock in the machine's folder, starts `jen-machine`, says it's starting jen's machine, and waits up to 60 seconds for the engine. A second `jen` that finds the lock waits for the same engine. A `launcher.pid` that no running `jen-machine` holds, as after a reboot or a crash, is stale and ignored.
- **Stop.** `jen stop all` stops every agent and the runtime as today, then sends `SIGTERM` to `jen-machine` and waits for it to exit. `jen stop @<name>` leaves the machine running.
- **Upgrade.** When `version` names a different system disk from the package's, the next command that needs the engine:
  1. stops every agent through the runtime, as the existing rule for a new image does
  2. stops the machine
  3. starts it on the new system disk

  The runtime then starts on the new version's images, which the engine pulls.
- **Mac sleep and reboot.** Sleep pauses the VM, and the launcher sets its clock on wake. A reboot ends the launcher, so the next command starts the machine again.

### Resources

The machine gets every core the Mac has, since idle virtual CPUs cost nothing, and half the Mac's memory, at most 8 GiB. Neither is a setting. A workspace's command is already bounded at 2 GiB and 2 CPUs (`src/runtime/workspace.ts`), so 8 GiB runs several heavy commands at once beside idle agents.

### Uninstall

On macOS, `jen uninstall` stops the machine and deletes `~/.jen/machines/<name>/`. That folder holds every container, volume, network, image and setting jen has, so nothing is removed one by one. It then removes the package as today. On Linux it's unchanged.

### Checkouts and checks

- **A checkout on macOS** builds the machine with `docker build --target machine --output dist/machine .`, using any engine, and the launcher with `swiftc`, through `npm run build:machine`. `jen` then uses `dist/machine/` in place of the platform package. Its images go into the machine's engine with `DOCKER_HOST=unix://$HOME/.jen/machines/jen/engine.sock docker build ...`, using any `docker` command.
- **The launcher's unit tests** cover what needs no VM, such as the port relay's first line and the mirroring's response to the engine's events, with `swift test`, in a CI job on a macOS runner.
- **The machine's live check** (`src/cli/machine.live.test.ts`) runs only on an Apple silicon Mac. It starts a machine under a name of its own and checks that:
  - the engine answers within the 60 seconds
  - a container published on `127.0.0.1` answers on the Mac
  - the machine stops and starts again with its data kept
  - the clock is right after a sleep, by hand, since a check can't sleep the Mac reliably
- **The boundary check** runs against the machine by pointing `DOCKER_HOST` at its `engine.sock`. CI keeps running it on Linux.
- **The command's live check** runs the installed package on macOS through the machine.

Since CI can't start a VM on macOS, these run by hand on the maintainer's Mac for this change and for any later change to the machine, the launcher or the release's machine build.

### Release

`release.yml`:

1. builds the `machine` target on an arm64 Linux runner
2. builds `jen-machine` on a macOS runner and signs it ad hoc with the entitlement
3. downloads Docker's pinned client and checks its checksum
4. packs `@jen-ai/darwin-arm64` at the release's version

It publishes the platform package before `jen-ai`, so a published `jen-ai` never names a platform package that doesn't exist. The existing check before publishing, which installs the package and runs `jen help`, installs both. CI builds the `machine` target and the launcher on every push, so a broken build fails before it reaches `main`.

## Risks / Trade-offs

- **The launcher is Swift jen owns, tested on a VM only by hand.** How the guest answers a shutdown request, and whether the clock holds across sleep, are behaviors of Virtualization.framework that no CI run sees. → Task 1 boots the machine with the launcher's VM configuration, a relayed engine and a clean shutdown before anything else is built on it. The machine's live check makes every later hand check one command, and a change that touches the machine names that check in its pull request.
- **Signing ad hoc is measured only from a local build.** → Task 1 also runs the launcher from a package installed with `npm install -g`, the way a user gets it.
- **jen ships an OS.** A vulnerability in Alpine's kernel, Docker Engine or runc is jen's to release. → Alpine's and Docker's versions are pinned in the `Dockerfile`, and `tend` checks them each cycle.
- **A second VM beside Docker Desktop.** A user who keeps Docker Desktop pays for both VMs' memory. → Accepted: one engine path to test, and jen kept apart from the user's containers.
- **The launcher can crash.** The VM then stops as if its power were cut. → ext4's journal and SQLite already survive that, and the next command starts the machine again.

## Migration

A Mac user upgrading from a release that used Docker Desktop starts with an empty machine. Their roots, conversations and settings stay in Docker Desktop, where `jen` no longer looks. There's one user so far, the maintainer, so the release notes say to run the previous `jen uninstall` first, or to remove jen's containers and volumes from Docker Desktop by hand. Nothing migrates them.

## Open Questions

- Whether `@jen-ai` can be claimed on npm, or the platform package needs an unscoped name such as `jen-ai-darwin-arm64`. The maintainer checks when claiming it.
