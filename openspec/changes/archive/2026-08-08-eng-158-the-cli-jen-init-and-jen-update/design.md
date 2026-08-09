## Context

See proposal.md — Why. The contract this implements is already merged: `cli/payload.ts` declares fixed paths and variable sets, `scripts/stage-payload.js` stamps variable-set members into `dist/templates/` at pack time, and `openspec/specs/managed-payload/` states the deletion rule. Nothing reads any of it yet.

Constraints that shape the approach:

- **Every guarantee that matters is a negative one.** Never outside a managed path, never an unstamped file, nothing written before a refused adoption returns. Negatives are not expressible as "the happy path worked", so the structure has to make them checkable rather than incidental.
- **jen never runs against itself.** `prepack` stages from the working copies; jen has no installed payload. So every path in this change is exercised only by tests and by adopters, and the tests have to supply the divergence a real project would.
- **The package is installed, not cloned.** Paths resolve relative to the installed module, never to the working directory, and the target project is an argument rather than an assumption.

## Goals / Non-Goals

**Goals:**

- One code path for both commands, so `init` and `update` cannot drift in how they write or reconcile.
- A refused adoption is provably inert — not "we checked first", but structurally unable to have written.
- Reconciliation derives its search from the declaration, so a future variable set needs no change here.

**Non-Goals:**

- Rollback of a partially applied run. See Risks.
- A `--dry-run` flag. The structure below makes it nearly free, but nothing in the specs asks for it and an unused flag is a maintained one.
- Any Linear, network, or credential access. The CLI stays a file manager; binding is ENG-160's skill.

## Decisions

### Plan first, then execute

The run is two phases. A **planner** reads the project and the staged payload and returns a description of what would change — writes, deletions, conflicts, and paths already correct. An **executor** takes that plan and performs it. The planner touches nothing.

*Why:* the spec requires that a refused adoption leave no trace, including no stage skill and no scaffold file. Interleaving checks with writes makes that a property of statement ordering — one reordered line and a project has half a payload and an error. With a plan, refusal is `plan.conflicts.length > 0 → report and return`, before the executor is ever called, and the guarantee holds no matter how the writing code is later rearranged.

It also makes the other requirements fall out rather than needing their own machinery: reporting is the plan rendered, and idempotency is a plan with an empty write set.

*Alternative rejected:* write as you go with an upfront guard. Shorter, and correct the day it is written. The failure mode is that it stays correct only as long as nobody adds a write above the guard.

### `init` and `update` are the same operation with three flags

Both write the payload and reconcile. `init` additionally writes the once-only scaffold, applies the fixed-path refusal, and initializes OpenSpec. That is the entire difference, so it is expressed as options on one operation rather than two implementations.

*Why:* the two commands share every invariant in the specs. Two implementations means two places for "never delete an unstamped file" to be true, and the second one is where it stops being true.

*Note:* `init` reconciles too. On a fresh project there is nothing to delete, so this is only observable under `--force` on an already-installed project — where deleting a skill the current version dropped is what the user asked for.

### The payload is located relative to the module, never the working directory

The compiled entry is `dist/index.js` and the staged payload is `dist/templates/`, so the payload resolves as `new URL('./templates/', import.meta.url)`.

*Why:* this is correct under every install shape — global, `npx`, project devDependency — without consulting `process.cwd()`, `process.argv[1]`, or any environment variable. The target project is a separate, explicit argument defaulting to the working directory, so the two never get confused.

### Resolving the OpenSpec binary goes through the bare specifier

OpenSpec's `package.json` declares `exports` with only `"."`, which was verified during design:

```
import.meta.resolve('@fission-ai/openspec/package.json')  →  ERR_PACKAGE_PATH_NOT_EXPORTED
import.meta.resolve('@fission-ai/openspec')               →  …/@fission-ai/openspec/dist/index.js
```

So resolution resolves the bare specifier, walks up to the directory holding `package.json`, reads `bin.openspec` (`./bin/openspec.js`), and spawns it with `process.execPath`, cwd set to the target project.

*Why not the `.bin` shim:* `node_modules/.bin/openspec` exists in jen's install tree, which is not the project's tree under a global or `npx` install. Resolving through jen's own module graph works in all three shapes.

*Why not `npx @fission-ai/openspec`:* it needs the network and floats to a version that may differ from the one jen depends on — the exact drift the "depend, never vendor" decision exists to prevent.

*Why spawn rather than import:* the `"."` export is a library surface, not the CLI, and coupling to it would make OpenSpec's internal API a compatibility surface for jen. A subprocess couples to documented flags instead.

Initialization is skipped when the project already holds an `openspec/` directory — the same signal OpenSpec's own tooling uses, and cheap enough to check without spawning anything.

### The stamp is read back by scanning, not parsing

Detection mirrors how staging writes it: take the frontmatter block, and look within it for a `metadata` mapping containing `jen: true`.

