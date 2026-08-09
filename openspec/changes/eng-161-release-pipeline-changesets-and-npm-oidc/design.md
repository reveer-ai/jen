## Context

See proposal.md — Why. The constraints that shape the approach, none of which are negotiable from inside this change:

- **OIDC needs a newer toolchain than the package targets.** npm 11.5.1+ / Node 22.14.0+ to exchange a token; `engines.node` is `>=20.19.0` and CI pins exactly `20.19.0` so nothing newer slips in unnoticed.
- **OIDC cannot create a package.** The trusted-publisher form on npmjs.com is per-package and reachable only for a package that exists. `@reveer/jen` does not.
- **Workflows cannot open pull requests here.** `can_approve_pull_request_reviews` is `false` on the repository, and it gates creating as well as approving. In an organization it must be enabled at the org before the repo setting is even reachable.
- **`main` requires a pull request and zero approving reviews, and today no status checks.** That last part is treated here as a gap to close rather than a constraint to design around — this change adds a required check, which is what makes several decisions below fall the way they do.
- **Repository and organization settings are within reach.** They are inputs to the design, not fixed conditions. Where a setting would make the pipeline better, the design asks for it and the migration plan lists it, rather than routing around it.
- **A publish is irreversible.** A version can be unpublished within 72 hours and not after. Every other operation here — opening a PR, bumping a version, writing a changelog, tagging — is undoable by editing a file. This asymmetry is the single most load-bearing fact in the design, and the decisions below fall out of taking it seriously.

Prior art was consulted and is cited where it is *evidence* — that a scoped public package publishes this way in production, that a given error has a known cause — never as authority. No existing pipeline is treated as the shape this one should take.

## Goals / Non-Goals

**Goals:**

- A publish that no human can perform by accident and no stored credential can enable.
- Failure modes that name their own cause. The known errors here point at the wrong subsystem, and the cost of that is paid by whoever is on the next red run.
- A first release that is *observable* — the bootstrap sequenced so the pipeline's first real publish proves the pipeline.

**Non-Goals:**

- Testing the workflow before it merges. Nothing in the release path runs on a pull request, by design; the first merge to `main` is the first execution. Accepted, and the reason the bootstrap sequence below is ordered the way it is.
- Making the Version PR a task in jen's own pipeline. It has no Linear issue and never will — see Decisions.

## Decisions

### Changesets, because the alternative would rewrite a specified convention

The version decision needs a human checkpoint and a durable description of what shipped. Three shapes exist: derive everything from commit messages (`semantic-release`, publishing straight from CI with no checkpoint at all), derive the version from conventional commits but stage it in a PR (`release-please`), or record intent in explicit files staged in a PR (changesets).

The first is out on the checkpoint alone. Between the other two, the deciding constraint is jen's own: commits here lead with the issue identifier — `ENG-161: design the release pipeline` — and that format is **specified**, in `stage-conventions`, and produced by all six stage skills. Adopting conventional commits to satisfy a release tool would mean amending a spec and six skills so the tooling could read the log. Changesets reads a file a contributor writes on purpose and asks nothing of the commit format.

The secondary benefit is that intent is stated at authoring time by whoever knew what they changed, rather than reconstructed later from a subject line.

### Opening a PR and publishing are separated, because only one of them is irreversible

`changesets/action` runs in `version` mode only: it applies pending changesets, writes `package.json` and `CHANGELOG.md`, and opens or updates the Version PR. It is never given a `publish:` script. The publish is its own step in the workflow — check the registry for the version in `package.json`, and `npm publish` if it is absent.

This follows from the asymmetry in Context. The action's combined mode switches behavior implicitly on whether changesets are pending: the same step opens a PR on one run and permanently publishes an artifact on the next, and which one it did is not visible in the workflow file. For the reversible half that opacity is a fair trade for the PR mechanics being handled. For the irreversible half it is not.

Separating them buys three things:

