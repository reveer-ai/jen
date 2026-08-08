# jen's own source

The CLI lives here, not in `src/`. `src/` is the governed project's checkout — gitignored, and the same thing in jen as in every project that adopts it.

## The payload declaration is the single source

`payload.ts` is the one statement of what jen owns. Both consumers read it: `scripts/stage-payload.js` at pack time, and the CLI's commands at install time. Never restate the file list in either — that is exactly how the two drift.

`scripts/stage-payload.js` is plain Node ESM with no build of its own, so it imports the declaration from `dist/payload.js`. **A build must precede staging.** `prepack` enforces the order; running the script standalone against a stale or missing `dist/` is the failure mode, and the script exits rather than staging a partial payload.

## Working copies stay unstamped

The stamp is applied during staging, never committed. jen's own checkout is not a managed install, and a stamp in `.claude/skills/` here would ship doubled. Staging refuses to stamp a file that already has a `metadata:` key, which is what that mistake looks like.

Adding a `metadata:` key to a stage skill for any other reason will therefore break `prepack`. If one ever needs one, the stamp insertion has to merge into the existing block instead of inserting a new one.

## Variable-set members must be able to carry the stamp

Deletion is the stamp intersected with the shipped payload, so a format with nowhere to put a stamp can never be reconciled. Markdown (frontmatter) and YAML (`#` comments) qualify; JSON does not. Adding a JSON file to a variable set fails staging — put it in a fixed path instead, or leave it project-owned.

## The tarball is `dist`-only

`files: ["dist"]` plus `prepack` is the whole packaging story, and `test/package.test.ts` asserts the tarball's contents both ways — what must be there and what must not. Anything added to `files` needs that test updated deliberately, not accommodated.

Known limitation: `prepack` does not run for an install straight from a git URL, and `dist/` is gitignored, so a git-URL install yields an empty payload. Adopters install from the registry; this is accepted, not solved.
