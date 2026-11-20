# Proposal

## Why

jen runs only from a checkout of this repo: the user builds three images and puts `jen` on their path with `npm link`. [JEN-26](https://linear.app/reveer/issue/JEN-26) lets anyone with Node and Docker install jen from npm and use it from the terminal and the browser, with no clone. Once jen has users, every change that reaches `main` has to reach them too, so `main` becomes the release branch, and each merge releases jen without anyone doing it by hand.

## What Changes

- **jen ships as the npm package `jen-ai`, and its command is still `jen`.** The user installs it with `npm install -g jen-ai`. A plain `npm install jen-ai` puts no command on the path. The name was `jenai` until 2026-11-20. npm treats names that differ only in punctuation as one, so `jen-ai` also keeps `jenai` from anyone else.
- **The package ships compiled JavaScript.** Node refuses to strip types from TypeScript under `node_modules` (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`), so the published package can't run `src/` as a checkout does. A checkout still runs its TypeScript directly.
- **What a user needs, and what `jen` checks.** Node 26 or later, Docker with Engine 28.0 or later, and a key for a provider that serves OpenAI's Responses API. `jen` checks Node's version and the engine's itself, before it starts anything. Today it checks only that the engine answers, and npm only warns about `engines`.
  - **Docker that's missing or too old is named with its fix.** `jen` says what to install for the user's system, with its link or command, and that the engine must be 28.0 or later, rather than "Start Docker and try again."
  - **Docker that's installed but not running is started.** The first command that needs the engine starts Docker Desktop where it's installed, says so, and waits for the engine to answer, failing with how to start it by hand if it doesn't. A command that only stops things doesn't start Docker: with the engine down, nothing of jen's is running. Where `jen` can't start the engine itself, such as Docker Engine on Linux, which needs root, it says how.
- **The images are prebuilt and published to a registry.** Each release publishes the agent, runtime and workspace images to the GitHub Container Registry, `ghcr.io/reveer-ai`, for amd64 and arm64, tagged with the release's version. An installed `jen` uses the images of its own version and pulls any that are missing, showing that it's doing so. A checkout keeps using the images it builds, by name. Upgrading the package changes the tag, so the existing rule that a new image stops the agents on the old one carries every agent onto the upgrade at its next message.
- **Every merge to `main` that changes what ships releases jen.** What ships is the package and the images: `src/`, `package.json`, `package-lock.json` and the `Dockerfile`. A merge that changes only the record, docs, skills or OpenSpec releases nothing, since it would publish the same jen under a new version.
  - **The version lives in git tags.** CI reads the last `v*` tag and raises its patch number, or its minor or major number when the pull request is labelled `minor` or `major`. The first release is `0.1.0`. `package.json` gets the version only in the package CI publishes, so no release ever commits to `main`.
  - **The changelog is the merged pull requests' titles**, each linked to its pull request, which already read as what changed for the user. It's the GitHub release's notes, not a file in the repo.
  - **CI publishes the images, then the package to npm, then tags the merge and creates the GitHub release**, so a published package never names images that don't exist, and a tag always means a complete release. Nothing is released from anyone's machine. npm publishing uses trusted publishing, so no npm token is kept in the repo's secrets. The repo stays private, so npm attaches no provenance: it does so only for a public repo.
- **The package has a README**, which is its npm page: what jen is, what a user needs, how to install, use and uninstall it.
- **jen is free to use and proprietary.** The repo gains a `LICENSE` that lets anyone install and use jen for any purpose, at no cost, and reserves everything else to reveer: no copying, changing or redistributing its code, and no presenting it as one's own. It also disclaims warranty and liability. The package's `license` is `SEE LICENSE IN LICENSE`, npm's form for terms of its own. Publishing makes the code readable: the package holds the command's JavaScript, comments included, and the images hold `src/agent/` and `src/runtime/` as written, so the license is what protects it. Whether jen becomes open source is undecided.

*Alternative: build the images on the user's machine from a Dockerfile the package ships.* No registry to run, but the first command takes minutes, needs Docker Hub, Debian's mirrors and npm reachable from the user's machine, and two users can run different images under one version. Rejected by the maintainer on 2026-11-20.

*Alternative: release when someone pushes a tag or runs a workflow.* It lets changes collect into one release, but someone has to remember, and `main` drifts from what users run. Set by the maintainer: every merge releases.

*Alternative: Docker Hub.* It needs an account and a token of its own. GHCR is reached with the workflow's own token and sits beside the repo.

## Capabilities

### New Capabilities

- `jen-release`: how jen is versioned and released. What starts a release, how its version and changelog are chosen, and what it publishes where: the tag and GitHub release, the images and the npm package, and the order that keeps them consistent.

### Modified Capabilities

- `jen-command`: an installed `jen` uses its own version's images from the registry and pulls those missing, where today a missing image fails naming the command that builds it. `jen` checks Node's and the engine's versions before anything else, names what to install when Docker is missing or too old, and starts Docker Desktop when it's installed but not running. `jen uninstall` also removes the images it pulled. The live check also runs against the packed package, installed the way a user would.

## Impact

- **`package.json`:** the repo's stays `private`. The build generates the published one, named `jen-ai`, with the version, `bin` pointing at compiled JavaScript and no dependencies.
- **Build:** a step that compiles `src/cli/` and what it imports to JavaScript for the package. The images keep running `src/` as they do.
- **CLI code:** `src/cli/settings.ts` and `src/cli/runtime.ts` for the images' names and pulling, `src/cli/docker.ts` for the engine's version, starting Docker Desktop and `docker pull`, `src/cli/uninstall.ts` for the package's new name and pulled images, and a version check where `jen` starts.
- **CI:** a release workflow in `.github/workflows/` that runs on every push to `main`, beside today's `ci.yml`.
- **The maintainer, once:** claim `jen-ai` on npm under their account, set up its trusted publisher with direct publishing allowed, and make the three GHCR packages public. npm's documentation doesn't say whether a trusted publisher can be set up before a package exists, so the first publish may have to be by hand.
- **`LICENSE`:** new, at the repo's root and in the package.
- **Record:** `record/environment.md` gains how releases work, and `record/decisions.md` the decisions, superseding `jenai` in 2026-11-16's entry.
- **Docs:** `docs/architecture.html`, where the command gets its images.
