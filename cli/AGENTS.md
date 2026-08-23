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

`run.ts` reads, decides, prints, and hands the dispatched set to a launcher it was given.
No tracker mutation, no git-host call, no file — which is what makes deciding safe to run
at any time, twice, and what lets two runners reach identical conclusions. `test/dispatch.test.ts` holds it both ways: every document the
tick sends must parse as a `query`, and the modules on its path must import nothing from
`node:fs`. Adding a write here is not a small change; it is the property being protected.

**Execution is injected rather than imported, and that is what keeps the guard honest.**
`tick()` takes a `Launch` and never reaches for `exec.ts`. Importing it directly would work
and would force the guard to be relaxed for a transitive import that legitimately writes —
and a relaxed guard no longer distinguishes the case it was written to catch. `run.ts` does
not even import the *type*: `LaunchResult` is declared structurally there, and `RunOutcome`
in `exec.ts` satisfies it while carrying more. `--dry-run` is the absence of a launcher, not
a branch around one, so a preview cannot decide differently from the run it previews.

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

## Workspace trust is the invocation's, and `-p` does not exempt a run from it

`-p`'s own help says the trust dialog is skipped in non-interactive mode, which reads like a
dispatched run is exempt. It is not. A fresh clone under `-p --permission-mode dontAsk` still
prints `Ignoring N permissions.allow entries from .claude/settings.json: this workspace has
not been trusted` and runs **as though the file were empty** — on every run, since every clone
is a path nothing has ever trusted. Under `dontAsk` the consequence is the failure the seeded
allow list exists to prevent, reached with nobody present to grant anything.

