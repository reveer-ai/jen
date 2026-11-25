# Proposal

[JEN-31](https://linear.app/reveer/issue/JEN-31)

## Why

On a Mac, jen needs Docker Desktop: a separate product the user installs, keeps running and updates, with a paid subscription for larger companies. The maintainer set the goal on 2026-11-22: installing jen takes one command, `npm install -g jen-ai`, and jen brings everything it runs on, so a user never installs or manages Docker.

## What Changes

- **On an Apple silicon Mac, jen brings its own machine.** It's a small Linux VM with Docker Engine in it, and its only job is to give jen an engine. The runtime and agents run in it exactly as they run on any Docker engine today, so nothing under `src/runtime/` or `src/agent/` changes. jen never uses Docker Desktop, even where it's installed, which keeps jen apart from the user's other containers and leaves one path to test. Intel Macs aren't supported: macOS 26 was the last release for them.
- **The machine ships in the npm package.** Each release builds it and publishes it in a platform package that npm installs only on an Apple silicon Mac, beside the launcher and Docker's own `docker` command. Nothing runs at install time, since npm hides install scripts' output and pnpm and bun don't run them. Nothing is provisioned on the Mac either. The machine's engine pulls jen's images from GHCR, exactly as an installed `jen` already does on Linux.
- **jen starts the machine natively, through Apple's Virtualization.framework, with a launcher of its own.** `jen-machine` is a small Swift program that runs the VM inside its own process and keeps running after `jen` exits, so the machine runs exactly as long as the launcher does. The machine boots its kernel straight into Docker Engine, with no SSH server and no setup at boot. The engine's socket and every port the engine publishes on `127.0.0.1` reach the Mac over the VM's socket channel (vsock). The machine's clock is reset when the Mac wakes.
- **`jen` keeps running the `docker` command.** On macOS it runs the one it brings, pointed at the machine. On Linux it runs the user's, as today. Every command `jen` sends to the engine is unchanged.
- **`jen` runs the machine the way it runs the runtime today.** The first command that needs the engine starts the machine and waits for its engine. `jen stop all` stops the runtime and then the machine. `jen uninstall` deletes the machine, which holds everything of jen's. The machine's memory and CPU are fixed by jen, not settings.
- **An upgrade replaces the machine's system and keeps its data.** Agents' volumes, jen's images and its settings live on a data disk that outlives versions, and the system disk is replaced by the new version's. The machine's agents stop cleanly before it restarts on the new system.
- **The machine shares nothing from the Mac.** No folders are mounted, and only the engine's socket and the ports published on `127.0.0.1` cross, both reachable only from the Mac itself. Docker Desktop, by contrast, mounts the user's home folder by default.
- **Linux keeps the Docker Engine the user installs.** A Linux server, which is where jen's hosting will run, often can't run a VM inside itself. Hosting may later boot this same machine as each account's VM, but this change builds none of that.

*Alternative: Lima*, the path the maintainer favored on 2026-11-20. Provisioning a generic distro would install Docker on first boot, taking minutes and needing package mirrors reachable, the reason the 2026-11-20 decisions rejected building images on the user's machine. Even booting jen's prebuilt image, Lima is built for a VM people work in. It needs cloud-init and an SSH server in the machine, waits for both at every start, and runs a host agent of its own on the Mac. Of what it offers, jen would use only the VM's lifecycle, two forwards and clock sync, which a native launcher does without the rest. Rejected by the maintainer on 2026-11-24.

*Alternative: vfkit*, Red Hat's launcher, which Podman uses on macOS. It brings Podman's testing, but needs a supervisor of jen's beside it to mirror ports, two processes either of which can die and leave the other running. It also adds a third-party binary of 10–20 MB. It was chosen at first for its signature, until a binary signed ad hoc, with no Apple Developer ID, was measured to start a VM on 2026-11-24. Rejected by the maintainer the same day.

*Alternative: no Docker at all*, with a lightweight VM per agent through Apple's Containerization framework. It would give each workspace a kernel of its own (an idea in `ideas.md`), but replaces the runtime's engine with one adapter per OS and redoes the boundary on each.

*Alternative: use Docker Desktop when it's installed, and the machine otherwise.* It saves the second VM's memory for Docker Desktop users, but leaves two paths to test and shares an engine with the user's other containers.

## Capabilities

### New Capabilities

- `jen-machine`: jen's own Linux machine on an Apple silicon Mac. What it holds and where it comes from, how `jen` starts, stops, upgrades and removes it, what crosses to the Mac and what doesn't, its clock across sleep, and its fixed resources.

### Modified Capabilities

- `jen-command`: on macOS the engine is jen's machine and the `docker` command is jen's own. Docker Desktop's checks (naming what to install, starting it, its engine's version) apply only on Linux. `jen stop all` also stops the machine, and `jen uninstall` removes it. The live check covers the machine on macOS.
- `jen-release`: a release also builds the machine and publishes the Apple silicon platform package, before `jen-ai`. `jen-ai` gains it as an optional dependency, where today it has no dependencies.

## Impact

- **CLI code:** `src/cli/docker.ts` finds `docker` in the platform package on macOS and starts the machine where it used to start Docker Desktop. A new module starts, stops and upgrades the machine. `src/cli/uninstall.ts` deletes the machine on macOS.
- **The machine, in a new `src/machine/`:** the launcher in Swift, which is new to the repo. Also a `machine` target in the `Dockerfile` that builds Alpine's kernel, an initramfs and a read-only system disk, with small relays in it for the engine's socket, published ports, the clock and shutting down.
- **A third-party binary in the package:** Docker's static `docker` command for macOS, pinned and checked against its checksum.
- **Release:** `.github/workflows/release.yml` builds the machine on an arm64 Linux runner and the launcher on a macOS runner, signed ad hoc, and publishes the platform package before `jen-ai`. CI builds both, and runs the launcher's unit tests, on every push.
- **Checks:** GitHub's hosted Apple silicon runners can't start a VM, though they can build and sign Swift. So the machine's live check, and the boundary and command checks run against the machine, are a hand check on the maintainer's Mac for this change and any later one that touches the machine.
- **The maintainer, once:** claim the platform package's name on npm, with its trusted publisher.
- **Migrating:** a Mac user's roots stay in Docker Desktop, where `jen` no longer looks. The maintainer is the only user, so the release notes say how to clear them, and nothing migrates.
- **Record:** `decisions.md` supersedes 2026-11-20's "jen keeps Docker as a requirement" for macOS, `environment.md` gains the machine and how a checkout builds it, and `README.md` drops Docker from macOS's requirements. The README also says that model calls don't go through a company's proxy or TLS inspection, which is already true today: the runtime ignores proxy settings, and containers don't trust the Mac's certificates.
- **Docs:** `docs/architecture.html`, where agents run on a Mac.
