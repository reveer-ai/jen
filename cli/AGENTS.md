# jen's own source

The CLI lives here, not in `src/`. `src/` names the same *location* in jen as in every project that adopts it — the project's own sources, under a root the workflow owns — but not the same tracked-ness: an adopter's sources are its repository's content and are tracked, while jen governs no sources of its own, so its `src/` holds only working checkouts and is gitignored. That is jen's arrangement, not a rule adopters inherit; jen writes no ignore file into a project.

## The payload declaration is the single source

`payload.ts` is the one statement of what jen owns. Both consumers read it: `scripts/stage-payload.js` at pack time, and the CLI's commands at install time. Never restate the file list in either — that is exactly how the two drift.

`scripts/stage-payload.js` is plain Node ESM with no build of its own, so it imports the declaration from `dist/payload.js`. **A build must precede staging.** `prepack` enforces the order; running the script standalone against a stale or missing `dist/` is the failure mode, and the script exits rather than staging a partial payload.

## The skills jen ships are not the pipeline's stages

`SKILLS` is every skill the payload writes into a project. Six of them are stages a Linear status triggers; `setup-jen` is not, and a future one need not be either. The two lists diverged the moment a non-stage skill shipped, and the payload declaration tracks the first. Nothing reading it asks which skills a status triggers — staging, installation, reconciliation, and the help text all want what `init` writes — and stage-ness already lives in the root `AGENTS.md` stage table and in the `task-pipeline` capability. A second list here would be a third statement of it, drifting on the first workflow change nobody thought to mirror into the CLI.

The help text is where the distinction bites: it counts what `init` writes, so counting stages would have reported six while seven landed.

**A second variable set over `.claude/skills` is forbidden, and this is not obvious from reading `plan.ts`.** `reconcileCandidates` derives its search from a set's own `targetDir` and `memberShape`, and `planInstall` runs it once per set. Two sets over one directory therefore derive the same shape, search the same locations, and return the same candidates — so a single stamped orphan lands in `plan.deletions` twice: a duplicated line in the run's report, and a second `unlink` of a path that is already gone. Nothing in the code guards against it, because until now there has only ever been one set. Add a skill to `SKILLS`; do not add a set beside it.

## Working copies stay unstamped

The stamp is applied during staging, never committed. jen's own checkout is not a managed install, and a stamp in `.claude/skills/` here would ship doubled. Staging refuses to stamp a file that already has a `metadata:` key, which is what that mistake looks like.

Adding a `metadata:` key to a shipped skill for any other reason will therefore break `prepack`. If one ever needs one, the stamp insertion has to merge into the existing block instead of inserting a new one.

## The scaffold ships from `scaffold/`, not from jen's own `.claude/`

`scaffold/settings.json` is what `jen init` writes into an adopter as `.claude/settings.json`. jen's own `.claude/settings.json` is a different file with a different job — a local config a contributor may add permissions to for jen's own build. Editing one does not change the other, deliberately: an adopter's seed should not shift because someone allowed a command here.

**An agent cannot edit jen's own `.claude/settings.json`.** It is the file granting the running session its permissions, and the harness denies the write — correctly, since an agent widening its own allow list is what that guard exists for. So a change that adds permissions here lands in two halves that do not run in the same place: `scaffold/settings.json` an agent edits normally, and jen's own file a human applies by hand. Plan the task that way rather than discovering it at the write, and never route around the denial with a different tool.

**A workspace the harness has not trusted ignores the allow list entirely.** Installing 0.1.0 from a packed tarball into a scratch project and running `claude` there prints `Ignoring 8 permissions.allow entries from .claude/settings.json: this workspace has not been trusted`, and the session runs as though the file were empty. Trust is keyed by absolute path in `~/.claude.json`, so a dispatched run — a fresh clone at a path nothing has trusted — hits this every time, not just on a developer's first local run. Whatever the seed grants is inert until the invocation establishes trust, which makes it the invocation's problem rather than the scaffold's; the file itself is correct.

Scaffold files are written only when absent, and never again — not by `update`, not by `init --force`. `--force` exists to resolve one ambiguity, whether an unstamped fixed path is jen's or the project's, and a filled-in `registry.yaml` is not ambiguous.

**Nothing in this repo reads `scaffold/`.** Its files are inert text here and only become instructions in an installed project, so a name one of them points at can be wrong for a release without anything here noticing — which is how `registry.yaml` shipped telling adopters to run a skill that had never existed under that name. `test/payload.test.ts` closes the one case it can check by construction: every `` `X` skill `` a scaffold file names must be in `SKILLS`. Anything else the scaffold points at is only as correct as the last person to read it in an installed project.

