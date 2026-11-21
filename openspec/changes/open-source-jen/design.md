# Design

## Context

What ships is the npm package (`dist/`, built by `scripts/build.ts`, with `README.md` and `LICENSE`) and three images. The agent image holds `src/agent/` as written and the runtime image `src/runtime/`. The workspace image holds none of jen's code. `release.yml` runs on every push to `main`, and its `publish` job tags the release with `GITHUB_TOKEN` through `gh release create`. The repo is on GitHub's Free plan, which offers rulesets only on public repos: GitHub answers 403 for this one today. Its only writer is the maintainer, and every agent session pushes as them. CI's jobs report as `check`, `boundary` and `sandbox` on a pull request.

## Goals / Non-Goals

**Goals:**
- Everything jen distributes, in the package and the images, carries the license and the notice.
- Nothing reaches `main` but a squash-merged pull request whose checks passed, and no person can override that.

**Non-Goals:**
- A contributor agreement or sign-off. Apache-2.0's section 5 covers contributions.
- Changing how agents deliver work. Agent pull requests still go through `review-change` and `deliver-change`, and outside ones get the maintainer's review.
- Deleting the remote's old branches. They go public with the repo, and hold nothing that isn't on `main`.

## Decisions

### The license text and the notice

`LICENSE` is the Apache License 2.0 exactly as GitHub's licenses API serves it (`gh api licenses/apache-2.0`), so GitHub and npm recognise it. Its appendix keeps its placeholders, since it explains how to apply the license, and applying it is `NOTICE`'s job:

```
jen
Copyright 2026 reveer
```

Section 4(d) requires a redistribution to carry `NOTICE`, so forks keep naming jen and reveer. Per-file license headers are left out: `LICENSE` and `NOTICE` at the root cover the repo, and headers would touch every file for no further right.

### What carries them

- **The package:** `build.ts` copies `NOTICE` beside `LICENSE` and writes `"license": "Apache-2.0"`. The repo's own `package.json` declares it too, though it stays private.
- **The agent and runtime images:** the `Dockerfile` copies `LICENSE` and `NOTICE` into `/app`, beside the code. The workspace image holds none of jen's code and gets neither.
- **The image labels:** `release.yml` adds `org.opencontainers.image.licenses=Apache-2.0` to the images' labels, which GHCR shows on each package.
- **What ships:** `SHIPS` in `scripts/release.ts` gains `NOTICE`, so a change to it releases.

### The ruleset on `main`

One branch ruleset, `main`, targeting the default branch, enforcement active, with no bypass actors at all:

- **`pull_request`:** no approvals required. The maintainer is the only writer, agents push as them, and GitHub refuses a pull request author's own approval, so any required count would block every merge. Review conversations must be resolved, and the only merge method is squash.
- **`required_status_checks`:** `check`, `boundary` and `sandbox`, each from GitHub Actions (integration 15368), so a status set by anything else doesn't count. The branch needn't be up to date with `main` first: `release.yml` runs CI again on the merged commit before it releases anything, and requiring it would mean updating every branch after each merge.
- **`non_fast_forward`** and **`deletion`:** no force-push, and the branch can't be deleted.

*Alternative: allow the maintainer to bypass.* An emergency fix could skip the checks, but so could a mistaken push from any session, all of which act as the maintainer. With no bypass, an emergency goes through a pull request like everything else. A repo admin can still edit the ruleset, and that leaves a trail in the repo's settings history.

The repo's own merge settings match: merge commits and rebase merging are turned off.

### The ruleset on release tags

One tag ruleset, `releases`, on `refs/tags/v*`, refusing creation, update and deletion, with GitHub Actions (integration 15368) as its only bypass actor. Only the release workflow then makes tags. That also enforces the record's rule never to push the maintainer's local tags `v0.1.0` to `v0.5.0`, which would make the next release read `v0.5.0` as the last.

### Outside pull requests

- **Workflow approval:** the repo's fork pull request policy is `all_external_contributors`, so every run a fork starts waits for the maintainer. A fork's run already gets a read-only token and no secrets, so this guards the runners from code nobody has read.
- **Security reports** go through GitHub's private vulnerability reporting, turned on for the repo. `SECURITY.md` points there and asks that nobody opens a public issue.
- **`CONTRIBUTING.md`** says that a change opens as a pull request, that larger ones start as an issue, how to run the checks (`npm ci`, `npm run check`, `npm test`), and that contributions come in under Apache-2.0. The `README`'s License section says jen is Apache-2.0 and links it.

## Risks / Trade-offs

- **[Going public can't really be undone]** → Forks, clones, GH Archive's event log and search caches keep what was public. The maintainer reads `record/`, `ideas.md` in particular, before approving this change. The git history was scanned on 2026-11-20 and holds no secrets.
- **[The tag ruleset might refuse the release workflow]** → the first release after it, `0.1.1`, shows it. That release would have published to npm before its tag step failed, and a rerun keeps that version. So fix the bypass and rerun the release.
- **[No bypass on `main`]** → a broken CI blocks every merge, fixes to CI included, since they need `check` to pass. An admin can disable the ruleset for that fix and turn it on again.
- **[A ruleset that doesn't hold]** → the probe after applying it pushes an empty commit straight to `main` and expects a refusal. If it's accepted, the empty commit changes nothing that ships and releases nothing, and the ruleset gets fixed before anything else merges.

## Migration Plan

This order lets the merge itself test the rulesets:

1. The maintainer approves the pull request.
2. The repo is made public.
3. The two rulesets, the merge settings, fork workflow approval and private vulnerability reporting are applied.
4. Probes: an empty commit pushed to `main`, a force-push to `main` and a pushed `v9.9.9-probe` tag are each refused.
5. The pull request is merged through the ruleset, and the release of `0.1.1` creates its tag past the tag ruleset. npm attaches provenance to `0.1.1`, now that the repo is public.

For a moment between steps 2 and 5 the public repo still carries the old license. Its terms are stricter, so nobody gains a right in that window.
