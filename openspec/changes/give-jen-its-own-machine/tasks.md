# Tasks

## 1. Prove the machine

- [x] 1.1 Boot a first machine end to end on this Mac before building anything on it:
  - a first `machine` target in the `Dockerfile` (Alpine's `linux-virt` kernel decompressed, an initramfs, a squashfs system disk with Docker Engine and socat)
  - a first `jen-machine` that boots it with a blank data disk, relays `engine.sock` over vsock and stops the guest on `SIGTERM`

  Verify that `DOCKER_HOST=unix://<folder>/engine.sock docker run --rm alpine echo ok` prints `ok`, that the data disk survives a stop and start, and that `SIGTERM` shuts Linux down within 30 seconds. Record in the design's Context the cold-start time to the engine answering, the platform package's packed size and the guest's shutdown.
- [x] 1.2 Sign 1.1's launcher ad hoc with the entitlement, pack it in a tarball shaped like the platform package, install it with `npm install -g` into a temporary prefix, and boot the machine from there. Verify it boots, and record in the design's Context whether the installed files carry `com.apple.quarantine`. If it fails, stop and bring it to the maintainer before going on.

## 2. The machine

- [x] 2.1 Finish the `machine` target in `src/machine/`:
  - Alpine and Docker Engine pinned
  - the initramfs formatting a blank data disk as ext4 and mounting it at `/var/lib/docker`
  - the root read-only with a tmpfs over it
  - OpenRC starting the engine on `/var/run/docker.sock` only
  - socat relays on vsock 2375, 2376 (refusing a first line that isn't a port from 1 to 65535), 2377 (setting the clock) and 2378 (shutting down)

  Verify with a check script run in the built system that nothing listens on the network, and by booting it with 1.1's launcher.
- [x] 2.2 Add `npm run build:machine`, which builds the `machine` target into `dist/machine/` and the launcher beside it, and a CI job that builds the target on every push. Verify by running it from a clean checkout and seeing the CI job pass on this branch.

## 3. The launcher

- [ ] 3.1 Write `jen-machine` in `src/machine/launcher/` as the design describes:
  - the VM with every core and half the memory up to 8 GiB
  - `engine.sock` readable only by the user
  - `launcher.pid` and `version`
  - the console in `console.log`
  - the clock set at the engine's first answer and on every wake
  - `SIGTERM`'s clean stop with the 30-second outright stop

  Verify with `swift test` unit tests for the resources' arithmetic and the clock's message, and by hand: `ls -l` on `engine.sock`, and `date` in the machine against the Mac's after a `pmset sleepnow` and wake.
- [x] 3.2 Mirror published ports: follow the engine's events through vsock 2375, and listen on the Mac's `127.0.0.1` for each running container's port published on `127.0.0.1`, carrying connections through vsock 2376, and closing the listener when the container stops. Verify with `swift test` against a stand-in event stream for start, stop and a port on another address, and by hand that a container published on `127.0.0.1:8081` answers on the Mac and stops answering once it's removed.
- [ ] 3.3 Add a CI job on a macOS runner that builds the launcher, signs it ad hoc with the entitlement and runs `swift test`. Verify it passes on this branch.

## 4. The command

- [ ] 4.1 On macOS, run the platform package's `bin/docker`, or a checkout's `dist/machine/docker`, with `DOCKER_HOST` set to the machine's `engine.sock`, overriding the user's environment. Refuse an Intel Mac. Fail a checkout without `dist/machine/` naming `npm run build:machine`. Keep Docker's checks, what to install, starting Docker Desktop and Engine 28.0, on Linux only. Verify with unit tests against a fake runner for each platform's path, the Intel refusal and the missing build.
- [ ] 4.2 Start the machine where an engine that doesn't answer used to start Docker Desktop:
  - a lock in the machine's folder, so two commands start one machine
  - a stale `launcher.pid` ignored
  - "starting jen's machine" said
  - a wait of up to 60 seconds, then a failure naming `console.log`
  - the stops starting nothing

  Verify with unit tests against a fake launcher, two concurrent starts included.
- [ ] 4.3 `jen stop all` stops the machine after the runtime. A machine whose `version` differs from the package's is upgraded: every agent is stopped through the runtime, the machine is stopped, and it starts on the new system. `jen uninstall` on macOS stops the machine and deletes its folder. Each runtime name gets its own folder under `~/.jen/machines/`. Verify with unit tests for each, and by hand with an upgrade from one built version to another with a root running.

## 5. The release

- [ ] 5.1 Pack `@jen-ai/darwin-arm64` (`os: darwin`, `cpu: arm64`) from the machine, the signed launcher and Docker's pinned macOS client, checked against its checksum, and give `jen-ai`'s generated `package.json` it as an optional dependency at the same version. Verify with unit tests of both manifests and the checksum's refusal, and by installing both packed tarballs into a temporary prefix on this Mac and running `jen help`.
- [ ] 5.2 Extend `release.yml`:
  - build the machine on an arm64 Linux runner, and the launcher on a macOS runner
  - pack the platform package
  - have the check before publishing install both packages
  - publish the images, the platform package, then `jen-ai`, keeping what a rerun already published

  Verify with `actionlint`, and against the `jen-release` spec's scenarios by reading the jobs' order and conditions.

## 6. Docs and record

- [ ] 6.1 Update `README.md`, removing Docker from macOS's requirements, saying jen needs an Apple silicon Mac there, and saying model calls don't go through a company's proxy or TLS inspection. Update `docs/architecture.html` for where agents run on a Mac, and `edda/environment.md` for `src/machine/`, the checkout's `npm run build:machine`, pointing `docker` at the machine with `DOCKER_HOST`, and that the machine's checks are a hand check on a Mac. Verify each command the README and `environment.md` show runs as written on this Mac.

## 7. Checks

- [ ] 7.1 Write `src/cli/machine.live.test.ts` as the `jen-machine` spec's live check requires, and make the command's live check run on macOS through a machine of its own. Verify by running both on this Mac.
- [ ] 7.2 Run `npm run check`, `npm test` and every live check with model credentials on this Mac, the boundary check with `DOCKER_HOST` pointed at a machine. Compare any failure with the known flakes in `edda/environment.md`. This change touches nothing under `src/agent/` or `src/runtime/`, so it needs no evaluation, and the pull request says so.
- [ ] 7.3 Review the implementation with `flo-review`.

## Workflow follow-up

- Before merging, the maintainer claims the `@jen-ai` scope on npm, or an unscoped name if it's taken, hand-publishes a placeholder of the platform package, and sets up its trusted publisher for `release.yml`.
- The first release's notes tell a Mac user to run the previous `jen uninstall` first, since roots in Docker Desktop don't move to the machine.
