## Context

See `proposal.md` — Why. The specs are `specs/stage-execution/spec.md` and the `task-dispatch` delta beside it; this document does not restate either.

What shapes the approach:

- **`cli/run.ts` is provably side-effect-free and must stay so.** `test/dispatch.test.ts` reads the source of `cli/run.ts`, `cli/linear.ts`, and `cli/stages.ts` and asserts none of them sends a mutation or imports `node:fs`. That guard is the reason two runners reach identical conclusions, and it must survive a change whose entire purpose is to make `jen run` act.
- **`decide()` already caps concurrency.** It returns a dispatch verdict for at most `--concurrency` candidates. Anything launching exactly the requests it emits is capped by construction.
- **The run request carries four fields** — task, skill, role, branch — and deliberately no credential and no repository. Everything else a run needs has to arrive from the environment.
- **jen has one runtime dependency** (`@fission-ai/openspec`). Nothing here should add a second.
- **`registry.yaml` records `app_id` and `installation` per role** and states that no key ever joins them on disk.

Findings established against Claude Code 2.1.220 during this design, each verified rather than read from documentation:

| | |
|---|---|
| `-p` does **not** exempt a run from workspace trust | an untrusted clone prints `Ignoring N permissions.allow entries` and runs as though the file were empty |
| `CLAUDE_CONFIG_DIR` relocates the trust store | pointing it at a directory holding a `.claude.json` with the clone's path trusted silences the warning |
| `--output-format stream-json` requires `--verbose` under `--print` | it errors out otherwise |
| `-p` with no stdin redirect waits ~3s | `Warning: no stdin data received in 3s` |
| a variadic flag before the prompt swallows it | `--allowedTools X 'prompt'` consumed the prompt as a tool name |

## Goals / Non-Goals

**Goals:**

- One module owning everything that touches the world, so the decision path's guard needs no widening.
- A run that fails *early and loudly* where it would otherwise fail late and silently — the permission case above being the one this task was opened for.
- Isolation that holds under concurrency without a lock, a pool, or a shared directory.
- Testability without spending money or reaching the network.

**Non-Goals:**

- Recording runs anywhere durable, a cost ceiling, a kill switch, a schedule, or a loop. All ENG-165's. This design produces an outcome value and hands it back.
- Retrying a failed session, or any judgment about whether a stage did its job well.
- Supporting a git host other than GitHub, or a tracker other than Linear. Both are single-implementation today and generalising before a second exists would be inventing a seam.

## Decisions

### The tick takes a launcher rather than importing one

`tick()` gains a parameter: a function from a run request to an outcome. `cli.ts` passes the real one, or omits it for `--dry-run`. `run.ts` never imports the executor.

This is dependency inversion for a specific payoff: the guard in `test/dispatch.test.ts` keeps passing *unmodified*, and it keeps meaning what it meant. The alternative — `run.ts` importing `exec.ts` directly — would force the guard to be relaxed to accommodate a transitive import that legitimately writes, and a relaxed guard is one that no longer distinguishes the case it was written to catch.

Ordering falls out of `decide()` being pure: every candidate is decided and reported first, then the dispatched ones are launched together and awaited. Nothing needs a semaphore, because the set handed to the launcher is already the capped set.

### One directory per run, holding both the clone and the config

Each run creates a temporary directory containing `repo/` and `config/`, and removes the whole thing when it ends. `repo/` is the clone; `config/` is what `CLAUDE_CONFIG_DIR` points at.

Two runs therefore share no mutable state at all — not a working copy, not a trust store, not a credential — and cleanup is one recursive delete rather than a list of things to remember. Nothing is reused between runs, which is what makes "every run is a first run" true rather than aspirational.

### Trust via `CLAUDE_CONFIG_DIR`, with the failure made loud

The run writes `config/.claude.json` containing `projects[<clone path>].hasTrustDialogAccepted: true` and sets `CLAUDE_CONFIG_DIR` to `config/`.

Alternatives considered:

- **`--settings` carrying the permission set.** Verified to clear the gate, and rejected in the proposal: it makes the project's own `.claude/settings.json` permanently inert, so a project could never grant its runs a command jen does not ship.
- **Overriding `HOME`.** Also verified, and the proposal named it. Superseded here because `HOME` is far broader than the problem: it relocates git's user config, ssh's known-hosts, npm's cache, and anything else a stage's own build touches. `CLAUDE_CONFIG_DIR` moves exactly the one store that needs moving.
- **Writing into the operator's real `~/.claude.json`.** Rejected: every clone is a new absolute path, so entries accumulate without bound in a file concurrent runs would read-modify-write against each other.

