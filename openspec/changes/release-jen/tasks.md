# Tasks

## 1. The package

- [x] 1.1 Add `src/cli/release.ts`, exporting `VERSION` as `undefined`, and `src/cli/jen.ts`, which refuses Node below 26 with the design's message and otherwise imports `./main.ts` and calls its `start()`, today's `if (import.meta.main)` block. Point the repo's `bin` at `src/cli/jen.ts`. Verify with unit tests for the Node check, with a version below 26 and with 26, and by running `jen help` from the re-linked checkout.
- [x] 1.2 Add `tsconfig.build.json` and `scripts/build.ts`, run as `npm run build -- <version>`: compile from `src/cli/jen.ts` and write `dist/` as the design lays out, with the generated `package.json` (no dependencies, `SEE LICENSE IN LICENSE`, `repository.url` `git+https://github.com/reveer-ai/jen.git`), `cli/release.js` holding the version, `README.md` and `LICENSE`, refusing a version that isn't `x.y.z`. Add `scripts/` to `tsconfig.json` and `vitest.config.ts`. Verify with unit tests of the manifest, the stamped version and the refusal, and by `npm pack ./dist`, installing the tarball into a temporary prefix and running `jen help` from it.
- [x] 1.3 Write `README.md` as the design describes, and verify each command it shows runs as written from the package installed in 1.2.
- [x] 1.4 Update `record/environment.md`: the build, that a checkout linked before this change re-runs `npm link`, and the new `src/cli/` entry. Verify by re-running `npm link` here and checking `jen` resolves to `src/cli/jen.ts`.

## 2. Docker

- [x] 2.1 Replace `ping` with `ensureEngine` in `src/cli/docker.ts`: name what to install when `docker` is missing, start Docker Desktop with `docker desktop start --detach` or `open -a Docker` and wait up to a fixed 120 seconds when the engine doesn't answer, saying how to start it by hand otherwise, and refuse an engine below 28.0 or one whose version doesn't parse. Verify with unit tests for each case against a fake runner.
- [x] 2.2 Make `jen stop @<name>` and `jen stop all` check the engine without starting it, and say nothing of jen's is running when it's down. Verify with unit tests that neither starts Docker and both exit 0.
- [x] 2.3 Measure starting Docker on this Mac: quit Docker Desktop, run `jen list`, and see it start Docker and list. Record what was measured in the design's Risks.

## 3. Images

- [x] 3.1 Name the images from `VERSION` in `namesFrom`, registry names with the version when installed and today's names in a checkout, with the environment overriding either. Verify with unit tests for each.
- [x] 3.2 Pull a missing registry image in `images()`, saying so, and fail with Docker's reason when the pull fails. Keep `MissingImage` for a checkout's and an overridden name. Verify with unit tests, `jen config`'s path included.
- [x] 3.3 After `ensureRuntime` moves everything onto new images, remove the registry images of other versions, passing over Docker's refusal for one in use. Make `jen uninstall` remove those as well as the current names, and uninstall `jen-ai`. Verify with unit tests, and measure on real Docker that `docker image ls --filter reference=ghcr.io/reveer-ai/jen-*` lists images of all three repositories.
- [x] 3.4 Update the `jen` sections of `docs/architecture.html` for where an installed `jen` gets its images and how an upgrade reaches the agents. Verify by opening the page.

## 4. The release

- [x] 4.1 Write `scripts/release.ts plan`: the last `v<x.y.z>` tag reachable from `HEAD`, the commits since that change what ships, the bump from their pull requests' labels, the version and the notes, printed as the workflow's outputs. Verify with unit tests against fakes of `git` and the GitHub API for every scenario in the `jen-release` spec's version, notes and what-ships requirements.
- [x] 4.2 Write `.github/workflows/release.yml` with the `ci`, `plan`, `images` and `publish` jobs the design describes: `concurrency: release` without cancelling, Buildx and QEMU for both platforms, the smoke check, `npm publish ./dist --access public` through trusted publishing, a version npm has from the same commit kept, and the tag and GitHub release last. Give `ci.yml` `workflow_call` and skip `main` in its `push` trigger. Verify with `actionlint`, and by checking the `plan` job's output on this branch by hand with `node scripts/release.ts plan`.
- [x] 4.3 Add how releases work to `record/environment.md`: what ships, the labels, rerunning a failed release, the maintainer's one-time setup, and that the local `v0.1.0` to `v0.5.0` tags must never be pushed. Verify against the workflow as written.

## 5. The live check

- [x] 5.1 Make the `jen` live check build and pack the package at a test version, install it into a temporary npm prefix and spawn that `jen`, and run `jen uninstall` in-process with the installed `cli/main.js` as `mainPath` and `npm_config_prefix` set, checking the package is gone from the prefix. Verify by running it with model credentials.

## 6. Checks

- [x] 6.1 Run `npm run check`, `npm test` and every live check with model credentials, and compare any failure with the known flakes in `record/environment.md`.
- [ ] 6.2 Review the implementation with `review-change` until a re-review finds nothing new.

## Workflow follow-up

- Before merging, the maintainer hand-publishes a `0.0.0` placeholder of `jen-ai` and sets up its trusted publisher for `release.yml`, with direct publishing allowed, within 2 days of the merge.
- The merge releases `0.1.0`. The maintainer then makes the three GHCR packages public.
- On a Mac with no checkout on the path: `npm install -g jen-ai`, `jen new`, a query, `jen @<name> open` in the browser and `jen uninstall`. That's JEN-26's done-when.
