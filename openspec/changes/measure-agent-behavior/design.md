# Design

## Context

See proposal.md for why. What exists today:

- `src/runtime/behavior.live.test.ts` is a Vitest test. It builds the three images into the shared tags `jen-agent`, `jen-runtime` and `jen-workspace`, starts one runtime, and runs eight tasks three times each, 24 roots at once. A run settles after 30 seconds with no new event on any of its tree's streams, or fails after 6 minutes. Its faults are the shared rules (reply count, `list_agents`, failed tool calls, repeated messages, filler replies, model errors, `publish_ui`) plus each task's own `check`. It prints each failing run's transcript and, with `JEN_LIVE_RECORD`, writes one passing run of each task to `docs/interactions.data.js`.
- The runtime proxies every model call (`modelCall` in `src/runtime/server.ts`). The adapter calls the Responses API without streaming, so each answer is one JSON body, whose `usage` holds the call's tokens. The runtime pipes the body through and reads none of it.
- `GET /agents` answers what an agent's `list_agents` tool shows its model, so anything added there reaches models.
- `src/` holds one directory per image plus `src/cli/`, and nothing else. `scripts/` holds the build and release tooling, whose tests `vitest.config.ts` already runs.

## Goals / Non-Goals

**Goals:**

- A difference the comparison reports comes from the builds or the models, not from the harness, the time of day or the tasks.
- Every measurement an evaluation makes is kept in the repo, and can be read, replayed and quoted without rerunning anything.
- Everything an evaluation starts is removed, including when it's interrupted, and nothing of the user's jen is touched.

**Non-Goals:**

- Judging open-ended quality, such as how good a haiku or a UI is. Every check stays deterministic.
- Evaluating generated UI, scheduled runs, and a view of results over time. These are follow-ups the layout leaves room for.
- Comparing builds whose owner APIs differ. The harness speaks this change's API, and a ref without it fails with harness errors rather than wrong rates.

## Decisions

### The evaluation is a script under `scripts/eval/`, run by `npm run eval`

`scripts/eval/main.ts` parses the arguments and dispatches. `tasks.ts` holds the tasks and their checks, `run.ts` runs one task against a runtime and finds its faults and metrics, `build.ts` builds a side's images, `side.ts` starts and removes a side's runtime, `stats.ts` holds the statistics, and `results.ts` writes and reads `evals/`. Pure parts (faults, statistics, results, argument parsing) get unit tests that `npm test` runs. It reads `JEN_LIVE_API_KEY`, `JEN_LIVE_BASE_URL` and `JEN_LIVE_MODEL` from the environment or `.env`, as the live checks do.

- `npm run eval -- [options]` runs an evaluation: `--tasks <a,b>` (default: every task), `--runs <n>` (default 10, per task and side), `--model <id>` (default `JEN_LIVE_MODEL`), `--build <ref>` (default: the working tree), `--against <ref>` and `--against-model <id>` (either or both make a second side), `--prompt <text>` with `--grant <spawn,workspace>` (default `spawn`), and `--parallel <n>` (default 24 runs in flight across both sides).
- `npm run eval -- report <evaluation>` prints the evaluation's summary as Markdown, ready to paste into a pull request. An evaluation prints it when it ends, too.
- `npm run eval -- record <evaluation>` writes `docs/interactions.data.js` from it.

*Rejected: keeping it a Vitest test with options in environment variables.* It is no longer pass or fail, and a test runner's output, timeouts and filtering fight a long run that reports a table. *Rejected: under `src/`*, which holds only what runs in an image or on the user's machine.

### A side is a build and a model, with images and a runtime of its own

An evaluation has one side, or two to compare. A side's build is the working tree or a git ref.

- **Identity is the git tree.** A ref's build is `git rev-parse <ref>^{tree}`. The working tree's is the tree `git add -A` would write, computed with a temporary index, so uncommitted and untracked files count and `.gitignore` holds. The same contents get the same identity whatever commit they sit on, so a working-tree build that's later committed matches its commit. The summary also records the commit and whether the tree was dirty.
- **A ref builds from its own checkout.** `git worktree add --detach` puts it in a temporary folder, the three targets build from that folder's `Dockerfile`, and the worktree is removed. The working tree builds from the checkout itself.
- **Tags belong to the evaluation:** `jen-agent:eval-<id>-a`, and so on, where `<id>` is the evaluation's. Two evaluations at once never share a tag, so one's cleanup can't pull an image from under the other. Docker's layer cache makes a rebuild of the same tree cheap. The tags are removed at the end.
- **Each side has its own runtime**, named `jen-eval-<id>-a` or `-b`, started as the behavior check starts one today, with `JEN_MAX_AGENTS` raised to fit `--parallel`. Both sides use the same key and base URL; only the model may differ.