- **The irreversible operation is legible.** Someone reading `release.yml` can see exactly what publishes, under what guard, without knowing the action's internal mode logic.
- **A whole bug class stops applying.** The OIDC exchange needs `ACTIONS_ID_TOKEN_REQUEST_TOKEN` and `ACTIONS_ID_TOKEN_REQUEST_URL` in npm's environment, and there are reports of them not surviving the wrapper chain from a JS action through a package script to the spawned npm ([npm/cli#8976](https://github.com/npm/cli/issues/8976)). A shell step inherits the job environment directly. Rather than judging whether that report applies to this toolchain, the design removes the chain — which is the more robust answer regardless of the bug's true scope.
- **Idempotency becomes explicit.** "Publish only if this version is not already on the registry" is a visible guard with an obvious failure mode, rather than a property of `changeset publish` that has to be trusted.

The cost is that GitHub Releases are created by the workflow instead of by the action, from the changelog section for the released version. That is a handful of lines, and it lands in the same place as the publish it describes.

The general rule, stated once because later changes will meet it again: **delegate what is fiddly and reversible; own what is irreversible.**

### `setup-node` is used without `registry-url`

Setting it makes `setup-node` write an `.npmrc` containing `_authToken=${NODE_AUTH_TOKEN}`. With no token in the environment that is a placeholder, and npm prefers a token it can see over performing an OIDC exchange — failing with a 404 that reads as though the package does not exist ([npm/cli#8730](https://github.com/npm/cli/issues/8730)).

Pipelines that publish with a token need this option; one that publishes without a token gains nothing from it and inherits a misleading failure. Omitted. This matters more once the publish is a bare shell step, since that step's entire authentication story is "npm finds no credential and therefore asks GitHub who it is."

### Provenance is demanded, not hoped for

`npm publish --provenance`, explicitly, even though provenance is generated automatically when publishing via OIDC from a public repository with a public package.

The spec requires published versions to carry provenance. Automatic generation is conditional, and the conditions are not all inside this repository's control — a package flipped to restricted, a repository made private. Relying on the default means those changes downgrade the guarantee silently and the pipeline keeps reporting success. The explicit flag makes npm fail instead. An invariant the specs assert should be enforced where it can be, not assumed.

### Node 24 to publish, 20.19.0 to verify, and the version is asserted rather than assumed

The publish job pins Node 24 because that is what carries an npm new enough to exchange an OIDC token; the check job stays on 20.19.0 because that is the floor `engines.node` promises and the point of a floor is to be the thing you test against. `engines.node` does not move — it describes what an adopter needs to *run* jen, which is a different question from what GitHub needs to *publish* it.

The publish job asserts `npm --version` is at least 11.5.1 before doing anything else. Node images change, and the failure this guards against is not a missing binary but a *silently older npm*, which does not announce itself — it declines the OIDC exchange and reports a 404 naming the package. One line converts the worst error message in this system into the most obvious one.

### A GitHub App opens the Version PR, and `main` requires a status check

One decision with two halves that only work together.

`GITHUB_TOKEN` cannot trigger workflows — a deliberate GitHub design choice, to stop workflows recursing. So a Version PR opened with it produces no check run. That is merely a lost convenience while nothing is required, and a **deadlock** the moment a check is: the required check never reports, and the PR can never merge. Any design that wants `main` gated has to use an identity whose pushes trigger workflows, and an App installation token is one.

The other route — enable *"Allow GitHub Actions to create and approve pull requests"* and keep `GITHUB_TOKEN` — is rejected twice over. It cannot support required checks at all, and it is a blanket grant to every workflow in the repository where an App is a scoped identity holding exactly the two permissions it needs. The grant's dangerous half is `approve`, which is harmless here **only** because the ruleset requires zero approving reviews. Designing against a current weakness means the design silently degrades the day that weakness is fixed. The toggle stays off.

Cost, stated plainly: an App private key is now a stored secret. That is a different risk class from the npm token this change exists to avoid — scoped to two permissions on one repository, rotatable without touching the registry, and auditable as its own identity in the log. It cannot publish anything.

What the required check must be: the same CI workflow every pull request runs. Since `ci.yml` is now invoked by the release as well, one definition covers pull requests, the Version PR, and the release gate.

Two rules that look adjacent and are deliberately **not** adopted. Requiring approving reviews would deadlock a single-maintainer repository, since GitHub does not let an author approve their own pull request. Requiring signed commits would break the Version PR, because the changesets action commits through the git CLI rather than the API and its commits carry no signature.

### The publish job runs in an environment npm is told to require

A GitHub environment named `release`, with deployment branches restricted to `main`, declared on the publish job and entered in the trusted-publisher entry.

Without it, the entire barrier between a branch and the registry is the workflow *filename*. That check is real but shallow: it constrains which file may publish, not which branch that file may publish from. GitHub includes the environment in the OIDC token's claims and npm matches it, so an environment restricted to `main` makes the branch a condition of the credential itself rather than a convention of the trigger.

The workflow already only triggers on push to `main`, so on the happy path this changes nothing — which is the point. It is the case where something has gone wrong that it exists for, and it costs one line in the job plus one field on npm.

No required reviewers on the environment. The human decision already happened when the Version PR was merged, and a second approval prompt after that is ceremony rather than control.

### The checks are defined once, in `ci.yml`, and the release calls them

`ci.yml` gains a `workflow_call` trigger and loses its `push: main` trigger. `release.yml` invokes it as a job, and both the version-PR job and the publish job depend on it.

The obvious alternative — restate build, typecheck, and test as steps in `release.yml` — puts the definition of "the checks" in two files. The failure mode is silent and one-directional: someone adds a lint step to `ci.yml`, every pull request gets stricter, and releases quietly keep shipping under the old bar. Nobody notices, because the release is green.

`push: main` comes off `ci.yml` because `release.yml` now covers that branch through the called workflow. Leaving it would run every check twice on every push to `main`, and the standalone run would be the one that *looks* authoritative while gating nothing — it races the release rather than blocking it. A called workflow is in the release run's dependency chain; a concurrently-triggered one is not, and that distinction is the whole substance of the gate.

Consequence for the spec: the requirement is that the gate be in the release's dependency chain, not that it live in the same file. Worded that way.

The gate covers the version-PR path too, so a broken `main` cannot even propose a release.

### The artifact is built once and that exact tarball is published

The check job runs `npm pack` — which runs `prepack`, so the tarball is built and staged by construction — and uploads the result as a workflow artifact. The publish job downloads it and runs `npm publish <tarball>`.

Node 24 is needed to publish and 20.19.0 is what the package claims to support, so something has to bridge them. Building in the publish job would mean the published artifact was produced by a Node the test suite never ran under — tolerable today, since the build is `tsc` over a package with no native dependencies and no codegen, but tolerable is a weaker property than true, and it stops being tolerable the moment either of those changes.

Packing on the floor and promoting that byte-identical tarball makes the shipped artifact the tested artifact by construction rather than by argument. `test/package.test.ts` already packs and asserts the tarball's contents both ways, so the thing under test and the thing published are the same object. It also removes a second `prepack` from the publish path, so the publish job installs nothing and does nothing but authenticate and upload.

Nuance worth recording rather than glossing: provenance is generated at publish time from the publishing runner's OIDC claims, so with the split it attests the job that uploaded rather than the job that built. Every claim in the attestation stays true — same workflow run, same repository, same commit — because the attestation names those and not the job. But "built here" is now one job removed from literally true, and anyone reasoning about the attestation at SLSA-provenance depth should know that before relying on it.

This is the one decision in this design that *adds* machinery — two jobs and an artifact handoff — rather than removing it. It buys a guarantee that would otherwise be an argument about how unlikely `tsc` is to differ across Node majors, and arguments of that shape decay as the build grows.

### The changelog is generated by `@changesets/changelog-github` and does not ship

`@changesets/changelog-github` renders entries with PR and author links, which requires a `GITHUB_TOKEN` at version time — already present. The default generator produces bare descriptions with no way back to the discussion, and for a project whose durable narrative lives in linked artifacts, that is the wrong trade.

`CHANGELOG.md` stays out of the tarball. npm always includes `package.json`, `README`, and `LICENSE` regardless of `files`, but not the changelog, and `files` remains `dist`-only. `cli/AGENTS.md` records that anything added to `files` must update `test/package.test.ts` deliberately; adding the changelog would trip that for a file adopters read on GitHub anyway.

### Actions in `release.yml` are pinned by commit SHA; `ci.yml` is left on tags

This workflow can publish to the registry, so any code it executes can too. A tag is a mutable pointer: `@v1` resolving to different code tomorrow is a supply-chain path straight into the package, and `changesets/action` in particular runs with `contents: write` and `pull-requests: write`. Every action in `release.yml` is pinned by commit SHA, with the human-readable version in a trailing comment.

`ci.yml` keeps its `@v4` tags. The asymmetry is the reasoning, not an oversight: it runs tests on a pull request with a read-only token and no access to publish, so a compromised action there has nothing to take. Recorded so a later consistency pass does not resolve the difference in the wrong direction.

Worth noting what pinning does not buy: `changesets/action` still brings its own dependency tree, and pinning fixes *which* tree rather than shrinking it. That is the residual cost of using it at all — accepted because the alternative is reimplementing create-or-update-PR logic, with its own edge cases around an existing branch and an already-open PR, in shell. The line drawn above holds: this is the reversible half.

### The Version PR is outside jen's own workflow, permanently

`AGENTS.md` says one branch and one PR per task, opened during design and merged by delivery. The Version PR has no Linear issue, no OpenSpec change, and no stage that owns it: it is generated, its content is a version bump and a changelog, and it is merged by a human deciding to cut a release. That is not an exception to the workflow so much as a category the workflow does not describe — the workflow governs *changes*, and this is a *release*.

Worth stating explicitly because the alternative is a future session dutifully creating an ENG issue to merge a bot's PR.

### The project note lives at `.github/AGENTS.md`

The setup preconditions and the debugging checklist go in a new `.github/AGENTS.md` — the nearest `AGENTS.md` to the workflow they describe, per the convention. Not the root one, which is the shipped workflow document. Not `cli/AGENTS.md`, which is about the CLI's own internals and would be the wrong place to look from a red release run.

The convention says project notes live "at or below `src/`", which does not literally apply to jen — `src/` is gitignored here and jen's own source is `cli/`. The spirit is what binds: notes ride beside the thing they describe and never in the shipped root document.

## Risks / Trade-offs

- **Every misconfiguration in the OIDC exchange reports the wrong subsystem** ([npm/cli#9088](https://github.com/npm/cli/issues/9088)) → A wrong workflow filename, a missing `id-token: write`, an owner/repo mismatch, a stray `.npmrc`, and an npm too old all surface as the same `E404` or `ENEEDAUTH`. This is the design's dominant operational risk, and three decisions above exist to shrink it: no `registry-url`, an asserted npm version, and a publish that is a bare shell step with nothing between it and the environment. What remains is covered by a checklist in the project note, ordered by how cheap each cause is to rule out.
- **`changesets/action` runs with write permissions and brings its own dependency tree** → SHA-pinning fixes which code runs but does not reduce how much. Mitigated by scope rather than trust: it never holds the publish, so the worst case is a bad Version PR — visible, reviewable, and revertible — rather than a bad artifact on the registry.
- **The App private key is a stored secret, and the pipeline stops if it lapses** → Rotation is manual and App keys do not announce their own expiry. The failure is loud and harmless — the version job fails to authenticate, no Version PR appears, nothing publishes — but it will look like a broken pipeline rather than an expired credential unless someone knows to check. Named in the project note's checklist for that reason.
- **A required status check makes the release path depend on the App working** → With checks required on `main`, a Version PR that never gets a check run cannot merge, so an App outage blocks releases rather than degrading them. Accepted deliberately: the alternative is a `main` nothing gates, and a blocked release is a better failure than an unverified one.
- **The workflow cannot be exercised before it merges** → Nothing in the release path runs on a pull request, so first execution is the first push to `main` after merge. Mitigation is sequencing: the bootstrap completes *before* the merge, so the first run has a package to publish to and a publisher configured, and any failure is the workflow's own rather than a missing precondition.
- **`prepare` runs `openspec init` on every `npm ci`** → It writes into `.claude/`, which is gitignored, so it cannot dirty the tree the action commits to. It does couple every CI and release run to OpenSpec being installable and runnable — already true today, noted because the coupling is invisible from `release.yml`. It no longer touches the publish job, which installs nothing and only uploads a tarball.
- **A release can be cut with no reviewer** → The ruleset requires zero approving reviews and the Version PR is generated, so merging it is one person's click. Unavoidable in a single-maintainer repository — requiring approvals would deadlock every pull request, not just this one. Partially offset by the required status check, which at least guarantees the release was verified even if it was not read. If genuine review of releases is ever wanted, it arrives with a second maintainer and is a ruleset change, not a workflow change.

## Migration Plan

Order matters. Steps 1–5 are account-level and must all be complete before step 6, so that the first run tests the workflow rather than its preconditions.

1. **Create the GitHub App.** Permissions **Contents: write** and **Pull requests: write**, nothing else. Install it on `reveer-ai/jen` only. Store its id as the `APP_ID` variable and its private key as the `APP_PRIVATE_KEY` secret. Leave *"Allow GitHub Actions to create and approve pull requests"* **off** — the App replaces it, and leaving it off is the least-privilege position.
2. **Create the `release` environment**, with deployment branches restricted to `main` and no required reviewers.
3. **Own the package under an npm organization** rather than a personal account, so publishing rights outlive one login.
4. **Bootstrap the package.** `npm publish` `0.0.0` from a maintainer's authenticated machine, purely to bring `@reveer/jen` into existence. Then `npm deprecate @reveer/jen@0.0.0` so the placeholder is marked as one — it cannot be unpublished after 72 hours.
5. **Configure the trusted publisher** on the package's own settings page: owner `reveer-ai`, repository `jen`, workflow filename `release.yml` (filename only, with extension), environment `release`. Configurations created after 2026-05-20 require an allowed action to be selected explicitly — select `npm publish` and not `npm stage publish`. Then set the package to require 2FA and disallow tokens, which does not affect OIDC and makes it the only path in.
6. **Add the required status check** on `main`, naming the CI job. Safe to do now rather than after: `ci.yml` already runs on `pull_request` today and keeps that trigger, so this pull request reports the check it is about to require.
7. **Merge this change.** `main` now has the workflow, `version` at `0.0.0`, and a `minor` changeset. The version in `package.json` matching the bootstrap is not cosmetic: under changesets `package.json` holds the *last released* version and the Version PR is what moves it, so `0.0.0` is the accurate value and is what makes the next step produce `0.1.0`. Left at `0.1.0`, the publish guard would find a version not on the registry and ship it immediately — a correct release that skips the Version PR and therefore demonstrates nothing about the mechanism being verified.
8. **Verify.** The push opens a Version PR — which, opened by the App, gets its own check run. Merging it publishes `0.1.0` with provenance, tags the commit, and creates the GitHub Release. Confirm the published version carries a provenance attestation naming `reveer-ai/jen` and `release.yml` — that is the assertion that the whole credential-free path actually ran, rather than something else having quietly succeeded.

**Rollback.** Delete `.github/workflows/release.yml`; nothing else in the repository has runtime behavior. A published version cannot be withdrawn after 72 hours and should be superseded rather than unpublished.

There are now three independent kill switches outside the repository, none needing a commit: revoke the trusted publisher entry, uninstall the App, or remove `main` from the `release` environment's deployment branches. Each severs a different link in the chain, which is worth knowing under time pressure — the first stops publishing, the second stops Version PRs, the third stops the job reaching a credential at all.
