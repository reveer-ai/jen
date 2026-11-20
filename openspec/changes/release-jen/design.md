# Design

## Context

`jen` runs from a checkout: `package.json`'s `bin` points at `src/cli/main.ts`, `npm link` puts it on the path, and Node strips its types because the link resolves outside `node_modules` (`openspec/changes/archive/2026-11-19-add-jen-command/design.md`). It finds its three images by name, `jen-runtime`, `jen-agent` and `jen-workspace`, and fails naming the `docker build` for any that's missing (`src/cli/settings.ts`, `MissingImage`). Each image runs `src/` as TypeScript from `/app`, built by `Dockerfile`'s three targets. The repo's `package.json` is `private`, named `jen`, at version `0.0.0`, and the agent image installs its `dependencies` (`openai`). `src/cli/` imports nothing outside Node's built-ins at run time, and only types from `src/runtime/` and `src/agent/`.

Before anything else, every command runs `docker version` and fails with "Start Docker and try again" when the engine doesn't answer (`src/cli/docker.ts`, `ping`). A new image ID under an image's name stops every agent and restarts the runtime (`src/cli/runtime.ts`, `ensureRuntime`). `jen uninstall` removes the three images by their current names and runs `npm uninstall -g jenai` when its own file sits in the global npm folder's `jenai` package (`src/cli/uninstall.ts`).

CI (`.github/workflows/ci.yml`) runs on every push and pull request: typecheck, unit tests, the boundary check and the sandbox check. Nothing releases.

The repo is private. Its `origin` has no tags and no GitHub releases (checked on 2026-11-20). The maintainer's local clone holds tags `v0.1.0` to `v0.5.0` and three `backup/*` tags from an earlier jen, on commits outside `main`'s history.

See proposal.md for what a user needs and why the images come from a registry.

## Goals / Non-Goals

**Goals:**

- **One command installs jen, and the first `jen` command does the rest.** After `npm install -g jen-ai`, the user needs no checkout, no build and no `docker` command of their own.
- **What a release publishes is consistent.** A published package's images exist, and a tag and a GitHub release exist only for a version that's fully published.
- **A checkout works as it does today.** `npm link`, local images by name and the live checks are unchanged for whoever works on jen.

**Non-Goals:**

- Windows. jen still targets macOS and Linux.
- jen running its own VM with Docker in it, and a Homebrew formula (`record/ideas.md`).
- A `latest` tag, release channels or prereleases. `jen` always names its own version's images.
- Migrating an agent's stored state between versions, as JEN-25 left it.
- npm provenance, which a private repo doesn't get.

## Decisions

### What the package holds

The published package is built into `dist/`, never from the repo's own `package.json`, which stays `private` so `npm publish` from a checkout fails:

```text
dist/
  package.json   generated: name jen-ai, the version, bin, engines, type, repository, license
  README.md      the repo's README.md
  LICENSE
  cli/*.js       src/cli/ compiled, without tests and fakes
```

`npm run build` compiles with `tsc -p tsconfig.build.json`, which extends `tsconfig.json` with `noEmit: false`, `rewriteRelativeImportExtensions: true`, `outDir: dist` and only `src/cli/jen.ts` as its root, so tests and fakes, which nothing there imports, aren't in it. Measured on 2026-11-20 with TypeScript 7.0.2: compiling from `src/cli/main.ts` writes `src/cli/`'s modules as JavaScript with `./x.js` imports, keeping their comments, and none of them imports outside `cli/`. It also writes files from `src/runtime/` and `src/agent/` that `src/cli/` imports only types from, so the build copies only `dist/cli/` into the package's folder. The command's 9 modules come to 68 KB.

The generated `package.json` has no `dependencies`: the command needs none, and `openai` belongs to the agent image. `license` is `SEE LICENSE IN LICENSE`. `repository.url` is `git+https://github.com/reveer-ai/jen.git`, which npm's trusted publishing compares exactly with the repo the run comes from. The build takes the version as an argument, writes it into `package.json` and into `cli/release.js` (below), and refuses anything that isn't `x.y.z`.

*Alternative: publish the repo's `package.json`, made public.* Rejected: it would ship `openai` as a dependency of the command, `scripts` and `devDependencies`, and anyone could publish from a laptop.

*Alternative: bundle with esbuild.* One file instead of nine, but a new dependency, and `tsc` already emits what Node runs.

### Knowing its version

`src/cli/release.ts` exports `VERSION`, `undefined` in a checkout. The build overwrites `dist/cli/release.js` with the release's version. That one value decides everything that differs between a checkout and an installed `jen`:

| | Checkout (`VERSION` undefined) | Installed (`VERSION` = `0.1.0`) |
|---|---|---|
| Image names | `jen-runtime`, `jen-agent`, `jen-workspace` | `ghcr.io/reveer-ai/jen-runtime:0.1.0`, and so on |
| A missing image | fails naming its `docker build` | pulled |
| `jen uninstall` removes the command with | says `npm unlink -g jen` | `npm uninstall -g jen-ai` |

