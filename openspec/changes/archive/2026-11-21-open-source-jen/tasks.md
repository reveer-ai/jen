# Tasks

## 1. The license and what carries it

- [x] 1.1 Replace `LICENSE` with the Apache License 2.0 from `gh api licenses/apache-2.0 --jq .body`, unchanged, and add `NOTICE` as the design gives it.
- [x] 1.2 In `scripts/build.ts`, write `"license": "Apache-2.0"` and copy `NOTICE` with `README.md` and `LICENSE`. Update `scripts/build.test.ts` to expect both. Add `"license": "Apache-2.0"` to the repo's `package.json`.
- [x] 1.3 Add `NOTICE` to `SHIPS` in `scripts/release.ts`, and to the files `scripts/release.test.ts` checks ship.
- [x] 1.4 In the `Dockerfile`, copy `LICENSE` and `NOTICE` into `/app` in the agent and runtime stages. In `release.yml`, add `org.opencontainers.image.licenses=Apache-2.0` to the images' labels. Build both images and check the files are there.

## 2. The repo's front door

- [x] 2.1 Rewrite the `README`'s License section for Apache-2.0, and point to `CONTRIBUTING.md`.
- [x] 2.2 Write `CONTRIBUTING.md` and `SECURITY.md` as the design says.

## 3. The record

- [x] 3.1 In `record/decisions.md`, add today's decisions (Apache-2.0, the public repo, the two rulesets, fork workflow approval) and mark 2026-11-20's "The repo stays private" and the shipping list it gives superseded. In `record/environment.md`, say what ships now includes `NOTICE`, and add how the repo is protected: the rulesets, that a direct push is refused, and how to land a CI fix when CI is broken. In `record/conventions.md`, say that an outside pull request gets the maintainer's review, and runs CI only once they approve its workflows.
- [x] 3.2 Run `npm run check` and `npm test`.

## Workflow follow-up

- After the maintainer approves: make the repo public, apply the rulesets and settings, run the probes, merge through the ruleset and check the `0.1.1` release, its tag and its provenance, as the design's migration plan says.
