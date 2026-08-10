# @reveer/jen

## 0.1.0

### Minor Changes

- [`bcb529d`](https://github.com/reveer-ai/jen/commit/bcb529ded69c712d4c4f53119a0a711d9b73c941) Thanks [@joshtgi](https://github.com/joshtgi)! - Publish jen under Apache-2.0 and document adopting it. `package.json` declared `UNLICENSED` — no rights granted, of a package anyone could already install — and now declares `Apache-2.0`, with the license text shipped in the tarball. `keywords` makes the package findable by something other than its exact name.

  `README.md` is now the adopter's document rather than jen's build notes, which is what the registry has been publishing as the package's front page all along. It leads with the ownership boundary, because the cost of learning it late is a lost edit: root `AGENTS.md` and the shipped skills are jen's and are replaced wholesale on every update, `registry.yaml` and `.claude/settings.json` are written once and then yours, and everything else jen never touches. It spells out what the ownership stamp actually governs — deletion, not overwriting, so removing it from a skill jen still ships does not keep your edit — then walks the path from `npm i -D @reveer/jen` through `jen init`, binding with the `setup-jen` skill, and `jen update`. Contributor material moved to `CONTRIBUTING.md`.

  Root `AGENTS.md` and the `registry.yaml` stub both described a project as a _fork_ of jen. Installing replaced forking, so both now state the installed model: jen owns the repository root, and the project's own sources are tracked under `src/` in that same repository. Both files are shipped payload, so `jen update` replaces them with the corrected text.

- [`bcb529d`](https://github.com/reveer-ai/jen/commit/bcb529ded69c712d4c4f53119a0a711d9b73c941) Thanks [@joshtgi](https://github.com/joshtgi)! - Release the package from GitHub Actions with no stored credential. A changeset on a merged pull request opens a Version Packages pull request; merging that publishes to npm, authenticating by trusted publishing rather than a token, and records the release as a git tag and a GitHub Release.

- [`bcb529d`](https://github.com/reveer-ai/jen/commit/bcb529ded69c712d4c4f53119a0a711d9b73c941) Thanks [@joshtgi](https://github.com/joshtgi)! - Ship a `setup-jen` skill, installed into `.claude/skills/` alongside the six stage skills. It is the step between `jen init` and a pipeline that can run: it confirms which Linear team and project the repository's work is tracked in, checks the team for the eight statuses the stages move tasks through, creates the `epic` and `task` labels if they are missing, and fills in the `registry.yaml` stub `init` left behind.

  Run it once after `jen init`. It is safe to run again — it reports what is already correct rather than redoing it, so a run that ends with a status still to add in Linear is resumed by running it again once you have added it. It verifies statuses and never creates, renames, or maps one; a missing status is reported by name for you to add.

  Projects already on jen pick it up with `jen update`.