### Both sides run at once, interleaved, on the same tasks

The harness, the tasks and their checks come from the working tree for both sides, so a comparison measures builds, never two versions of a task. The runs form one queue that alternates sides and cycles through tasks: a1, b1, a2, b2, and so on. `--parallel` runs are in flight at a time, so both sides' runs spread over the same minutes. Results are never reused from an earlier evaluation (see proposal.md).

### A run ends as passed, failed or errored

A run's root, settling and fault rules are the behavior check's, unchanged, except that a task may set its own time limit, since harder tasks run longer. Each fault gets a kind (`settle`, `replies`, `list_agents`, `tool_error`, `repeat_message`, `filler_reply`, `model_error`, `publish_ui`, `check`) so faults count by kind. A run with no faults passed, and one with faults failed. A run the harness couldn't carry out, such as a refused API call or a Docker command that failed, errored: it counts toward neither rate, and the report lists it, so an infrastructure fault never reads as an agent's.

A prompt from `--prompt` is a task named `prompt-<8 hex of its text>`, with the given grant, one step, and no check of its own. It expects at least one reply rather than an exact number.

A task's identity is its name and a hash of its definition: its fields and its `check`'s source. The summary records both, so history shows when a task changed.

### Each run's metrics: time, model calls and tokens, counted by the runtime

A run records its duration, from its first message to its last event, not counting the quiet period that settles it; its agents; its tool calls by name; and its model calls and tokens.

The runtime counts usage as it proxies. `modelCall` keeps a copy of the answer's body as it pipes it. When the body ends, it parses the body's `usage` and adds the call to the caller's count: calls, input, cached input, output and reasoning tokens, and `cost` when the provider reports one. A body that doesn't parse, or has no `usage`, still counts as a call. The counts are kept in memory for every agent since the runtime started, deleted agents included, each with the root it belongs to. A parent may delete a sub-agent before its run ends, and its calls still count. The owner reads them at `GET /usage`, as `{"agents": [{"id", "root", "calls", "inputTokens", "cachedTokens", "outputTokens", "reasoningTokens", "cost"?}]}`. An agent calling it gets `403`.

A run sums the entries for its root once it settles. Against a build without `/usage`, such as `main` before this change merges, the route answers `404`, and that side's runs have no tokens. The report shows tokens only where both sides have them.