`JEN_RUNTIME_IMAGE`, `JEN_AGENT_IMAGE` and `JEN_WORKSPACE_IMAGE` still override the names either way, as the live checks use them. An image whose name was overridden is never pulled: it fails as a checkout's does.

*Alternative: read the version from the `package.json` beside the command.* A checkout's `package.json` sits at a different depth, is named `jen` and has a version that means nothing, so the code would have to tell them apart anyway.

### Checking Node before anything runs

The package's `bin` is `cli/jen.js`, compiled from a new `src/cli/jen.ts`. It reads `process.versions.node` and, below 26, prints `jen: jen needs Node 26 or later, and this is Node <version>. Install it from https://nodejs.org.` and exits 1. Otherwise it imports `./main.js` and calls its `start()`, which is today's `if (import.meta.main)` block. `jen.ts` uses no syntax or API newer than Node 18's, so an older Node reaches the message. Without it, `import.meta.main` is undefined below Node 24.2 and `jen` would exit silently. The repo's `bin` moves to `src/cli/jen.ts` too, so a checkout runs the same entry.

### Finding Docker, starting it and checking its version

`ping` becomes `ensureEngine`, in `src/cli/docker.ts`, and runs before every command except `help`, usage and the two stops:

1. **No `docker` command** (`spawn` fails with `ENOENT`): fail with what to install. On macOS, Docker Desktop, `https://docs.docker.com/desktop/setup/install/mac-install/`. On Linux, Docker Engine, `https://docs.docker.com/engine/install/`. Both say jen needs Engine 28.0 or later.
2. **The engine doesn't answer**: start Docker Desktop if it's installed, with `docker desktop start`, the Docker Desktop CLI (on this Mac on 2026-11-20). `jen` says `starting docker...` first. Where `docker desktop` isn't a command, it falls back on macOS to `open -a Docker` when the app is installed. Then it waits for `docker version` to answer, up to a fixed 120 seconds, checking every second. If it can't start the engine, or it doesn't answer in time, it fails saying how to start it by hand: Docker Desktop, or `sudo systemctl start docker` for Docker Engine on Linux, naming the current Docker context when it isn't `default` or `desktop-linux`, since then the engine is something else, such as Colima.
3. **The engine is older than 28.0**: fail naming its version and that jen needs 28.0 or later, with how to update. The version is `docker version --format {{.Server.Version}}`. A version that doesn't parse as `x.y` fails the same way, since an engine that isn't Docker's, such as Podman's, doesn't have the isolated gateway the agents' network needs.

`jen stop @<name>` and `jen stop all` call `ensureEngine` without starting Docker. When the engine doesn't answer, they print `docker isn't running, so nothing of jen's is.` and exit 0.

*Alternative: ask before starting Docker.* Rejected with the maintainer: the user just ran a command that needs it.

### Pulling the images

`images()` in `src/cli/runtime.ts`, which finds the three images' IDs before the runtime starts, pulls each missing registry image with `docker pull --quiet <image>`, after saying `pulling <image>...`. A checkout's names, or overridden ones, still fail with `MissingImage`. `jen config`'s check of the runtime's image, which it needs to write the settings, goes through the same path.

A pull that fails says why, from `docker pull`'s stderr, and stops the command. The images are public on GHCR, so no login is needed.

### Upgrading and removing old images

Upgrading the package changes `VERSION`, so the images' names change and their IDs differ from the containers'. `ensureRuntime`'s existing rule stops every agent and restarts the runtime on the new version, and each agent starts on its new image at its next message.

After that switch, `jen` removes every image of its three registry repositories whose tag isn't its own version: `docker image ls --filter reference=ghcr.io/reveer-ai/jen-*` lists them. Docker refuses to remove an image a container still uses, and `jen` passes over that refusal. The workspace image alone is several hundred megabytes, so without this every upgrade leaves a full set behind.

`jen uninstall` removes the same list as well as the images under its current names, so a set an earlier version left is removed too. It runs `npm uninstall -g jen-ai`, the package's new name.

### The release

A new workflow, `.github/workflows/release.yml`, runs on every push to `main`, one at a time (`concurrency: release`, never cancelled), so releases happen in merge order:

1. **`ci`:** today's checks, by calling `ci.yml`, which gains `workflow_call`. `ci.yml`'s own `push` trigger skips `main`, so `main` isn't checked twice.
2. **`plan`:** `node scripts/release.ts plan` decides whether to release, the version and the notes, from git and the GitHub API, and passes them on as outputs. Its rules are below.
3. **`images`:** only if `plan` released. Builds the three targets for `linux/amd64` and `linux/arm64` with Docker Buildx and QEMU, labelled `org.opencontainers.image.source=https://github.com/reveer-ai/jen` so GHCR ties each package to the repo, and pushes them as `ghcr.io/reveer-ai/jen-<target>:<version>`. It needs `packages: write`.
4. **`publish`:** `npm run build -- <version>`, then a smoke check: `npm pack` the package, install it globally into a temporary prefix and run `jen help`, which proves the compiled command runs from `node_modules`, the failure that started this. Then `npm publish ./dist --access public` through trusted publishing (`id-token: write`, npm 11.5.1 or later), then the tag `v<version>` on the merge and a GitHub release with the notes (`contents: write`).