## The stamp gates deletion, not overwriting

Worth stating outright, because it is easy to read the ownership stamp as "this file is jen's" and conclude that removing it makes the file the project's. It does not, and an adoption run caught exactly that assumption in draft documentation.

`planInstall` writes every payload file to its declared target unconditionally — the stamp is not consulted on that path at all. It is read in one place: reconciliation, where a candidate in a variable set's target directory that the payload *no longer ships* is deleted only if stamped. So:

| The file | Stamped | Unstamped |
|---|---|---|
| still in the payload | overwritten | overwritten, and re-stamped |
| dropped from the payload | deleted | left alone |
| never in the payload | left alone | left alone |

The only thing unstamping buys an adopter is keeping a skill a later version dropped. There is no supported way to hold an edit to a skill jen currently ships, and documentation must not imply one — telling an adopter their edit is safe in precisely the case where it is lost is worse than saying nothing.

## The planner writes nothing

`plan.ts` reads; `apply.ts` writes. Nothing in `plan.ts` may touch the filesystem, and no write may move into it for convenience.

The reason is the refusal path: `jen init` on a project that already holds a fixed path must leave *no* trace — no skill, no scaffold, nothing. With the two phases separate, that is `plan.conflicts.length > 0 → return`, and it stays true however the writing code is later rearranged. Interleaved, it would be a property of statement order, and one write hoisted above the guard leaves an adopter with half a payload and an error.

Idempotency and the run's report both fall out of the same split: the report is the plan rendered, and a second run is a plan with an empty write set.

## The project boundary is physical, not lexical

Comparing resolved path *strings* against the project root proves nothing: `existsSync`, `readdirSync`, `mkdirSync`, and `writeFileSync` all follow symlinks, so an in-bounds path can name a write anywhere on the filesystem. Adopters really do symlink these paths — `AGENTS.md → CLAUDE.md` is a common one, and a shared `.claude` is not exotic.

Two rules, and they are not the same rule:

- **A link *at* a managed path** is content the project put there, and jen owns the path — so `apply` unlinks before writing, and the planner counts it as present (making a symlinked fixed path a conflict for `init`). Note the dangling case: `existsSync` follows a dead link and answers *false*, which is why every check of a project path in `plan.ts` goes through `entryKind`/`lstat` and never `existsSync`.
- **A link *on the way to* one** is somewhere else's directory, and everything below it belongs to whatever it points at. The run refuses outright — both commands, `--force` included, writing not even the paths it could have reached.

`containedPath` enforces both in the executor, so a hand-built or stale plan cannot get around them either. Anything new that touches the filesystem goes through it rather than `resolveInProject`.

## Resolving the OpenSpec binary goes through the bare specifier

OpenSpec's `package.json` declares `exports` with only `"."`, so the obvious first attempt fails:

```
import.meta.resolve('@fission-ai/openspec/package.json')  →  ERR_PACKAGE_PATH_NOT_EXPORTED
import.meta.resolve('@fission-ai/openspec')               →  …/@fission-ai/openspec/dist/index.js
```

`openspec.ts` therefore resolves the bare specifier and walks up to the directory holding `package.json` to read `bin.openspec`. Not `node_modules/.bin/openspec`: that shim lives in jen's install tree, which is not the project's under a global or `npx` install. Not `npx @fission-ai/openspec` either — that needs the network and floats off the version the lockfile pins.

## Variable-set members must be able to carry the stamp

Deletion is the stamp intersected with the shipped payload, so a format with nowhere to put a stamp can never be reconciled. Markdown (frontmatter) and YAML (`#` comments) qualify; JSON does not. Adding a JSON file to a variable set fails staging — put it in a fixed path instead, or leave it project-owned.

## The tarball is `dist`-only

`files: ["dist"]` plus `prepack` is the whole packaging story, and `test/package.test.ts` asserts the tarball's contents both ways — what must be there and what must not. Anything added to `files` needs that test updated deliberately, not accommodated.

Known limitation: `prepack` does not run for an install straight from a git URL, and `dist/` is gitignored, so a git-URL install yields an empty payload. Adopters install from the registry; this is accepted, not solved. `stagedPayloadDir()` is where it surfaces — it fails naming the missing directory rather than adopting a project with nothing to write.

Running the CLI from source has the same shape: `import.meta.resolve` puts the payload beside the module, and there is no `cli/templates/`. Tests inject a staged directory through `RunOptions.templates`; the tests that exercise real resolution spawn the built `dist/index.js`.

## Exercising it as an adopter

Tests inject a staged payload and never see the tarball, a real `openspec init`, or an adopter's `node_modules`. Getting all three means packing and installing:

