## Context

See proposal.md — Why. The constraints that shape the approach, none of which are negotiable from inside this change:

- **OIDC needs a newer toolchain than the package targets.** npm 11.5.1+ / Node 22.14.0+ to exchange a token; `engines.node` is `>=20.19.0` and CI pins exactly `20.19.0` so nothing newer slips in unnoticed.
- **OIDC cannot create a package.** The trusted-publisher form on npmjs.com is per-package and reachable only for a package that exists. `@reveer/jen` does not.
- **Workflows cannot open pull requests here.** `can_approve_pull_request_reviews` is `false` on the repository, and it gates creating as well as approving. In an organization it must be enabled at the org before the repo setting is even reachable.
- **`main` requires a pull request and zero approving reviews**, with no required status checks. Nothing blocks a Version PR from merging; nothing runs on it either.
- **The reference implementation is `Fission-AI/OpenSpec`**, publishing a scoped public package through `changesets/action` with npm OIDC today. Where this design departs from it, the departure is stated and reasoned rather than assumed to be an improvement.

## Goals / Non-Goals

**Goals:**

- A publish that no human can perform by accident and no stored credential can enable.
- Failure modes that name their own cause. The known errors here point at the wrong subsystem, and the cost of that is paid by whoever is on the next red run.
- A first release that is *observable* — the bootstrap sequenced so the pipeline's first real publish proves the pipeline.

**Non-Goals:**

- Testing the workflow before it merges. Nothing in the release path runs on a pull request, by design; the first merge to `main` is the first execution. Accepted, and the reason the bootstrap sequence below is ordered the way it is.
- Making the Version PR a task in jen's own pipeline. It has no Linear issue and never will — see Decisions.
- Hardening `ci.yml`. It is untouched.

## Decisions

### The action publishes; the top-level-step fallback is recorded, not pre-empted

`changesets/action` gets a `publish:` script and performs the publish itself, as the reference does.