Three routes past it were verified against 2.1.220 rather than read off documentation:
`--settings` (works, and rejected — it leaves the project's own file inert, so a project could
never grant its runs a command jen does not ship, and jen cannot know a project's typecheck,
build, or test commands); overriding `HOME` (works, and rejected — it also relocates git's
config, ssh's known-hosts, and npm's cache, which a stage's own build reaches for); and
`CLAUDE_CONFIG_DIR`, which moves exactly the one store that needs moving. That is what
`exec.ts` uses, writing `projects[<clone>].hasTrustDialogAccepted` into a store the run throws
away.

**`CLAUDE_CONFIG_DIR` is not in `claude --help`.** The mitigation is worth more than the
choice: the run scans the session's stderr for that warning and fails the run on it. The check
is on the *symptom*, so it holds whatever the mechanism, and it catches the variable being
withdrawn as readily as a path written wrong. Do not soften it into a warning — the whole
point is that it turns a denial found halfway through a run into a first-second failure.

**The clone path must be `realpath`'d before the trust entry is keyed by it.** This is not
tidiness and it is not obvious: on macOS the system temporary directory is a symlink, so
`mkdtemp` hands back `/var/folders/…` while the session resolves its own workspace to
`/private/var/folders/…`. Key the entry by the unresolved path and the lookup misses, the
workspace reads as untrusted, and the permissions are silently inert — the exact failure this
module exists to prevent, by a route that looks impossible. It was found by a test, not by
reasoning, and the stderr check above is what would have made it loud in production.

## A run's clone cannot use `--branch`

`git clone --branch <branch>` fails when the branch does not exist, and **`design-task` runs
against a branch that does not exist yet** — the request carries the tracker's *suggested*
branch name, and design is the stage that first creates and pushes it. So a clone insisting on
the branch would fail every design dispatch, which is the pipeline's entry point, before the
session could report anything useful. `exec.ts` clones at the default branch, then fetches and
switches, falling back to creating the branch locally. It never pushes it: pushing is the
stage's, and a branch pushed by the executor is a branch with no commit explaining it.

Clones are full rather than shallow, and this is load-bearing rather than lazy. Stages read
history — the resume convention has them check commits against completion markers — and
`openspec archive` and delivery both work over more than one commit.

## The outcome is read from every signal, because no one of them is the whole story

ENG-164 was opened saying an in-run failure prints as the result rather than raising the exit
code. Verified against 2.1.220, an authentication failure raised **both** — exit 1 and
`is_error: true`. So reading either alone is right by accident and wrong the first time a
failure reports only one. `verdict()` fails on any of four: the stderr warning above, a
non-empty MCP failure off the `system/init` event, `is_error` on the result, and a non-zero
exit. They agree on success, and a disagreement is a failure either way.

Reading the init event is what forces `--output-format stream-json` and therefore `--verbose`,
which it requires. Plain `json` returns only the final result, and a session that never reached
the tracker cannot announce itself — which feeds straight back into the next tick dispatching
that task again.

**Two shapes of MCP failure exist and both are read**: an explicit `mcp_server_errors` list,
and an `mcp_servers` entry whose status is anything but `connected`. The task was written
against the first; the second is what has actually been observed. A check knowing only one of
them passes a session that never reached the tracker.

## A session gets its own role's token and none of another's

`credentialsFor` reads only the named role's variables, and `exec.ts` then strips **every**
`JEN_GH_*` variable out of the child's environment rather than filtering it down. A runner
configured for all three roles holds all three private keys, and a session inherits whatever
the runner's environment held. It needs none of them: it acts through the minted installation
token, already scoped to its own installation and expiring on its own.

The app slug comes from `GET /app` under the JWT rather than from a tenth environment
variable. `registry.yaml` records an `app` name per role, but the executor reads no files, and
a renamed app would otherwise commit under a name that no longer exists.

The tracker's `--mcp-config` payload is written to a file inside the run's own config
directory, never passed inline. A command line is readable by every process on the host, and
that string carries the tracker credential. The file goes with the directory when the run ends.

**The same rule governs the clone, and it is easy to break there without noticing.** An
installation token spliced into the clone URL is an argv element of `git clone` — the same
exposure, on the same host, and argv is the worse hiding place of the two:
`/proc/<pid>/cmdline` is world-readable where `/proc/<pid>/environ` is owner-only. So
`remoteUrl` carries the username and no credential, and `GIT_ASKPASS` points at a script in
the run's config directory that echoes `GH_TOKEN`. The session inherits both, which is what
lets it push through the same clone afterwards — the credential is supplied at each use and
goes with the run rather than sitting in `.git/config` for the length of it.

**Setting the token without setting `user.name`/`user.email` is a silent bug.** The token
governs what a run may *do*; the git config governs what the history *says* it was. Leave the
second out and commits carry whatever identity the host has configured — a person's, on a
local runner — and the attribution `pipeline-identity` builds its audit story on stops being
true without anything failing.

**The noreply address is keyed by the bot user's id, not the app's, and nothing tells you
when you have used the wrong one.** They are different numbers for the same app —
`reveer-jen-dev[bot]` is app `4588651` and user `316769915`; `github-actions[bot]` is `15368`
and `41898282` — and an address built from the app id is accepted by every layer that handles
it and resolves to no account, so the commit renders with an unlinked name. That is the
attribution failure the paragraph above warns about, reached from *inside* the mitigation and
looking exactly like success. `installation()` therefore makes a third request,
`GET /users/<slug>[bot]`, and raises rather than falling back if the host names no id. It goes
under the minted installation token rather than the JWT: the JWT authenticates the *app*, and
a user lookup is an ordinary read rather than an app endpoint.

## A stop has to reach the steps between children, not only the running one

`terminate()` kills what is in `#live`. Nothing not yet spawned is in it — and a run's first
step is minting, which reaches the network with no child in existence at all. So a signal
landing in that window left the run to clone, configure, and start a full session after it had
been told to stop: money spent, and a stage writing to the tracker and pushing commits past
its own cancellation. `#spawn` refuses once `#terminating` is set, which puts the refusal on
the path the existing `catch` already handles and leaves the cleanup unchanged.

The outcome distinguishes the two stops, and `see()` in `run.ts` reads both: `sessionStarted`
false means nothing ran, true means the task holds whatever the session got to. `terminated`
is not the raw flag either — read straight off it, a run that had already finished and
succeeded reported as stopped, and the report then described a completed stage as one left
mid-session.

**A cleanup that failed is reported, not swallowed.** Removing the run directory is the whole
of how `stage-execution`'s "no credential remains on the host" is satisfied — `config/mcp.json`
holds the tracker's, live until someone rotates it — so the single case that violates the
requirement must not be the single case nothing says anything about. (The git token is not
among what is left behind, and only because of the `GIT_ASKPASS` arrangement above: put it
back in the clone URL and it sits in `.git/config` here too.) It is added to the run's
failures rather than raised over them, so it never masks the session's own outcome.

## Only the tracker's own key earns the tracker's diagnosis

A run's clone is a full jen installation, so a project's own `.mcp.json` contributes MCP
servers beside the one the executor passes. `readStream` keeps each failure's server name and
`verdict` reserves "the tracker connection did not initialize" for `TRACKER_SERVER`; anything
else is named as itself. Pooling them sends whoever reads the report after the wrong system
entirely, and the report is all an unattended run leaves behind.
