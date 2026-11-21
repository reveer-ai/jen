# Proposal

[JEN-28](https://linear.app/reveer/issue/JEN-28)

## Why

jen's repo is private, and its license lets anyone use jen but forbids copying or changing its code (2026-11-20's "The repo stays private, and jen is free to use but proprietary"). The maintainer wants jen open: anyone free to use it, outside pull requests welcome, and the code there to audit. An agent harness runs agents on a person's machine with their model key, and promises they're held apart and offline. People can check those promises only by reading the code that makes them. Every merge to `main` now releases, so the rules for merging must be strong: nothing reaches `main` except a merged pull request whose checks passed.

## What Changes

- **jen is licensed under Apache-2.0.** `LICENSE` is the Apache License 2.0, and a new `NOTICE` names jen and reveer's copyright. The package declares `Apache-2.0` and carries `NOTICE`, and so do the agent and runtime images, which hold jen's code. Section 5 of the license covers contributions, so a pull request needs no agreement of its own. The license grants no rights to the names jen and reveer.
- **The repo is public, and takes outside pull requests.** A short `CONTRIBUTING.md` says how to propose a change and run the checks. A `SECURITY.md` asks for vulnerabilities to be reported privately, through GitHub's private vulnerability reporting.
- **`main` takes changes only through a pull request.** A ruleset with no bypass, for anyone including the maintainer, refuses a direct push, a force-push and deleting the branch, and merges a pull request only once CI's `check`, `boundary` and `sandbox` pass, and only by squashing. A second ruleset lets only the release workflow create, move or delete a `v*` tag. Workflows a fork's pull request starts wait for the maintainer's approval.
- **The record supersedes the private, proprietary decision**, and says how the repo is protected.

*Alternative: keep jen proprietary and add contribution terms.* Outside pull requests would work, but jen's code could be read and not used, which gives up most of what going public is for.

*Alternative: a license that forbids selling jen (FSL, BSL, Elastic License 2.0) or makes a service publish its changes (AGPL-3.0).* The maintainer weighed these on 2026-11-20 and chose Apache-2.0: jen is the harness that reveer's products are built on, not the product, the risk early on is that nobody uses jen rather than that someone resells it, and restrictions cost adoption most when it matters most. Loosening a license later is easy. Tightening it only reaches later versions.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `jen-release`: the package's license is `Apache-2.0`, and `NOTICE` ships in the package and in the images that hold jen's code.

## Impact

- **Release:** `scripts/build.ts` writes `Apache-2.0` and copies `NOTICE`, `scripts/release.ts` counts `NOTICE` as shipping, the `Dockerfile` copies `LICENSE` and `NOTICE` into the agent and runtime images, and `release.yml` labels the images with their license. The merge releases `0.1.1`, so npm's page shows the new license.
- **Repo:** `LICENSE`, `NOTICE`, `CONTRIBUTING.md`, `SECURITY.md`, `README.md`, and the repo's own `package.json`'s license.
- **GitHub settings,** changed by hand once the maintainer approves: the repo's visibility, two rulesets, merge methods, fork workflow approval and private vulnerability reporting.
- **Record:** `record/decisions.md` and `record/environment.md`.
