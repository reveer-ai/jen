## Why

ENG-156 made jen publishable and ENG-158 made it do something once installed. Neither published it: `@reveer/jen` is a 404 on the registry, and nothing turns a merged PR into a version an adopter can install. The gap is not a missing command — `npm publish` works today from a laptop — it is that releasing by hand puts a human with npm write credentials in the path of every release, which is the shape jen exists to remove from everything else.

Publishing is also the last thing standing between the pipeline and its own adoption: ENG-162 validates the install path as an adopter experiences it, and an adopter experiences it as `npm i -D @reveer/jen`.

## What Changes

- **Changesets carries the version decision.** A PR lands with a changeset describing its user-visible effect; a push to `main` opens or updates a **Version Packages** PR that bumps `package.json` and writes `CHANGELOG.md`; merging *that* PR publishes. The release becomes a reviewed PR, which is how every other decision in this repository is made. `@changesets/changelog-github` renders entries with PR and author links.

- **npm OIDC trusted publishing, so no npm credential is ever stored.** The release job requests an OIDC token (`id-token: write`), npm exchanges it for a short-lived publish grant, and no `NPM_TOKEN` secret exists in the repository. Provenance is generated automatically and needs no flag: the repo is public and the package will be, which is exactly the condition npm requires.

- **The pipeline cannot cut release one, and that is not fixable here.** OIDC cannot publish a package's first version — npmjs.com will not accept a trusted-publisher configuration for a package that does not exist, and [npm/cli#8544](https://github.com/npm/cli/issues/8544) is still open. So a human publishes `0.0.0` by hand to bring the package into existence, then configures the trusted publisher, and the pipeline owns every version after. `0.0.0` rather than `0.1.0` deliberately: the bootstrap exists to unblock OIDC, not to ship a v0.1 that predates the setup skill and the adoption docs. The real `0.1.0` goes out through the pipeline like everything else.

- **`repository` is added to `package.json`, in normalized form.** The package currently declares no link to its source at all. It is also load-bearing here rather than cosmetic: npm's OIDC matching is reported to be sensitive to the normalized `repository.url`, so it is written as `https://github.com/reveer-ai/jen.git` and not the `git+https://` form npm rewrites into.