*Rejected: adding usage to `GET /agents`.* That's what `list_agents` shows models, so it would change what agents see, and a measurement must not change what it measures. *Rejected: having the agent record usage from its adapter.* An agent's own account is the wrong source once spend is a bound the runtime enforces, which is where this count leads (see plan.md's open questions).

### Rates and comparisons say only what the runs can support

For each task and side, the report gives passes out of runs with a 95% Wilson interval, faults by kind, and the median duration, model calls and tokens per run.

With two sides, each task gets a verdict on its pass rate from a two-sided Fisher's exact test: better or worse at p < 0.05, otherwise unclear. An unclear verdict with a difference observed says roughly how many runs per side would settle it, from the two-proportion sample-size formula at 80% power with the observed rates. Duration and tokens are compared with a Mann–Whitney U test at p < 0.05, giving faster or slower and more or fewer tokens, with the ratio of medians. The report also says how many tasks chance alone would flag at that level, so one flag among eleven tasks reads as what it is. Rerunning that task alone, with more runs, confirms it.

*Rejected: correcting for many comparisons, such as Holm's.* At this many runs, it would hide the drops this exists to catch. A false flag costs one more evaluation of one task.

### Results live in `evals/`, committed, one folder per evaluation

`evals/<UTC start, YYYY-MM-DDTHHMM>-<id>/` holds two files:

- `summary.json`: the command line, start and end, each side's build (tree, commit, dirty, ref) and model, each task's name and hash, the per-side results and the comparison's verdicts, as the report prints them.
- `runs.jsonl`: one line per run, appended as each run ends, with its side, task, outcome, faults, metrics and full transcript, with agent IDs replaced by the short names the transcript uses.

The summary is written at the end, and also on an interrupt, marked partial. Every evaluation on a branch is committed with the change, kept or not: a discarded attempt is evidence too, and choosing which to keep would bias the record.

Transcripts are stored as plain compact JSON. Git compresses every object it stores, and the current recording, 36 KB for eight runs, compresses to under 5 KB, so a comparison of a few hundred runs costs the repo's history a few hundred KB. *Rejected: committing gzip files*, which git can't compress further and nobody can read in a diff or on GitHub. *Rejected: committing only failed runs*, since a passing run is what a failing one is compared with.

### `docs/interactions.html` replays any saved run

The page keeps its committed recording, now written by `npm run eval -- record`. That takes, for each task, its first passing run, and otherwise its first failing run, so a task agents don't yet pass still appears. The page shows a failing run's faults. It also gets a control to open any evaluation's `runs.jsonl` from disk, then choose a run by side, task and outcome. A file the user picks works on `file://` in any browser with no server, which the current data file doesn't in the app's browser pane.

### The harder tasks are measured before they're kept

Three candidates join the eight, each with a deterministic check:

- `project`: in a workspace, write a small Python module and its tests from a short spec, run the tests until they pass, and reply. The check runs the harness's own hidden tests against the module.
- `recover`: run a given script that fails, saying a config file is missing and what it needs. The agent must create the file and run the script again. The check reads the output file the script writes only once it succeeds, and the workspace's count of runs.
- `relay`: a lead sub-agent has a sub-agent of its own, which needs a fact only the owner has. The question has to reach the owner, and the answer has to come back down. The check expects two owner replies, the question and a result holding the fact.

The implementation measures each on `openai/gpt-6-luna`. A task that passes 20 of 20 gets harder or is replaced, and one that never passes is checked for a fault in the task before it's kept. Each must show something agents don't yet do every time.

### The convention, the handoff and the hand-check recipe

`conventions.md` gets the rule for when a change is evaluated, as the proposal states it. `deliver-change` gets one line: quote the comparison's report from `evals/`, or the reason there is none. `environment.md` gets the hand-check recipe: build the three images under tags of their own, run the checkout's `jen` with `JEN_RUNTIME_NAME` and the three image variables set to them, and remove what it made with the record's cleanup commands.

## Risks / Trade-offs

- **Spend.** A default comparison of eleven tasks is 220 runs, about nine of today's passes. → `--tasks` and `--runs` narrow it, and the report says when more runs would settle a verdict, so a change can start small and add runs where it matters.
- **The provider's rate limits** turn into model errors, which count as faults on whichever side hit them. → Interleaving spreads them over both sides, and the faults by kind show them. `--parallel` lowers the load.
- **The repo grows** by a few hundred KB of history per comparison, and the checkout by about 1 MB. → If it starts to matter, old evaluations can move out in a later change. Nothing reads them but people and the replay page.
- **A harder task can be wrong rather than hard.** → Each is measured before it's kept, and a run's transcript shows whether a failure is the agent's.
- **Comparing across an API change fails.** → The run errors and the report lists it. It can't produce a wrong rate.
- **Usage is lost if the runtime restarts.** → An evaluation's runtime lives exactly as long as the evaluation. Spend as a bound would need counts that persist, which that change designs.

## Migration Plan

1. The runtime counts usage and serves `GET /usage`.
2. `scripts/eval/` takes over the behavior check's tasks, settling and faults, and `src/runtime/behavior.live.test.ts` is deleted, along with `JEN_LIVE_RECORD`.
3. The interactions page opens saved runs, and `record` rewrites its data file.
4. The harder tasks are measured and settled.
5. This change follows its own convention: it changes `src/runtime/`, so an evaluation of the working tree against `main` on the eight tasks goes into `evals/` and its report into the handoff, with tokens on this side only. It's also the tool's live check.
6. The record is updated: the convention, the recipe and the evaluation in `environment.md`, the behavior check's flake list removed, and the superseded decisions marked, namely 2026-11-11's tolerated delegation failures and 2026-11-18's accepted Luna flake. A view of results over time goes to `ideas.md`.