`CLAUDE_CONFIG_DIR` is not in `claude --help`, so this rests on an undocumented surface. **The mitigation is what makes the choice acceptable, and it is worth more than the choice itself:** the run scans the session's stderr for the `Ignoring N permissions.allow entries` warning and treats it as a run failure. That converts the exact failure mode this task exists to prevent — silent loss of permissions, discovered when a stage is denied its own build halfway through — into an immediate, named, first-second failure. The check is on the *symptom*, so it holds whatever the mechanism, and it will catch the undocumented variable being withdrawn just as readily as it catches a misconfigured path.

### Clone at the default branch, then place the branch locally

`git clone` then `git fetch origin <branch> && git switch <branch>`, falling back to `git switch -c <branch>` when the remote has no such branch.

`git clone --branch <branch>` cannot be used, and this is not a stylistic point: **`design-task` runs against a branch that does not exist yet.** The run request carries the tracker's *suggested* branch name, and design is the stage that first creates and pushes it. A clone that insists on the branch would fail every design dispatch — the pipeline's entry point — and fail it before the session could report anything useful.

The run places the branch and stops there. It does not create it on the remote: pushing is the stage's, and a branch pushed by the executor would be a branch with no commit explaining it.

Clones are full rather than shallow. Stages read history — the resume convention has them check commits on the branch against completion markers — and `openspec archive` and the deliver stage both operate on more than a single commit.

### Git identity is configured in the clone, per role

The run sets `user.name` and `user.email` in the clone to the role's app identity (`<app-slug>[bot]` and the corresponding `<bot-user-id>+<app-slug>[bot]@users.noreply.github.com`).

Without this, commits carry whatever identity the host machine has configured — a person's, on a local runner — and the attribution that `pipeline-identity` builds its audit story on silently stops being true. The token governs what the run may *do*; the git config governs what the history *says* it was, and they have to be set together.

**The number in that address is the bot user's id, not the app's.** This paragraph said `<app_id>` until review caught it, and the correction is worth keeping visible because the wrong one fails in the same shape the whole section is about. They are different numbers for the same app — `4588651` and `316769915` for this project's own `dev` role — and an address built from the app id is accepted by every layer that handles it while resolving to no account, so the commit renders with an unlinked name and nothing anywhere reports a problem. The slug read from `GET /app` does not carry it, so the run makes a third request, `GET /users/<slug>[bot]`, and fails rather than falling back if the host names no id.

### Installation tokens are minted per run, in-process

Per role, the environment supplies an app id, an installation id, and a private key. The run builds an RS256 JWT with `node:crypto`, exchanges it for an installation access token, and puts that token in the session's environment for `gh` and for git.

**Not in the clone's remote URL**, which is what this paragraph said until review caught it. A token spliced into the URL is an argv element of `git clone`, readable by every process on the host — the same exposure that put the `--mcp-config` payload in a file, on the same host, and argv is the worse of the two: `/proc/<pid>/cmdline` is world-readable where `/proc/<pid>/environ` is owner-only. The URL carries `x-access-token` and no credential; `GIT_ASKPASS` points at a script in the run's config directory that echoes `GH_TOKEN`, which the session already holds for `gh`. The session inherits both, so it pushes through the same clone without the token ever resting in `.git/config`.

`node:crypto` signs RS256 natively, so this adds no dependency. The alternative of shelling out to a GitHub Action that mints tokens was rejected as a layering error: it would work under one runner and not the other, and the whole point of this module is that it cannot tell which runner produced its request.

The token is minted after the decision and discarded with the run, satisfying `pipeline-identity`'s requirement that a role's token be short-lived and per-run. Only the role named in the request is minted — a run never holds two.

Environment shape, one set per role, with `<ROLE>` in `DESIGN`, `DEV`, `DELIVER`:

```
JEN_REPO                          owner/name
JEN_GH_APP_ID_<ROLE>
JEN_GH_INSTALLATION_<ROLE>
JEN_GH_PRIVATE_KEY_<ROLE>
LINEAR_API_KEY                    the tracker agent, shared by all roles
ANTHROPIC_API_KEY                 model access
```

Whether these came from a workflow's secrets or from a local shell is the runner's business, exactly as the tick's team and project are. A missing one refuses the run *before* the session starts, naming which — the same shape as the tick's refusals, and for the same reason.

### The invocation

```
claude -p '/<skill> <TASK>'
  --permission-mode dontAsk
  --output-format stream-json --verbose
  --mcp-config <tracker server, token from the environment>
  < /dev/null
```

Run in `repo/`, non-bare, with `CLAUDE_CONFIG_DIR` and the role's credentials in the child's environment.

