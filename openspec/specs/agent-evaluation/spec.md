# agent-evaluation Specification

## Purpose
Measures how well jen's agents behave on a real model, as rates per task, and compares two builds or two models side by side, keeping every result in the repo.

## Requirements

### Requirement: One command runs an evaluation
`npm run eval` SHALL run an evaluation: the chosen tasks (default every task), the chosen number of runs per task and side (default 10), on the chosen model (default `JEN_LIVE_MODEL`), against the working tree or a given git ref. It SHALL read `JEN_LIVE_API_KEY`, `JEN_LIVE_MODEL` and `JEN_LIVE_BASE_URL` from the environment or a `.env` at the repo root, and SHALL exit non-zero, starting nothing, when the key or the model is missing.

#### Scenario: One task, a few runs
- **WHEN** `npm run eval -- --tasks direct --runs 2` runs with credentials set
- **THEN** it runs the `direct` task twice against the working tree and reports its rate

#### Scenario: No key
- **WHEN** it runs without `JEN_LIVE_API_KEY`
- **THEN** it exits non-zero naming the variable, and starts no runtime and builds no image

### Requirement: An evaluation never fails on agents' behavior
An evaluation SHALL report each run as passed, failed or errored, and SHALL exit zero once every run has ended, whatever the rates. It SHALL exit non-zero only when it can't carry out the evaluation, such as a build that fails or a runtime that won't start. No test that `npm test` or `npm run test:live` runs SHALL hold agents to a task.

#### Scenario: A faulty run
- **WHEN** a run's root calls `list_agents`
- **THEN** the run is reported failed with a `list_agents` fault, and the evaluation still exits zero

### Requirement: A side has images and a runtime of its own
Each side's build SHALL be built from its own source, the working tree or a checkout of the ref, into image tags unique to the evaluation, and run by a runtime under a name unique to the evaluation. An evaluation SHALL neither use nor change the tags `jen-agent`, `jen-runtime` and `jen-workspace`, nor any runtime, container, volume or network it didn't start.

#### Scenario: A comparison against main
- **WHEN** an evaluation compares the working tree with `main`
- **THEN** each side's agents run on images built from that side's source, and the user's `jen-agent` image is the same before and after

### Requirement: A build is identified by its contents
A side's build SHALL be identified by the git tree of its source: for a ref, the ref's tree; for the working tree, the tree its tracked and untracked files would make, honoring `.gitignore`. The summary SHALL record that tree, the commit it sits on, and whether the working tree differed from that commit.

#### Scenario: Uncommitted work, then committed
- **WHEN** the working tree is evaluated with uncommitted changes, and later the same contents are committed and that commit is evaluated
- **THEN** both evaluations record the same tree, the first marked dirty

### Requirement: Two sides run at the same time on the same tasks
An evaluation SHALL have one side, or two given a second ref, a second model, or both. Both sides SHALL run the same tasks and checks, taken from the working tree, and their runs SHALL be interleaved, alternating sides, so both sides' runs span the same period. No evaluation SHALL reuse a result from an earlier one.

#### Scenario: Two models on one build
- **WHEN** an evaluation runs with `--against-model` naming a second model
- **THEN** both sides run the working tree's build, one on each model, and their runs alternate

### Requirement: A run settles as the behavior check's did
A run SHALL get a root of its own, with its task's grant (`spawn` unless set), and SHALL settle after 30 seconds with no new event on any of its tree's streams. A run that doesn't settle within its task's time limit, 6 minutes unless the task sets one, SHALL fail with a `settle` fault.

#### Scenario: A run that never goes quiet
- **WHEN** a run's agents keep producing events past its task's time limit
- **THEN** the run fails with a `settle` fault

### Requirement: Runs fail as the behavior check's did
A run SHALL fail with a fault of each kind it shows: `replies`, the wrong number of owner replies; `list_agents`, any such call; `tool_error`, a refused or failed tool call other than a `read_file` of a file that doesn't exist; `repeat_message`, the same text sent twice to one receiver; `filler_reply`, a sub-agent reply of 1 to 9 characters; `model_error`, a model error event; `publish_ui`, any such call; and `check`, its task's own check.

#### Scenario: Checking before creating
- **WHEN** a root calls `read_file` on a file that doesn't exist yet, then creates it
- **THEN** the not-found error isn't a fault

#### Scenario: An edit that doesn't match
- **WHEN** the file task's root calls `edit_file` with an `old_string` the file doesn't hold
- **THEN** the run fails with a `tool_error` fault, even if a later call succeeds

#### Scenario: An unasked-for UI
- **WHEN** a root publishes a UI in a run whose task asked for none
- **THEN** the run fails with a `publish_ui` fault

### Requirement: A harness failure is an error, not a fault
A run the harness can't carry out, such as an API call to the runtime that is refused or a Docker command that fails, SHALL be reported errored with the reason. An errored run SHALL count toward neither the passes nor the runs of a rate, and the report SHALL list it.

#### Scenario: The runtime refuses a spawn
- **WHEN** the runtime answers a run's root spawn with an error
- **THEN** that run is errored with the runtime's error, and the task's rate leaves it out

### Requirement: The defined tasks
The evaluation SHALL define these tasks: one delegation, a direct answer, fan-out to three sub-agents, a task that needs a question answered first, a follow-up, a nested team, a command whose output is far over the cap, a file task, and the harder tasks `project`, `recover` and `relay`. The command, file, `project` and `recover` tasks' roots SHALL have `workspace`. Each task SHALL be identified by its name and a hash of its definition, including its check.