The tag comes last, so a tag always means a complete release, and the next run's "last release" is the last one that finished. A run that failed is rerun from GitHub: images are pushed again under the same tag, a version npm already has from the same commit (its `gitHead`) isn't published again, and a tag that exists isn't made again. A version npm has from a different commit fails the run.

#### How `plan` decides

- **The last release** is the highest `v<x.y.z>` tag reachable from the merge. With none, the release is `0.1.0`.
- **What ships** is the commits since then that touch `src/` (except `*.test.ts`), `package.json`, `package-lock.json`, `Dockerfile`, `README.md` or `LICENSE`, found with `git log <tag>..HEAD -- <paths>`. With none, nothing is released, and the run says so. `README.md` and `LICENSE` count because they're in the package and its npm page.
- **The bump** is the largest among those commits' pull requests' labels: `major`, then `minor`, and `patch` without either. Each squash-merged commit's subject ends with `(#<number>)`, and its labels come from the GitHub API. A commit with no pull request bumps `patch`.
- **The notes** are those commits' subjects, one line each. GitHub links each `#<number>` to its pull request in a release's notes.

The rules are in `scripts/release.ts`, a TypeScript script Node runs directly, with unit tests beside it against fakes of `git` and the API. `tsconfig.json` and `vitest.config.ts` gain `scripts/`.

*Alternative: `semantic-release` or `release-please`.* Both read Conventional Commits (`feat:`, `fix:`), which jen's titles aren't, and `release-please` commits a version bump to `main`, which the maintainer rejected.

*Alternative: GitHub's generated release notes.* They list every pull request since the last tag, record and skill changes included.

*Alternative: native arm64 runners instead of QEMU.* Faster, but whether GitHub's arm64 runners are offered for a private repo on this plan is unchecked. QEMU works on any runner. Switching later changes only the `images` job.

### The README

`README.md` at the repo's root is the package's npm page and the repo's front page. It says what jen is, what a user needs (Node 26, Docker with Engine 28.0, a key for a provider that serves the Responses API, such as OpenAI or OpenRouter), how to install, a first session (`jen new`, a query, `jen @<name> open`), that `jen help` lists the commands, the `noglob` alias for zsh, that `jen uninstall` is how to remove jen, and the license in a line. It points at `jen help` rather than repeating the commands.

### Checks

- **Unit tests** for `release.ts`'s plan, `ensureEngine`'s three cases and the stops without an engine, pulling, the image names for each `VERSION`, removing old images, and uninstall's package name.
- **The `jen` live check** runs the command as a user installs it: it builds and packs the package at a test version, installs it globally into a temporary npm prefix, and spawns that `jen` instead of `src/cli/main.ts`. Its image names stay overridden with its own tags, so it pulls nothing. `jen config` and `jen uninstall` still run in-process, from source, since they need a terminal.
- **The release's smoke check** above, on every release.
- **By hand, once, after the first release:** on a Mac with no checkout of jen on the path, `npm install -g jen-ai`, then `jen new`, a query, `jen @<name> open` in the browser, and `jen uninstall`. That's JEN-26's done-when, and only a published package can show it.

## Risks / Trade-offs

- **The first release can't be checked before it's published.** The smoke check and live check run what will ship, but pulling from GHCR and installing from npm are checked only by the hand check after `0.1.0`. A fault there means a quick `0.1.1`.
- **`docker desktop start` is measured only on this Mac.** On Linux, Docker Desktop's CLI is the same, but unmeasured. A failure there falls through to saying how to start Docker by hand.
- **A version npm has from a different commit stops releases** until it's sorted by hand. It needs a run that published to npm and then failed to tag, followed by another merge before a rerun. Rerunning a failed release promptly avoids it.
- **QEMU makes the arm64 workspace image slow to build**, perhaps ten minutes or more per release, since `apt-get` runs emulated.
- **Removing old images can take an image another runtime name uses.** Only the live checks use other names, and they use their own local tags, never the registry's.
- **Pushing the local `v0.1.0` to `v0.5.0` tags would break versioning.** The next release would read `v0.5.0` as the last one. The maintainer may want to delete them locally. Nothing in jen pushes tags but the release.

## Migration Plan

Before the first merge with this change, the maintainer, once:

1. Claims `jen-ai` on npm with a hand-published placeholder, `0.0.0`, whose README says jen is coming. npm's documentation doesn't say whether a trusted publisher can be set up before a package exists, and a placeholder settles it.
2. Adds the trusted publisher on npmjs.com: the `reveer-ai/jen` repo, the `release.yml` workflow, with direct publishing allowed, since a publisher set up after 2026-09-03 allows only staged publishing by default. Its first publish must come within 2 days, or the setup expires.
3. After the first release, makes the three GHCR packages public, which needs the `reveer-ai` organization to allow public packages.

The merge that lands this change is the first release, `0.1.0`, since it touches `src/`. If step 2 isn't done, `publish` fails after the images are pushed, and a rerun finishes the release.

## Open Questions

None.
