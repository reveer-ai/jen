## Why

ENG-163 built the half of the dispatcher that decides. It polls, maps a status to a skill and a role, gates each candidate, prints a run request, and exits — and then nothing happens, because no code anywhere turns one of those lines into a session. The pipeline can say what it would do and cannot do it.

This change is the other half: a run request in, a completed stage session out. It is the mechanical half by construction — it exercises no judgment about *what* to run, because that judgment already happened and arrived as its input.

## What Changes

- **`jen run` executes.** The tick polls, maps, and gates exactly as it does today, and then clones, launches, and sees each dispatched session through before exiting. Running the pipeline is the ordinary invocation; inspecting it is the flagged one.

- **`--dry-run` restores the current behaviour. BREAKING** for `jen run`'s contract, though nothing consumes it yet: the command that today prints and exits now does the work by default. `--dry-run` polls, decides, reports, and launches nothing, which is what keeps "what would the pipeline do right now" answerable without doing it. The name is `--dry-run` rather than `--no-exec` because the flag's promise is about consequences rather than about which code path is skipped.

- **The tick still writes nothing, and that is now a claim about the decision rather than about the command.** `run.ts` remains free of tracker mutations and of the filesystem; everything that touches the world lands in a new module beside it. The distinction is worth preserving structurally rather than by intention: `test/dispatch.test.ts` asserts by reading source that no mutation and no file write is reachable from `cli/run.ts`, `cli/linear.ts`, or `cli/stages.ts`, and that guard survives this change untouched. A decision that cannot write is what lets two runners reach identical conclusions from identical state, and folding execution into the same module would trade that for nothing.

- **`jen run` sees its sessions through. BREAKING** for `task-dispatch`, which today states that a tick does not wait for the runs it emits and carries a scenario asserting it. A command that launches sessions and exits immediately orphans them: a scheduled Actions job would end, and the runner would take down the very sessions it started. So one tick now means one poll, launch what passes the gate, see them through, exit — still no loop, no sleep, and no schedule, which is what that requirement existed to forbid. It is also what leaves a process alive to receive a SIGTERM, without which the kill behaviour below has nothing to happen to.

- **A fresh clone per run**, at the task's branch, discarded when the run ends. Concurrent runs share no working copy, and no state survives a run except what it pushed and what it wrote to the tracker.

- **The stage and the task are both named in the prompt, and neither is inferred.** The session is launched as `claude -p` with the skill named explicitly — `/design-task ENG-164` — which Claude Code expands as a by-name invocation rather than matching a description. Auto-triggering a skill from its description is a judgment, and judgment in the trigger is the thing this whole layer is arranged to avoid.

  Naming the task is not decoration, and it is the half that interacts with `dontAsk`. `stage-conventions` has a stage take its task "given directly or inferred from context", ask when that is unclear, and stop when it cannot identify one and cannot ask. A dispatched run has no asking branch, so a session launched with a bare skill name would correctly refuse to act — spending a dispatch and looking, from outside, exactly like a stage failure. The run request already carries the task for this reason; the executor's job is to put it where the session will read it.

  **The exact form is left to `design` and owes a real run.** None of the stage skills declare an `argument-hint` or template `$ARGUMENTS`, so nothing here depends on argument substitution: the prompt is free text and can equally carry `/design-task ENG-164` or `/design-task` followed by a sentence naming the task. Which one to standardise on is worth settling against an actual session rather than from the documented behaviour — this change has already found one place where `-p`'s documented behaviour and its real behaviour differ.

- **`--permission-mode dontAsk`,** which denies `AskUserQuestion` outright even where an allow rule would match it. The stage skills already say they never block on a human; this is the harness enforcing that rather than the prose being trusted for it.

- **Workspace trust is established per run, in a config store the run throws away.** This is the finding the task was opened with and it needed verifying rather than assuming, because getting it wrong fails deep into a run instead of at startup. `-p`'s own help says the trust dialog is skipped in non-interactive mode, which reads like a dispatched run is exempt. It is not: a fresh clone under `-p --permission-mode dontAsk` still reports `Ignoring N permissions.allow entries from .claude/settings.json: this workspace has not been trusted`, and runs as though the file were empty. Since every run clones to a path nothing has ever trusted, this would land on every run rather than on a first one — and under `dontAsk` the consequence is precisely the failure the seeded allow list exists to prevent, arrived at with nobody present to grant anything.

  Trust is keyed by absolute path in a per-machine store, so the run points the harness at a store of its own and writes the entry for its clone there. Which knob relocates that store is settled in `design.md`, together with the check that makes a failure of it loud. The alternative of passing permissions as `--settings` on the command line is also proof against the gate and is rejected for what it costs: the project's own `.claude/settings.json` would stay inert in every dispatched run, so a project could never grant its runs a command jen does not already know about — and jen cannot know a project's typecheck, build, or test commands, which `stage-conventions` requires be granted where that difference *is* known. Writing the entry into the operator's own `~/.claude.json` is rejected for a different reason: each clone is a new absolute path, so entries would accumulate without bound in a per-machine file that concurrent runs would read-modify-write against each other.

  A run-scoped store settles all of it at once — the project's file is honoured, nothing accumulates, concurrent runs cannot race, and the trust state is discarded with the run that needed it.

