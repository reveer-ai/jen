## Why

Every stage of the pipeline runs today because a human moved a status and invoked a skill. Nothing decides what should run. The six stages are re-enterable, they authenticate as their own roles, and they hand off to each other correctly — and then they sit there, because the thing that notices a task is sitting in `In Progress` and starts implementation against it does not exist.

`jen run` is that thing, and it is deliberately the dumb half: it decides *what* should run and nothing about *how* it runs. One tick — poll, map, gate, emit, exit. The loop belongs to whichever runner is driving (ENG-165), and both shipped runners drive this same entry point, which is what keeps a scheduled Actions job and a long-running local process one code path instead of two that drift.

## What Changes

- **`jen run`, a single poll-map-gate-dispatch pass.** It polls the tracker for issues whose status maps to a stage, maps status to skill and to role from a fixed compiled table, gates each candidate, emits a run request per dispatch, and exits. No scheduling, no loop, no model call anywhere in this path.

- **A new `Pending` status, and the pipeline is now two moves.** A stage either hands the task to the next stage, or moves it to `Pending` and says why. `Pending` is a human's turn and no stage dispatches from it. **This corrects the epic and ENG-166**, both of which had `design-task` finish by leaving the task at `In Design` for the user to promote — the one case where a task legitimately rests inside a stage status, and the reason ENG-166 required the trigger to be the *transition into* a status rather than residence in it. Design now ends at `Pending` instead. Every stage status then means "a run is on this", with no exceptions, and the tick goes back to being a plain status poll.

- **Everything that machinery was holding up goes with it. BREAKING** for the pipeline's semantics, though nothing shipped consumes them yet:
  - **No transition-edge detection.** Nothing parks in a stage status, so residence is a sound trigger again.
  - **No lease with a TTL.** In-flight is a pickup comment the dispatcher writes before it dispatches. It does not expire, because nothing retries.
  - **No retry, and so no repeat-failure budget.** A run succeeds and advances, or says what is wrong and moves to `Pending`. A session killed hard leaves a pickup comment and no outcome, and the task sits in its stage status until a human moves it. That is legible from the outside and it is the reason a broken stage can never loop or bill — it fails once and stops.
  - **No churn budget in the dispatcher.** Recognising that a task is going back and forth *for the same reason* is a judgment, and the dispatch path takes no judgment. It belongs to the stage that is about to route the task backward for the second time, and that stage moves it to `Pending` instead.

- **The Linear API client and credential resolution land in the CLI.** ENG-160 keeps the CLI free of an API client, a stored token, and a prompt loop; that still holds for `init` and `update`, which stay filesystem-only. `jen run` is a different command with a different job.

- **A resolver, never a store.** Credentials come from the environment at the point of use — `LINEAR_API_KEY` and the git-host application keys of ENG-141. jen writes no credential to disk, and a missing one refuses the tick by name rather than failing partway through it.

- **The tick receives its context and discovers nothing.** The Linear team and project arrive as flags or environment. `jen run` never reads `registry.yaml` and never calls an API to find them. Resolution is the runner's (ENG-165): `jen watch` runs inside a checkout and reads the registry; the scheduled workflow carries the values as env generated from that same file. The filesystem read lives in the wrapper, where a difference between runners is harmless, rather than in the tick, where it is the divergence the shared-tick rule exists to prevent — and it is what keeps a third runner a wrapper rather than a port.

- **`Todo` is never a candidate**, and neither is `Pending`. Both transitions out of them are the user's.

## Capabilities

### New Capabilities

- `task-dispatch`: `jen run` as one tick; which statuses are candidates and which are never; the status→skill and status→role mapping; the pickup comment that marks a task as taken and the concurrency cap; the run request emitted for the executor; credentials resolved from the environment; and the rule that the tick receives its project identity rather than discovering it.

### Modified Capabilities

- `task-pipeline`: gains `Pending` and the two-move rule — a stage hands off or it moves the task to `Pending`. `design-task` ends at `Pending` rather than at `In Design`, which removes the only case of a task resting in a stage status and therefore reverts the trigger from the transition into a status to the task's presence in one with no run yet taken against it.
- `stage-conventions`: a stage that needs a human moves the task to `Pending` and comments, rather than stopping and leaving the status where it found it. And a stage about to route a task backward for the same reason it already routed it back moves it to `Pending` instead — the circling judgment, which the record requirement today lets a stage merely note.
- `project-binding`: `Pending` joins the statuses `setup-jen` verifies, and the registry gains nothing — the dispatcher reads no file.

Deliberately unmodified: `agent-instructions`. `AGENTS.md` changes substantially — a new status in the stage table, the two-move rule, the `Pending` convention — but its requirement is that the document *state* the stages and the shared conventions, which an amended table and one more convention satisfy rather than amend. `pipeline-identity` likewise: it already says a run holds its stage's identity and never selects one, and names the dispatcher as what selects it. This change is that dispatcher doing so; the requirement is unchanged.

## Impact

**Changed here**

- `cli/` — the `run` command, the tracker client, the status→skill→role table, the gate, and the run request. First code in the CLI that talks to a network.
- `AGENTS.md` — the stage table gains `Pending`; the handoff column for `design-task` changes; the two-move rule and the circling rule join the conventions. `jen update` replaces this file wholesale, so it reaches every adopting project on the next update.
- All six stage skills — each moves the task to `Pending` where it previously stopped and left the status alone.
- `.claude/skills/setup-jen/SKILL.md` and `scaffold/registry.yaml` — the verified status set.

**Not changed here**

- Anything about *how* a stage session runs: the clone, the `claude -p` invocation, the permission mode, the outcome capture, and the credential injection are ENG-164's. This change fixes the run request it consumes.
- Any loop, schedule, workflow file, run record, cost ceiling, or kill switch — all ENG-165's. Stated explicitly because "poll" reads like it implies a poller, and it does not.

**Depends on**

- ENG-141 for the roles the run request names. Registered and correct.
- `Pending` existing on the tracker. `setup-jen` verifies statuses and does not create them, so this is an operator action on every project including jen's own, and a tick against a project without it has no place to put a blocked task.

**Depended on by**

- ENG-164, which consumes the run request; ENG-165, which drives the tick; ENG-167, which proves the whole thing unattended; ENG-173, which raises the merge gate once a verdict can count.