#### Scenario: The question is answered
- **WHEN** a run's task needs a question answered first, and the root sends its first reply
- **THEN** the evaluation sends the root "Maya and Jordan."

#### Scenario: The command task
- **WHEN** the command task's root is asked to run a given command exactly once and report one line from its output
- **THEN** the command prints a log far over the cap with that line in neither the start nor the end the result keeps, and the run fails if the reply lacks the line or the command ran more than once

#### Scenario: The file task
- **WHEN** the file task's root is asked to run a given command that writes a file of about 30 KB, change one line in its middle and nothing else, and create a second file holding given text with `$HOME`, backticks, both quotes, a trailing backslash and a line that is only `EOF`
- **THEN** the run fails unless the changed file matches the expected bytes exactly and the created file matches the given text, with or without a final newline

#### Scenario: A changed task
- **WHEN** a task's check is edited
- **THEN** the next evaluation records a different hash for that task

### Requirement: The harder tasks have deterministic checks
`project` SHALL be judged by tests the agent never sees, run against the module it wrote. `recover` SHALL be judged by the file its script writes only on success. `relay` SHALL be judged by the owner getting exactly two replies, a question and then a result holding the fact the owner gave.

#### Scenario: A relay that never asks
- **WHEN** a `relay` run's agents make up the fact rather than ask the owner
- **THEN** the run fails with a `replies` fault, since the owner got one reply

### Requirement: A prompt can be a task
An evaluation given `--prompt` SHALL run that text as a one-step task named `prompt-` and 8 hex characters of its text's hash, with the grant `--grant` names (default `spawn`). It SHALL be judged by the shared faults, except that any number of owner replies of one or more passes.

#### Scenario: A prompt with a workspace
- **WHEN** `npm run eval -- --prompt "List your workspace's files." --grant workspace` runs
- **THEN** each run's root has `workspace`, and a run with one reply and no other fault passes

### Requirement: Each run reports its metrics
Each run SHALL report its duration, from its first message to its tree's last event, its agents, its tool calls by name, and the model calls and tokens of every agent in its tree, read from the runtime's usage. A side whose runtime has no usage route SHALL report no tokens, and its runs SHALL not be errored for it.

#### Scenario: A deleted sub-agent's calls
- **WHEN** a root deletes a sub-agent before its run settles
- **THEN** the run's model calls and tokens include that sub-agent's

### Requirement: The report gives each task's rate
For each task and side, the report SHALL give passes out of runs with a 95% Wilson interval, faults by kind, errored runs, and median duration, model calls and tokens per run.

#### Scenario: One side
- **WHEN** an evaluation of one side ends with 9 of 10 `direct` runs passed
- **THEN** the report gives `direct` 9/10 with its interval, its fault kinds and its medians

### Requirement: A comparison says only what the runs support
With two sides, each task's pass rate SHALL be called better or worse only at p < 0.05 by a two-sided Fisher's exact test, and otherwise unclear, with an estimate of the runs per side that would settle an observed difference. Duration and tokens SHALL be called faster, slower, more or fewer only at p < 0.05 by a Mann–Whitney U test. The report SHALL say how many tasks chance alone would flag.

#### Scenario: Too few runs
- **WHEN** one side passes 2 of 3 runs and the other 3 of 3
- **THEN** the verdict is unclear, with an estimate of how many runs per side would settle it

#### Scenario: A clear drop
- **WHEN** one side passes 48 of 50 runs and the other 30 of 50
- **THEN** the second side is reported worse on that task

### Requirement: Every result is kept in `evals/`
Each evaluation SHALL write a folder under `evals/` named for its UTC start time and its ID, holding `summary.json`, with the command line, both sides' builds and models, each task's name and hash, the results and the verdicts, and `runs.jsonl`, with one line per run holding its outcome, faults, metrics and full transcript. Each run SHALL be appended when it ends. `evals/` SHALL not be git-ignored.

#### Scenario: An interrupted evaluation
- **WHEN** an evaluation is interrupted after some runs have ended
- **THEN** `runs.jsonl` holds those runs, and `summary.json` is written marked partial

### Requirement: The report is printed from the results
`npm run eval -- report <evaluation>` SHALL print an evaluation's report as Markdown from its `summary.json`, and an evaluation SHALL print the same report when it ends.

#### Scenario: A report for a pull request
- **WHEN** `npm run eval -- report evals/<folder>` runs
- **THEN** it prints the report as Markdown tables, and starts nothing

### Requirement: An evaluation removes everything it started
When an evaluation ends, including on an interrupt, it SHALL remove every container, volume and network its runtimes started, the runtimes themselves, its image tags, and any temporary checkout of a ref.

#### Scenario: Interrupted with Ctrl-C
- **WHEN** an evaluation gets `SIGINT` while runs are in flight
- **THEN** once it exits, no container, volume, network or image tag carrying its name or ID is left

### Requirement: Saved runs can be replayed
`docs/interactions.html` SHALL open a `runs.jsonl` the user picks, from disk, with no server, and replay any of its runs, chosen by side, task and outcome, showing a failed run's faults. `npm run eval -- record <evaluation>` SHALL write the page's committed recording with, for each task, its first passed run, or else its first failed run.

#### Scenario: A task with no passing run
- **WHEN** `record` runs on an evaluation where every `relay` run failed
- **THEN** the recording holds a failed `relay` run, and the page shows its faults
