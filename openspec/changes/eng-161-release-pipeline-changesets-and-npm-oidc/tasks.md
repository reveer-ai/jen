## 1. Package manifest and changesets

- [x] 1.1 Add `repository` to `package.json`: `{ "type": "git", "url": "https://github.com/reveer-ai/jen.git" }`. The `https://` form, not `git+https://` — the OIDC exchange matches against the normalized URL.
- [x] 1.2 Set `version` to `0.0.0`. Under changesets, `package.json` holds the *last released* version and the Version PR is what moves it — so after the `0.0.0` bootstrap publish this is the accurate value, and it is what lets the first Version PR produce `0.1.0` rather than `0.2.0`. Leaving it at `0.1.0` would make the first release bypass the Version PR entirely and prove nothing about the flow.
- [x] 1.3 Add `@changesets/cli` and `@changesets/changelog-github` as devDependencies.
- [x] 1.4 Write `.changeset/config.json`: `changelog` set to `@changesets/changelog-github` with `{ "repo": "reveer-ai/jen" }`, `access` `public`, `baseBranch` `main`, `commit` `false`. Keep the `$schema` key so the file is checked by an editor.
- [x] 1.5 Add a `changeset` npm script (`changeset`) so contributors have one command to reach for.
- [x] 1.6 Write the changeset for this change itself — a `minor` bump, since it takes `0.0.0` to `0.1.0`. This is what the first Version PR consumes.
- [x] 1.7 Update the `npm i -D /tmp/reveer-jen-0.1.0.tgz` example in `cli/AGENTS.md`, which now names a version that will not exist until the first release.

## 2. The shared check workflow

- [x] 2.1 Add a `workflow_call` trigger to `.github/workflows/ci.yml` so the release can invoke it as a gating job.
- [x] 2.2 Remove the `push: branches: [main]` trigger from `ci.yml`. The release workflow now covers `main` through the called workflow; leaving this in place would run every check twice and produce a standalone run that looks authoritative while gating nothing.
- [x] 2.3 Add an `npm pack` step and upload the resulting tarball with `actions/upload-artifact`, so the artifact the checks verified is the one the publish job ships. Leave the Node version at `20.19.0` — packing on the floor is the point.
- [x] 2.4 Confirm the pull-request run for this change is green with both trigger changes in place, since `ci.yml` is now doing two jobs.

## 3. The release workflow

- [x] 3.1 Create `.github/workflows/release.yml`: trigger `push: branches: [main]` only; top-level `permissions` floor of `contents: read`; `concurrency` grouped per ref with `cancel-in-progress: false`, so a run that is mid-publish is never interrupted.
- [x] 3.2 Add the `checks` job as `uses: ./.github/workflows/ci.yml`. Every other job depends on it.
- [x] 3.3 Add the `version` job: `needs: checks`, permissions `contents: write` and `pull-requests: write`. Mint an App installation token with `actions/create-github-app-token` from the `APP_ID` variable and `APP_PRIVATE_KEY` secret, and pass it to both `actions/checkout` and the action's `GITHUB_TOKEN`. `GITHUB_TOKEN` will not do: its pushes do not trigger workflows, so the required check would never report on the Version PR and it could never merge.
- [x] 3.4 Run `changesets/action` in that job in **version mode only** — a `version:` input and no `publish:` input. This job must never be able to publish.
- [x] 3.5 Add the `publish` job: `needs: [checks, version]`, permissions `contents: write` and `id-token: write`, and `environment: release`. The environment is not cosmetic — GitHub puts it in the OIDC claims and npm matches it, so it is what makes the branch a condition of the credential rather than of the trigger. Set up Node 24 **without** `registry-url`, which writes an `.npmrc` whose placeholder token npm prefers over an OIDC exchange, failing as a 404 that names the package.
- [x] 3.6 In the publish job, assert `npm --version` is at least 11.5.1 before anything else, failing with a message that names OIDC as the reason. A silently older npm declines the exchange and reports the same misleading 404.
- [x] 3.7 Guard the publish on the registry rather than on the action's outputs: read `name` and `version` from `package.json`, and skip when `npm view <name>@<version>` already resolves. This is the whole idempotency story and it holds on every path — with changesets pending, `main` still carries the last released version, which is by definition already published.
- [x] 3.8 Download the packed tarball and publish it with `npm publish <tarball> --provenance`. Explicitly, not relying on provenance being automatic: the specs require it, the automatic conditions are not all controlled from this repository, and the flag turns a silent downgrade into a failed run. The job installs nothing and builds nothing.
- [x] 3.9 Tag the released commit `v<version>` and create a GitHub Release carrying that version's `CHANGELOG.md` section. Make both steps tolerate an existing tag or release so a re-run is not a failure.
- [x] 3.10 Pin every action in `release.yml` by commit SHA with the human-readable version in a trailing comment. Leave `ci.yml` on its `@v4` tags — the asymmetry is deliberate and is reasoned in design.md.

## 4. Guard the two traps that invite a well-meaning cleanup

- [x] 4.1 Extend `test/package.test.ts` to assert `repository.url` is present and begins with `https://` rather than `git+https://`.
- [x] 4.2 Add a test that parses `.github/workflows/release.yml` and asserts three things: no `registry-url`, `--provenance` on the publish, and `environment: release` on the publish job. All three look like noise to a future reader, all three have failure modes that report the wrong subsystem, and none is caught by anything else. The environment especially — remove it and the pipeline keeps working, having silently dropped a claim the registry was checking.

## 5. Notes and handoff

- [x] 5.1 Write `.github/AGENTS.md` covering three things: **when a changeset is needed** (a change to shipped behavior; nothing enforces this, and a change merged without one is simply not released yet); **the setup preconditions** — App, environment, required check, trusted publisher, bootstrap — and what each one's absence looks like at runtime; and **a debugging checklist for a failed publish**, ordered by how cheap each cause is to rule out: npm too old, a stray `.npmrc`, `id-token: write` missing, `environment:` missing or mismatched against the trusted publisher entry, workflow filename mismatched, owner/repo mismatched, then the OIDC env-var propagation bug as the last resort. Note the App private key as a cause of a *different* symptom — no Version PR at all, rather than a failed publish.
- [x] 5.2 Comment on ENG-161 with the account-level setup in dependency order — App with `contents: write` and `pull-requests: write` installed on this repo only, `release` environment restricted to `main`, npm org ownership, `0.0.0` bootstrap plus `npm deprecate`, trusted publisher naming `release.yml` and environment `release` with `npm publish` as the allowed action, then the required status check on `main` — stating plainly that none of it is observable until it exists, and that the Actions "create and approve pull requests" toggle is deliberately left **off**.