*Why:* staging inserts the stamp as text specifically to stay byte-deterministic, and a reader that parses YAML would accept forms staging never produces while adding a dependency to do it. `test/helpers.ts` already scans frontmatter this way for the packaging tests, so the repository has one idea of what frontmatter is rather than two.

*Consequence, accepted:* a hand-written `metadata: {jen: true}` in flow style is not recognized as a stamp. Nothing jen writes looks like that, and the failure is safe in the direction that matters — an unrecognized file is left alone, never deleted.

### Reconciliation derives its search from the declaration

For each variable set, the candidate locations are computed from the set's own declared members — their common shape relative to `targetDir` — rather than hardcoding `SKILL.md` or a depth. Enumerating one level of `targetDir` and testing that shape yields the candidate set; a stamped candidate absent from the shipped payload is deleted.

*Why:* the spec forbids walking the project, and hardcoding the shape would satisfy that while quietly making the next variable set a code change here. Deriving it means adding a set to the declaration is still adding data.

*Why one level:* the shape is `<targetDir>/<slot>/<file>`, so anything deeper is not a location the set can write and is therefore not jen's to delete.

### Content is written only when it differs

Before writing, the planner compares the staged bytes against what is on disk and classifies the path as *write* or *already current*.

*Why:* it makes "a second run changes nothing" literally true at the filesystem level rather than true only of content, keeps mtimes stable so watchers and build caches are not disturbed, and makes the report honest — "6 skills refreshed" when five were untouched is noise that trains people to ignore the output.

### Scaffold is declared as data, beside the payload

`registry.yaml` and `.claude/settings.json` are declared in `cli/payload.ts` alongside `PAYLOAD`, as a separate set with a different write rule: written when absent, never stamped, never reconciled, never overwritten — including under `--force`. Their content ships as staged files under `dist/templates/`, named for their role rather than for an assistant, so the staged tree stays tool-neutral as `npm-package` requires.

*Why beside rather than inside:* the two obey opposite rules — managed files are overwritten and reconciled, scaffold is written once and then belongs to the project. Folding them into `PAYLOAD` would mean a per-entry exception on every operation that walks it, and the deletion rule is not something to make conditional.

*Why staged files rather than string literals in the CLI:* jen's existing pattern is that content lives in files and code moves them, with `stage-payload.js` the single place content is assembled. A JSON blob inline in the CLI is content that no longer travels with the rest.

*Why `--force` does not extend to it:* the flag exists to resolve one ambiguity — whether an unstamped fixed path is jen's or the project's. A project's filled-in `registry.yaml` is not ambiguous.

### The ignore check delegates to git, and stays optional

Where the project is a git repository and `git` is available, `git check-ignore` decides whether a managed path is ignored; the result is reported, never acted on. Where either is missing, the check is skipped.

*Why:* ignore semantics are more than the root `.gitignore` — nested files, negations, `core.excludesFile`, `.git/info/exclude` — and reimplementing them to produce a warning would be a large amount of subtly-wrong code. Delegating is exact. Skipping when git is absent is right because the check is advisory: a non-repository has no ignore rules to violate.

## Risks / Trade-offs

- **A partially applied run leaves a mixed project** if a write fails midway — a full-tree transaction would need a staging copy and an atomic swap, which is disproportionate here. → Both commands are re-runnable and converge, the planner makes the second run a no-op for whatever already landed, and the executor reports the paths it completed before failing. Accepted rather than solved.
- **The stamp scan is the single point of failure for the deletion rule.** A bug that reports "stamped" too readily deletes a project's file. → It is tested in both directions with the fixture supplying the adversarial cases — stamped-but-shipped, stamped-and-dropped, unstamped-and-dropped, and a stamp deliberately removed to claim a file — and the safe failure direction is chosen where the scan is ambiguous.
- **`openspec init`'s flags are a compatibility surface.** OpenSpec could rename `--tools` or change `--no-animation`. → Failure is loud (non-zero exit, reported) rather than silent, the dependency range is caret-pinned to a major, and nothing about jen's payload depends on the outcome.
- **The staged tree gains a scaffold directory**, which `test/package.test.ts` and `test/stage-payload.test.ts` assert the shape of. → Those assertions are updated deliberately as part of this change, not loosened to accommodate it; `npm-package`'s "exactly six skill directories" and "no assistant-named path" both still hold.
- **`jen init` installs an `AGENTS.md` that describes adoption by forking.** → Known and accepted at ENG-156; ENG-162 rewrites it. Worth stating that the first real adopter sees it.

## Migration Plan

Nothing is published by this change and no adopters exist, so there is nothing to migrate. Both commands currently exit 1 with "not implemented yet"; after this they do their work. `cli/index.ts` loses that stub text and the release note in `USAGE` describing the package as payload-declaration-only.

Rollback is `git revert` — jen writes nothing outside a target project, and no target project exists yet.
