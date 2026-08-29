## Context

See `proposal.md` — *Why*. The state this design starts from, in the terms the implementation needs:

`childEnvironment(base, credentials, token, configDir, askpass)` in `cli/exec.ts` copies `base` wholesale, skipping keys prefixed `JEN_GH_`, then sets seven variables of jen's own over the top — `CLAUDE_CONFIG_DIR`, `ANTHROPIC_API_KEY`, `LINEAR_API_KEY`, `GH_TOKEN`, `GITHUB_TOKEN`, `GIT_ASKPASS`, `GIT_TERMINAL_PROMPT`. It is called once, from `#session`, which already holds the `RunRequest` and therefore already holds `request.skill`. Nothing else calls it.

Two constraints bound what can be done here. `stage-execution` requires that execution exercise no judgment about what to run and know nothing about what produced a request, so nothing in this may consult the tracker or behave differently under one runner than another. And `RunOutcome.ok` is derived as `failures.length === 0`, so anything pushed onto `failures` fails the run — which matters because this change needs to report something without failing anything.

## Goals / Non-Goals

**Goals:**

- A session's inherited environment is described by the spec rather than being an undocumented consequence of a loop.
- An operator can withhold a named variable from every stage but one, and the arrangement keys on the stage.
- jen's own namespace stops reaching sessions.
- An operator who configures nothing observes no change.

**Non-Goals:**

- Deciding *which* variables a project ought to declare. jen cannot know, and the proposal's rejection of deny-by-default rests on it.
- Delivering values to the scheduled runner. Filed separately; the workflow is a managed file.
- Any sandbox property. A session runs commands the project grants it, and this changes what is in the environment rather than what a session may do with it.

## Decisions

### The restriction is derived from `request.skill`, not from the role

`#session` already has the request. `childEnvironment` gains the skill name and derives the variable token from it — uppercased, `-` to `_`, so `test-task` becomes `TEST_TASK` and the operator writes `JEN_ENV_TEST_TASK`. This mirrors `VARIABLES` in `cli/github.ts`, which builds `JEN_GH_APP_ID_<ROLE>` from the role the same way, so an operator reading either has learned the other.

*Alternative considered:* a lookup on `STAGES` keyed by status. Rejected — the request names a skill, not a status, and re-deriving the stage from anything would be the judgment `stage-execution` forbids execution from exercising.

### Scoping requires reading every stage's list, not just this stage's

The non-obvious part. To pass `STAGING_SSH_KEY` to `test-task`, the run needs `JEN_ENV_TEST_TASK`. But to *withhold* it from `deliver-task`, `deliver-task`'s run must also read `JEN_ENV_TEST_TASK` — otherwise it has no way to know the name was spoken for. So the algorithm scans `base` for every `JEN_ENV_*` key, not only its own:

1. `claimed` — the union of every name appearing in any `JEN_ENV_<STAGE>` list.
2. `mine` — the names in this stage's list, empty where it has none.
3. A key from `base` is inherited unless it is prefixed `JEN_`, or it is in `claimed` and not in `mine`.

A name claimed by two stages appears in both `mine` sets and reaches both, which falls out of set membership rather than needing a rule.

### A list holds names, and the names are trimmed

Comma-separated, whitespace around entries trimmed, empty entries dropped, so `A, B` and `A,B` are the same declaration. Names are compared case-sensitively, because POSIX environment variables are — folding case here would claim `Path` when the operator wrote `PATH`, and quietly withhold something.

### An unrecognized stage token is reported and ignored

`JEN_ENV_TEST` — the plausible typo for `JEN_ENV_TEST_TASK` — parses as a list for a stage named `TEST`, which no request ever names. Under the algorithm above its names would land in `claimed`, never in any `mine`, and be withheld from **every** stage. A variable an operator meant to narrow would instead vanish everywhere, and would do it silently.

So the token is validated against `STAGES`. An unrecognized one is reported by name, alongside the tokens that would have been valid, and its list is discarded — the names it held are inherited as though it had not been written.

*This deliberately fails open, and it is the one place in the change where that direction is arguable.* Fail-closed reasoning: the operator was trying to restrict a secret, and ignoring their typo sends it everywhere — the outcome they were preventing. Against that: it sends it exactly where it goes today, so nothing regresses and no protection is lost that was ever in force, while fail-closed manufactures a variable missing at the moment a stage reaches for it, unattended, which is the failure this whole change refuses to create. The note is what makes fail-open defensible rather than merely convenient — the operator is told, by name, that their declaration did nothing.

### Notes are a channel distinct from failures

`RunOutcome.failures` decides `ok`, and the transcript and cleanup precedents both put a non-fatal problem there and accept that it fails the run. That is right for those — a transcript the operator asked for and did not get is a broken promise — and wrong for this, which must not stop a pipeline over a misspelling.

So `RunOutcome` gains `notes: string[]`, carried into the emitted record and the readable report, and not consulted by `ok`. `childEnvironment` returns `{ env, notes }` rather than a bare env, and `#session` threads the notes to where the outcome is built.

*Alternative considered:* writing the note to stderr from inside the executor. Rejected — `jen run | recorder` is the invocation the record shape is built around, and a misconfiguration an operator needs to act on belongs in the record a recorder keeps, not only in a stream nobody may be reading.

### jen's own variables still win, and are not special-cased

The seven jen sets are assigned after the copy, so they override anything inherited and anything restricted. An operator who lists `GH_TOKEN` in a stage's declaration has written something inert, and the design does not detect or report that — the note channel exists for a declaration that silently changes behaviour, and this one changes nothing.

### The strip widens to `JEN_`, and that is exhaustive rather than heuristic

The proposal's argument, stated here as the implementation consequence: `JEN_` is a namespace jen defines, so a prefix test over it has no unnamed member to miss. This is why the same technique that would be inadequate as a general defence is sufficient as this one. Confirmed before relying on it that nothing under `.claude/skills/` or `payload/` reads `JEN_TEAM`, `JEN_PROJECT`, or `JEN_REPO`.

## Risks / Trade-offs

**A typo'd stage token leaves a secret unrestricted** → Reported by name in the run's record, with the valid tokens beside it. Accepted deliberately; see the decision above for why the alternative is worse.

**A list of one is indistinguishable from a plain value** → `JEN_ENV_TEST_TASK=STAGING_SSH_KEY` reads like it holds a key rather than a name. This surfaced in review of the proposal and is a documentation obligation: the README example shows two names, never one.

**An operator restricts a variable a stage other than the named one needed** → That stage now fails where it previously worked, and it fails when the command reaches for the variable. This is the failure mode the change otherwise refuses to create, and it is accepted here because it follows an explicit instruction the operator wrote, rather than from a list jen guessed at.

**`notes` widens the record's shape** → A consumer parsing the JSON record gains a field. Additive and optional to read, so an existing recorder is unaffected.

## Migration Plan

No migration. An operator who sets no `JEN_ENV_*` variable gets an environment identical to today's, less `JEN_TEAM`, `JEN_PROJECT`, and `JEN_REPO`, which nothing reads. Rollback is a revert; nothing persists between runs and no state is written that a later version would have to understand.

## Open Questions

- **Whether the scheduled runner's delivery task reuses `JEN_ENV_<STAGE>` or introduces its own declaration.** That task has to name variables in `registry.yaml` and resolve them into `jen.yml`, and whether the generated block sets these same variables or something narrower is its design to make. It cannot change this one: the executor reads its environment either way, and a delivery mechanism written later feeds it without altering it.