The alternative is to let the action only open the Version PR and run `npm publish` in a separate top-level step. That exists as a workaround for a real bug: through some wrappers the OIDC environment variables — `ACTIONS_ID_TOKEN_REQUEST_TOKEN` and `ACTIONS_ID_TOKEN_REQUEST_URL` — do not reach the spawned npm process, and the publish fails as `ENEEDAUTH` with the trusted publisher configured perfectly ([npm/cli#8976](https://github.com/npm/cli/issues/8976)).

Rejected as the starting point because the reported case is `bun run` and the reference publishes a scoped public package through npm with the action doing the publish. Adopting the workaround pre-emptively means giving up `changeset publish`'s tag and dist-tag handling to guard against a bug we have no evidence applies to this toolchain. **But it is the first hypothesis if the publish authenticates as nobody**, and that belongs in the project note rather than in someone's memory.

### `setup-node` without `registry-url` — a deliberate departure from the reference

Setting `registry-url` makes `setup-node` write an `.npmrc` containing `_authToken=${NODE_AUTH_TOKEN}`. With no token in the environment that is a placeholder, and npm prefers it to an OIDC exchange, failing with a 404 that reads as though the package does not exist ([npm/cli#8730](https://github.com/npm/cli/issues/8730)). The reference sets it and publishes successfully, so this is not a live break there — but there is nothing to gain from it in a token-free workflow, and one of the two outcomes is a misleading error. Omitted.

### Node 24 to publish, 20.19.0 to verify

The release job pins Node 24 because that is what carries an npm new enough to exchange an OIDC token. `engines.node` and `ci.yml` do not move: they describe what an adopter needs to *run* jen, which is a different question from what GitHub needs to *publish* it. The artifact is unaffected — the build is `tsc` and the payload staging is deterministic file copying, neither of which varies by Node major.

Consequence worth naming: the published tarball is produced by a Node the test suite never ran under. Acceptable for a build with no native dependencies and no codegen; it would not be acceptable if either changed.

### `GITHUB_TOKEN`, with the policy opened rather than an App stood up

Covered in proposal.md. The design-level point is the **fallback shape**: swapping to a GitHub App is adding a `create-github-app-token` step and threading its output into `checkout` and the action's `GITHUB_TOKEN` env. It touches one file and no other decision here depends on which identity opens the PR. That is what makes starting with the cheaper option safe rather than optimistic.

### The gate is workflow steps, not the publish script

Build, typecheck, and test run as their own steps before `changesets/action`, rather than being folded into the `publish:` script.

Two reasons. The gate then also covers the Version-PR-opening path, so a broken `main` cannot even propose a release. And a failure is attributable to the step that failed instead of surfacing as a non-zero exit from a script that also publishes.

`changeset publish` will trigger `prepack`, rebuilding `dist/` a second time. That redundancy is deliberate: `prepack` is what guarantees the tarball is built and staged by construction, and removing it to save thirty seconds would make the published artifact depend on a prior step having run.

### The changelog is generated by `@changesets/changelog-github` and does not ship

`@changesets/changelog-github` renders entries with PR and author links, which requires a `GITHUB_TOKEN` at version time — already present. The default generator produces bare descriptions with no way back to the discussion, and for a project whose durable narrative lives in linked artifacts, that is the wrong trade.

`CHANGELOG.md` stays out of the tarball. npm always includes `package.json`, `README`, and `LICENSE` regardless of `files`, but not the changelog, and `files` remains `dist`-only. `cli/AGENTS.md` records that anything added to `files` must update `test/package.test.ts` deliberately; adding the changelog would trip that for a file adopters read on GitHub anyway.

### Actions in `release.yml` are pinned by commit SHA; `ci.yml` is left on tags

This workflow holds publish rights to the registry. An action referenced by a mutable tag is a supply-chain path straight into the package, so all three actions are pinned by SHA with the version in a trailing comment, as the reference does.

`ci.yml` keeps its `@v4` tags. The two files are not inconsistent by accident — the difference *is* the reasoning, and one that runs tests on a pull request has nothing to steal. Recorded so a later cleanup does not "fix" the inconsistency in the wrong direction.

### The Version PR is outside jen's own workflow, permanently

`AGENTS.md` says one branch and one PR per task, opened during design and merged by delivery. The Version PR has no Linear issue, no OpenSpec change, and no stage that owns it: it is generated, its content is a version bump and a changelog, and it is merged by a human deciding to cut a release. That is not an exception to the workflow so much as a category the workflow does not describe — the workflow governs *changes*, and this is a *release*.

Worth stating explicitly because the alternative is a future session dutifully creating an ENG issue to merge a bot's PR.

### The project note lives at `.github/AGENTS.md`

The setup preconditions and the debugging checklist go in a new `.github/AGENTS.md` — the nearest `AGENTS.md` to the workflow they describe, per the convention. Not the root one, which is the shipped workflow document. Not `cli/AGENTS.md`, which is about the CLI's own internals and would be the wrong place to look from a red release run.

The convention says project notes live "at or below `src/`", which does not literally apply to jen — `src/` is gitignored here and jen's own source is `cli/`. The spirit is what binds: notes ride beside the thing they describe and never in the shipped root document.

## Risks / Trade-offs

- **OIDC env vars may not reach npm through the action's publish script** ([npm/cli#8976](https://github.com/npm/cli/issues/8976)) → Symptom is `ENEEDAUTH` or a 404 naming the package, with the trusted publisher correct. Mitigation is the recorded fallback: demote the action to opening the PR and publish in a top-level step. Written into `.github/AGENTS.md` as the first hypothesis, not left to be rediscovered.
- **Every misconfiguration here reports the wrong subsystem** ([npm/cli#9088](https://github.com/npm/cli/issues/9088)) → A wrong workflow filename, a missing `id-token: write`, an org/repo mismatch, and a stray `.npmrc` all surface as `E404` or `ENEEDAUTH`. Mitigation is a checklist in the project note that enumerates the causes in the order they are cheapest to check, so the next red run is a lookup rather than a bisect.
- **The organization may forbid the Actions pull-request toggle** → Then `GITHUB_TOKEN` cannot open the Version PR at all and the release half of the pipeline is dead on arrival. Mitigation is the App fallback, whose shape is settled above so that discovering this costs a step, not a redesign.
- **The workflow cannot be exercised before it merges** → First execution is on the first push to `main` after merge. Mitigation is sequencing: the bootstrap is completed *before* the merge, so the very first run has a package to publish to and a publisher configured, and a failure is a failure of the workflow rather than of its preconditions.
- **`prepare` runs `openspec init` during `npm ci` and again during publish** → It writes into `.claude/`, which is gitignored, so it cannot dirty the tree the action commits to. It does mean OpenSpec must be installable and runnable for a publish to succeed. Already true of every CI run today; noted because the coupling is invisible from `release.yml`.
- **A release can be cut with no reviewer** → The ruleset requires zero approvals and the Version PR is generated. Nothing here changes that, and enabling the Actions toggle does not weaken it further: there is no approval requirement for a workflow to bypass. If review of releases is ever wanted, it is a ruleset change, not a workflow change.

## Migration Plan

Order matters. Steps 1–3 are a human's and must be complete before step 4, so that the first run tests the workflow rather than its preconditions.

1. **Enable the Actions pull-request toggle** at the `reveer-ai` organization, then at `reveer-ai/jen`. Without it `changesets/action` fails with `GitHub Actions is not permitted to create or approve pull requests`.
2. **Bootstrap the package.** `npm publish` `0.0.0` from a maintainer's authenticated machine, purely to bring `@reveer/jen` into existence. Then `npm deprecate @reveer/jen@0.0.0` so the placeholder is marked as one — it cannot be unpublished after 72 hours.
3. **Configure the trusted publisher** on the package's own settings page: owner `reveer-ai`, repository `jen`, workflow filename `release.yml` (filename only, with extension), no environment. Configurations created after 2026-05-20 require an allowed action to be selected explicitly — select `npm publish`. Then set the package to disallow tokens, which does not affect OIDC.
4. **Merge this change.** `main` now has the workflow and a changeset for `0.1.0`.
5. **Verify.** The push opens a Version PR; merging it publishes `0.1.0` with provenance, tags the commit, and creates the GitHub Release.

**Rollback.** Delete `.github/workflows/release.yml`; nothing else in the repository has runtime behavior. A published version cannot be withdrawn after 72 hours and should be superseded rather than unpublished. The trusted publisher entry is inert once the workflow is gone, and revoking it is a separate, always-available kill switch that does not require a commit.

## Open Questions

- **Does the `reveer-ai` organization permit the Actions pull-request toggle?** Unverified — reading it needs org-admin scope. Deferrable because it changes no spec, no interface, and no task beyond swapping which identity opens the Version PR, and the fallback is settled. It is answered the moment someone opens the org's Actions settings, and answering it before step 4 costs nothing.