```
npm pack --pack-destination /tmp
cd /tmp/proj && git init && npm init -y && npm i -D /tmp/reveer-jen-*.tgz && npx jen init
```

`npm pack` runs `prepack`, so the tarball is built and staged by construction — running the CLI out of the working tree skips staging and proves nothing about what ships.

**`openspec init` writes into `.claude/skills/` too.** Its nine `openspec-*` skills land beside jen's, at exactly the depth reconciliation searches, and survive `jen update` only because they carry no stamp. Deletion must stay the stamp intersected with the payload: rewrite it as "whatever is in the target directory that the payload does not ship" and every one of them disappears on the next update. `messyProject` carries one by hand for that reason — the fixtures never run the delegation that would put them there for real, so without it the widened rule passes every unit test.

## The tick writes nothing, and that is why the announcement is the session's

`run.ts` reads, decides, prints, and exits. No tracker mutation, no git-host call, no file
— which is what makes it safe to run at any time, twice, and before `ENG-164` exists to
consume anything it emits. `test/dispatch.test.ts` holds it both ways: every document the
tick sends must parse as a `query`, and the modules on its path must import nothing from
`node:fs`. Adding a write here is not a small change; it is the property being protected.

The cost of that is worth stating, because it looks like an oversight. The comment marking
a task as taken is written by the **session**, once it is up, rather than by the dispatcher
at dispatch time. So a session that dies between being emitted and announcing itself leaves
no evidence it was started, and the next tick emits it again. The window is process start to
first tracker write — seconds against a session that runs for minutes — and the concurrency
cap bounds how many can sit in it at once. Closing it would mean the tick writes, and a
writing tick is permanent where this hole is bounded and self-correcting.

The exposed failure with no backstop at all is a stage that *forgets* its announcement: it
is re-dispatched every tick and does real work each time. There is no failure counter to
catch it, deliberately. The announcement being the first thing a session does is the whole
mitigation.

## The in-flight test ignores the marker's stage, on purpose

`inFlight` takes the most recent comment carrying a `jen:run` marker and answers on its
`event` alone. It does **not** check that the marker's `stage=` matches the stage the task's
current status maps to, and it must not start: a session that has already moved the status
and is still writing its closing comment is a session still working the task, and matching
on stage would dispatch the next stage on top of it.

It also does not filter by comment author. `design.md` describes the test as reading the
tracker agent's own comments, and the tick has no agent identity to compare against — it
receives a team and a project and nothing else, by requirement. Establishing one would cost
a third query for a `viewer` id, to defend against a human hand-pasting an HTML comment.

## The comment page proves its own order rather than trusting the documented one

This is the section that reads like defensive noise until you know what it is defending
against, so the failure comes first. The in-flight test looks at the most recent marked
comment and nothing else. If a bounded page of ten comments came back *oldest*-first, every
announcement a long-running task has ever carried sits behind the bound, the task reads as
never announced, and a session is dispatched against it on every tick — forever, with no
error anywhere, and doing real work each time. Nothing degrades. It just never stops.

Linear documents `orderBy: createdAt` as descending and `linear.ts` requests it explicitly.
That is not evidence, and sorting the page afterwards is not a guard: a sort orders what came
back and says nothing about what stayed behind the bound. So `holdsNewest` makes the page
carry its own — the first `createdAt` against the last says which way the connection runs.
Descending with more behind it means this page is the newest and costs nothing; ascending
means it is the oldest; too short or tied to tell means unproven, which is treated as
oldest. A page with nothing behind it is the whole record either way.

`established` in `run.ts` is two loops because the two cases need different ones, and this
is the part worth reading before editing it. From a page known to be the newest, every
further page is strictly older, so the first marker found walking backward is the most recent
one and the walk stops there. From a page that is *not* known to be the newest, paging
forward walks toward newer comments — stopping at the first marker would settle on a stale
one, so the walk has to reach the end before anything is read out of it. Collapsing these
into one loop reintroduces exactly the bug the evidence exists to prevent.

The check is a comparison, not a judgment, so the dispatch path keeps its property that two
ticks over identical state reach identical conclusions. **Do not replace it with a one-off
verification against the live API**: that settles the question for one identity at one moment
and re-opens it silently, which is the worst shape a check can have when the failure it guards
is invisible.

**What the fallback costs is `COMMENT_PAGE_BUDGET` requests for that issue, not one.** Neither
walk ends on its own in the case that matters. The backward one stops at the first marker, so a
task that has been through a session once is cheap forever after — but a task nothing has ever
announced against has no marker anywhere, and the walk drains its whole record. The forward one
has no early exit *at all*, by construction: stopping early is the bug it was split out to
avoid. So if the connection ever does come back ascending, every issue past one page would
re-read its entire history on every tick, forever, growing with the discussion rather than
settling. The budget is what makes that a bounded cost instead of an unbounded one.

