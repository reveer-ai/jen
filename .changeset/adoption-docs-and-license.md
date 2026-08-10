---
"@reveer/jen": minor
---

Publish jen under Apache-2.0 and document adopting it. `package.json` declared `UNLICENSED` — no rights granted, of a package anyone could already install — and now declares `Apache-2.0`, with the license text shipped in the tarball. `keywords` makes the package findable by something other than its exact name.

`README.md` is now the adopter's document rather than jen's build notes, which is what the registry has been publishing as the package's front page all along. It leads with the ownership boundary, because the cost of learning it late is a lost edit: root `AGENTS.md` and the shipped skills are jen's and are replaced wholesale on every update, `registry.yaml` and `.claude/settings.json` are written once and then yours, and everything else jen never touches. It spells out what the ownership stamp actually governs — deletion, not overwriting, so removing it from a skill jen still ships does not keep your edit — then walks the path from `npm i -D @reveer/jen` through `jen init`, binding with the `setup-jen` skill, and `jen update`. Contributor material moved to `CONTRIBUTING.md`.

Root `AGENTS.md` and the `registry.yaml` stub both described a project as a *fork* of jen. Installing replaced forking, so both now state the installed model: jen owns the repository root, and the project's own sources are tracked under `src/` in that same repository. Both files are shipped payload, so `jen update` replaces them with the corrected text.