- **Context is loaded rather than assumed.** `--bare` is the documented mode for scripted calls and it skips discovery of skills, MCP servers, auto memory, and `CLAUDE.md` — which is the entirety of what jen installs. Sessions therefore run non-bare, or pass every piece explicitly. Whichever holds, the run **verifies the tracker MCP actually connected** rather than assuming it: a `--mcp-config` entry that fails validation is skipped and the session continues cleanly, reporting it only in the `system/init` event's `mcp_server_errors`. A stage that cannot reach the tracker cannot announce itself, and a session that cannot announce itself is one the next tick dispatches again.

- **The run holds its role's credentials and never selects them.** The role arrives in the run request, already decided by the tick, and the run resolves that role's credentials from its environment at the point of use. Nothing is written to a tracked file, and the run's directory is removed when it ends, so nothing survives it.

- **The outcome is captured** — exit status, the `is_error` flag and `result` text from `--output-format json`, `total_cost_usd`, and the transcript — and handed to whatever records it. Both signals are captured rather than the exit status alone, and this is a **correction to the task's own description**, which says a failure inside the run is printed as the result rather than raising the exit code. Verified against 2.1.220, an authentication failure raised *both*: exit 1 and `is_error: true`. Treating exit status as sufficient would therefore be right by accident today and wrong the first time a failure reports only one of them, so the outcome is read from the JSON and the exit status is corroboration.

- **A killed session leaves the task where it is.** SIGTERM arrives from a cancelled Actions job and a stopping `jen watch` alike, so this is routine operation rather than a crash path. Claude Code aborts the turn, kills the Bash process tree, runs `SessionEnd` hooks, and exits 143; the executor waits for that, removes the run's directory, and writes nothing to the tracker. The task is left carrying an announcement with no closing outcome, which every later tick reads as in flight until a human moves it. **This supersedes the task description's requirement that a killed run "release its lease rather than leaving the task idle until the TTL expires"** — ENG-163 removed leases and TTLs outright, and made a non-expiring announcement the mechanism precisely so that a stage failing deterministically fails once instead of every tick forever. Having the executor close the marker on a dead session's behalf would restore the loop that decision removed, and would put a tracker write outside a stage session, which `task-dispatch` states categorically.

## Capabilities

### New Capabilities

- `stage-execution`: what turns a run request into a finished stage session — the fresh clone at the task's branch and its disposal; the explicit by-name skill invocation; the permission mode that denies blocking; establishing workspace trust so the granted permissions are actually in force; loading the assistant context rather than assuming it, and verifying the tracker connection rather than trusting it; holding exactly one role's credentials, from the environment, leaving none behind; capturing the outcome; and what a killed session leaves behind.

### Modified Capabilities

- `task-dispatch`: `jen run` executes what it dispatches rather than only emitting it, and `--dry-run` is what asks the question without answering it in actions. The writes-nothing requirement narrows from the command to the decision, which is where it was load-bearing and where it remains structurally enforced. The requirement that a tick not wait for the runs it emits inverts: it sees them through, because a runner that exits takes its own sessions with it.

Deliberately unmodified: `pipeline-identity` — it already requires that a run begin with exactly one role's credentials in place, resolved from the environment, never written to disk, and never selected by the stage itself. This change is the code that satisfies that requirement rather than a change to it, which is the same reading ENG-163 applied when it named the dispatcher as what selects the role. `stage-conventions` likewise: its permission requirement is about what a stage is granted, and establishing trust so a grant takes effect is the executor's work rather than the stage's, so it belongs to the new capability instead.

## Impact

**Changed here**

- `cli/` — a new module holding the clone, the invocation, the trust establishment, the credential injection, the outcome capture, and the signal handling. It is the first code in the CLI that spawns a process, and the first outside `init`/`update` that touches the filesystem.
- `cli/cli.ts` — `jen run` gains `--dry-run`, and the usage text stops describing the command as one that writes nothing anywhere.
- `cli/AGENTS.md` — the trust finding and its verification, since the symptom of getting it wrong is a denial deep into a run rather than an error at startup; the two-signal outcome read; and why execution lives beside the tick rather than inside it.
- `test/` — the existing source-level guard over the decision path is kept as-is and relied upon, rather than widened to accommodate a module that now legitimately writes.

**Not changed here**

- Any loop, schedule, workflow file, run record, cost ceiling, or kill switch. All ENG-165's. This change hands an outcome to a recorder that does not exist yet, in the same way ENG-163 emitted a run request before a consumer existed.
- What any stage session actually does once it is running. This change starts one correctly and gets out of the way.

**Depends on**

- ENG-163 for the run request and the role it names. Landed.
- ENG-141 for the three registered identities whose credentials a run injects. Landed.

**Depended on by**

- ENG-165, which drives this on a schedule and records what it did; ENG-167, which proves the whole pipeline unattended and is the first thing to exercise this against a real task.