Exhausting the budget **declines the candidate**; it never falls through to `inFlight(…) ??
false`. "Not in flight" is what dispatches, so reading an unfinished record as idle would start
a session on top of a live one — the same failure the ordering evidence exists to prevent,
reached from the other side. The decline says `unproven` and names `--comment-page`, which is
the operator's lever: raising it moves how far the same number of requests reaches, which is
why the budget itself is not a second flag.

## A candidate is a task, and the label is a gate rather than a filter

Candidacy is the status *and* the `task` label. The first live tick against jen's own
project dispatched three issues and two were epics — ENG-136 and ENG-133 sit in stage
statuses as a matter of course, because their children are what is moving. A stage dispatched
against an epic spends a whole session establishing there is nothing to implement, and marks
the epic in flight while it does.

The label is tested in the tick, in `notATask`, and deliberately **not** put in the poll's
server-side filter even though that would be free. Filtering means the issue is never
fetched, so it can never appear in the report — and a person who moved an issue into a stage
status and saw nothing happen would have nowhere at all to find out why. Silence there is
indistinguishable from a pipeline with nothing to do. Fetching a handful of epics costs
nothing against a poll measured at 7 points.

`EPIC_LABEL` is read only to tell one decline from the other in the report. Candidacy rests
on `TASK_LABEL` alone, so an issue carrying neither label never dispatches — which is a real
behaviour change for a human-created issue moved straight into `In Design`, and the intended
one. The gate runs before the comment read, so a non-task never triggers the paging fallback.

## The status table is a second statement of the workflow's, held by a test

`stages.ts` restates the stage table in the root `AGENTS.md`, and cannot do otherwise — the
tick reads no files, and the scheduled runner never checks the repository out. So the
mitigation is `test/stages.test.ts`, which parses the table out of `AGENTS.md` and asserts
the compiled one matches, in the idiom `payload.test.ts` uses for the scaffold's skill
references. Same for the announcement marker, which has seven statements: six skills and
`MARKER`. Edit either statement and CI fails here, which is where both of them live.

Candidacy is an allow list for the same reason it is everywhere else in this file: a team
will add statuses jen has never heard of, and the failure mode of a deny list is dispatching
a stage against a task in a status nobody intended.

## The client names every field, so drift fails loudly

`linear.ts` writes out each field it wants rather than reaching for a fragment or the SDK's
generated documents. A removed field then fails at the tick with the tracker's own message.
The failure this avoids is the quiet one: an empty candidate set is indistinguishable from a
healthy quiet pipeline, so a client that swallowed a query error would report a working
dispatcher for exactly as long as nobody went looking. Every error path raises; none returns
an empty result.

`RATELIMITED` arrives as HTTP 400 with the code in the body rather than as a 429, so it is
matched by code and not by status. There is no retry anywhere in the client: the pipeline's
answer to a failed tick is the next tick.

## Every bounded connection asks for `pageInfo`, and something reports the truncation

Four connections in `linear.ts` are bounded — the team's statuses, the project's issues, an
issue's labels, an issue's comments — and each one asks for `pageInfo { hasNextPage }` beside
its nodes. Add a fifth and it carries the flag too.

This is the same failure as the swallowed query error, one level down. A bound with no flag
cannot tell a short answer from a truncated one, so a project with more issues in stage
statuses than the page holds loses the overflow entirely: not dispatched, not declined, not
named anywhere, nothing errors, exit 0. That is indistinguishable from a healthy quiet
pipeline, which is precisely the shape this client exists to refuse.

The tick does not *page* any of them, and does not need to. What it owes a person is that the
report account for everything sitting in a stage's status, and a `note` line naming the bound
satisfies that where paging would make every tick's cost scale with a project's backlog. What
each truncation changes is a claim:

| Connection | What silence would have asserted |
|---|---|
| statuses | that the team has no `Pending`, or none of a stage status — when neither was read |
| issues | that the pipeline is quiet |
| labels | that nothing has refined the issue |
| comments | that no session is working the task — the one that dispatches |

Only the last can start a session on wrong evidence, which is why only the last declines
rather than annotates. The other three report and carry on.

## `run()` hands back a number or a promise

`jen run` is the first asynchronous command. `cli.run` returns `number | Promise<number>`
rather than widening `init` and `update`, which are synchronous and whose callers depend on
it — `test/install.test.ts` narrows the union at its one call site rather than casting, so an
installer that quietly became asynchronous fails loudly instead of comparing a pending
promise against an exit code.