- **Non-bare.** `--bare` skips discovery of skills, MCP servers, auto memory, and `CLAUDE.md` — which is the entirety of what jen installs into a project. The clone is a complete installation, so letting discovery find it is both simpler and more faithful than enumerating it by flag.
- **`stream-json` rather than `json`,** and therefore `--verbose`, which it requires. Plain `json` returns only the final result, and the MCP verification the spec requires lives in the `system/init` event's `mcp_server_errors`. Needing the init event is what forces the format.
- **`< /dev/null`.** Without it the process waits ~3 seconds for stdin that will never arrive — per run, on every run.
- **The prompt names the skill and the task**, positionally last, since a variadic flag placed before it will consume it.

### The outcome is a verdict on three signals

The run keeps the `system/init` event, the final `result` event, and stderr, and reports failure if any of the three says so: `mcp_server_errors` non-empty, `is_error` true, a non-zero exit, or the permission warning on stderr.

The task description said an in-run failure prints as the result rather than raising the exit code. Verified, an authentication failure raised **both** — exit 1 and `is_error: true`. So neither signal is reliably the whole story, and reading only one is right by accident. Treating any of them as sufficient for failure costs nothing: they agree on success, and a disagreement is a failure either way.

`total_cost_usd` and the session id come off the result event and go into the outcome for ENG-165 to record.

### `jen run` fails when the executor failed, not when a stage parked a task

A stage that moves a task to `Pending` has *succeeded* — that is one of the two ways every session is supposed to end. The command exits non-zero only when a session could not be run or did not complete: a missing credential, a clone that failed, a session reporting `is_error`, a lost tracker connection.

The distinction matters because ENG-165 will surface this as a job status. A runner that goes red every time a stage correctly asks for a human trains its operator to ignore it, which is worse than not reporting at all.

### Testing without spending money or reaching the network

The launcher is injected, so `tick`'s tests never execute anything. The executor's own tests inject the spawn call and point it at a stub script that emits canned `stream-json` events — including a `system/init` carrying `mcp_server_errors`, and a stderr line carrying the permission warning, so both failure detections are covered by a test rather than by having been thought about.

Token minting is tested against its own inputs: the JWT is verifiable with the public half of a throwaway key generated in the test, and the exchange goes through an injected transport, in the idiom `linear.ts` already uses.

What no unit test can cover is whether a real session honours the trust entry. That is ENG-167's, and the stderr check is what makes its absence survivable in the meantime.

## Risks / Trade-offs

- **`CLAUDE_CONFIG_DIR` is undocumented and could change** → the stderr check fails the run loudly and immediately if it ever stops working, and overriding `HOME` is a verified fallback needing a one-line change.
- **The permission warning's wording could change**, defeating the stderr check → it is a second line of defence, not the mechanism; and ENG-167 exercises a real dispatched run end to end, which is what would catch it.
- **A full clone is slow on a large repository** → accepted rather than solved. Shallow clones break history reads that the resume convention and the deliver stage both depend on, and a wrong answer arrived at quickly is not the trade this pipeline wants.
- **Nine role-scoped environment variables is a lot of surface** → they are named consistently and validated before any session starts, so a misconfiguration is a refusal that names the variable rather than a session that dies confusingly.
- **`jen run` now blocks for as long as its sessions take** → intended, and required for a runner not to orphan them; but it means a tick's duration is now a stage's duration, which ENG-165 has to account for when choosing an interval.
- **A killed run leaves the task needing a human** → accepted, and specified. It is what makes a deterministically failing stage fail once instead of every tick.

## Migration Plan

Nothing consumes `jen run`'s output yet, so there is no consumer to migrate. The one behavioural break is that `jen run` acts by default where it previously printed and exited; `--dry-run` is the old behaviour and the README and usage text point at it.

Rollback is `--dry-run`: an operator who wants the pipeline to stop acting without redeploying anything has a flag that reduces it to what shipped in ENG-163.

## Open Questions

- **The exact `--mcp-config` payload for the tracker under an agent credential.** The shape is fixed by the spec — it authenticates as the project's tracker agent, takes its token from the environment, and the run verifies it connected — and the verification path is what makes getting it wrong loud rather than silent. Settling the literal JSON needs a live run, which is a task rather than a design decision, and no spec, approach, or task boundary moves depending on how it lands.
- **Whether the prompt reads `/design-task ENG-164` or names the task in a following sentence.** Nothing depends on argument substitution — no stage skill declares an `argument-hint` or templates `$ARGUMENTS` — and both forms put the identifier in the session's context. Worth settling against a real session, given this change has already found one place where `-p`'s documented and actual behaviour differ.