- **`setup-node` is used without `registry-url`.** Setting it writes an `.npmrc` containing `_authToken=${NODE_AUTH_TOKEN}`, and npm prefers that placeholder token over an OIDC exchange — surfacing as a 404 that reads like the package does not exist ([npm/cli#8730](https://github.com/npm/cli/issues/8730)). A pipeline that publishes with a token needs the option; one that publishes without a token earns nothing from it and inherits a misleading failure.

- **The release job runs Node 24 while CI stays at 20.19.0.** OIDC requires npm 11.5.1+ / Node 22.14.0+. `engines.node` does not move — it describes what an adopter needs to *run* jen, not what GitHub needs to publish it — so the floor stays where CI proves it.

- **Stable channel only; the file is where a second channel would go.** The one-workflow-file-per-package constraint is real, but it forbids a *second file*, not a second job — adding a beta job to `release.yml` later is additive. And jen is pre-1.0: the entire `0.x` line already is the prerelease channel, so a `beta` dist-tag today would be a channel in front of a channel. Recorded rather than built.

- **A GitHub App is not stood up; the repository's Actions policy is opened instead.** Two things push toward an App. One is that `GITHUB_TOKEN` cannot trigger workflows by design, so CI never runs on the Version PR. The other is a hard blocker: **"Allow GitHub Actions to create and approve pull requests" is currently off**, and despite its name it governs *creating* a PR, not only approving one. `pull-requests: write` does not substitute — the setting and the permission are both required — so `GITHUB_TOKEN` cannot open the Version PR at all until the toggle is enabled at the organization and then at the repository. App installation tokens are not `GITHUB_TOKEN` and are unaffected by either constraint.

  Enabling the toggle is close to inert here: the ruleset requires a pull request into `main` with **zero approving reviews**, so there is no review gate for a workflow to bypass — the setting's actual risk. Against that, an App means creating it, installing it, and storing a private key, on a task already waiting on a human for the npm bootstrap. What is genuinely given up is CI on the Version PR, and the release job's own gate covers it. If the organization forbids the toggle, or later re-closes it, the App is the fallback: threading an App token into `checkout` and the action is a localized change, not a restructure.

- **Opening the Version PR and publishing are separate operations, because only one of them is irreversible.** The changesets action opens and updates the Version PR and never publishes; the publish is its own step, guarded on the version being absent from the registry. A published version cannot be withdrawn after 72 hours, and an operation that permanent should be legible in the workflow file rather than an implicit mode of a step that also does something harmless.

- **Nothing publishes that has not passed, and the checks have one definition.** `ci.yml` becomes callable and `release.yml` invokes it, so the release gate and the pull-request checks are the same list — a check added for PRs cannot silently not apply to releases. `ci.yml` loses its `push: main` trigger in the process: a workflow firing on the same event runs *beside* the release rather than gating it, and leaving it in place would look authoritative while blocking nothing.

- **The artifact is packed once, on the Node floor, and that exact tarball is published.** The publish job never rebuilds. Otherwise the published tarball would be produced by the Node 24 that publishing requires, and verified by the 20.19.0 that `engines` promises — different from the artifact anyone tested.

**Explicitly not enforced: that a PR carries a changeset.** No CI gate, deliberately. A PR merged without one does not break anything — it just is not released, and a changeset added later still picks it up. The alternative fails every design-stage PR, which by construction contains artifacts and no code, and a check that is red for a whole stage of the pipeline is a check nobody reads. The obligation is recorded as a project note instead.

**Also out of scope:** any release channel beyond stable; shipping `CHANGELOG.md` inside the tarball (`files` stays `dist`-only — the changelog lives on GitHub and in the GitHub Release); and publishing anything but jen itself.

## Capabilities

### New Capabilities

- `release-pipeline`: how a merged change becomes a published version — the changeset-to-Version-PR-to-publish sequence, credential-free authentication as the only supported publishing path, what gates a publish, and the one-time bootstrap the pipeline cannot perform for itself.

### Modified Capabilities

- `npm-package`: the **Package identity** requirement enumerates the fields `package.json` must declare. It gains `repository`, in the normalized `https://….git` form, because the OIDC exchange is sensitive to it — the field moves from absent-and-unmentioned to required-and-constrained.

## Impact

- **Added**: `.github/workflows/release.yml`; `.changeset/config.json` and the changesets convention directory; `@changesets/cli` and `@changesets/changelog-github` as devDependencies; a `release` script for the action to invoke; `CHANGELOG.md` at the root, generated from here on and never hand-edited.
- **Modified**: `package.json` gains `repository` and the release scripts. `ci.yml` gains a `workflow_call` trigger so the release can invoke it as its gate, and loses `push: main`, which the release now covers. The Node floor it pins does not move — deliberately not the version the publish job runs.
- **Blast radius is small but the failure mode is loud.** Nothing in the release path executes on a pull request; the workflow only runs on push to `main`. The cost is that it also cannot be tested before it merges, and a wrong workflow filename or a mismatched trusted-publisher entry surfaces as `E404` or `ENEEDAUTH` — errors that name the wrong subsystem ([npm/cli#9088](https://github.com/npm/cli/issues/9088)). The design records the checklist rather than leaving the next session to rediscover it through six red runs.
- **Blocked on a human, and not by oversight.** Three steps need an account this pipeline does not have: the bootstrap publish of `0.0.0` and the trusted-publisher entry, both on Josh's npm account, and enabling "Allow GitHub Actions to create and approve pull requests" at the `reveer-ai` organization and then the repository. The workflow can be written, reviewed, and merged without any of them, but neither half of the flow — the Version PR opening, or merging it publishing — can be observed until they are done. This goes on the issue as a handoff rather than being quietly counted as passing. The organization-level setting is also the one item nobody has confirmed is *permitted*; if it is policy-locked, the design falls back to a GitHub App.
- **Downstream**: ENG-162 installs jen from the registry, which this makes possible for the first time. A future task that adds a beta channel adds a job to `release.yml` and must not add a file beside it.
- **Designed out rather than noted**: OIDC env vars are reported not to survive the wrapper chain from a JS action through a package script to the spawned npm ([npm/cli#8976](https://github.com/npm/cli/issues/8976)), producing an `ENEEDAUTH` with the trusted publisher configured perfectly. Separating the publish into its own shell step removes the chain, so the question of whether that report applies to this toolchain does not have to be answered.
