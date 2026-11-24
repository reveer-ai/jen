# Proposal

[JEN-24](https://linear.app/reveer/issue/JEN-24)

## Why

How well jen's agents behave on a real model is measured only by the behavior live check. It runs all eight tasks three times on whatever `jen-*` images it just built over, and it fails on any faulty run. On `openai/gpt-6-luna` a pass fails without any change: on `main`, delegation failed 0, 2 and 1 of 18 runs across three passes. So `environment.md` keeps a list of known flakes, decisions accept failed passes one by one, and the bar for a change is "no worse than `main`", which only a hand-built comparison can show. [reveer-ai/jen#14](https://github.com/reveer-ai/jen/pull/14) copied the test file to run one task, and its baseline on `main` overwrote the branch's images. [reveer-ai/jen#16](https://github.com/reveer-ai/jen/pull/16) tallied about 70 runs across two builds by hand. Three runs can't tell a fault rate of 1 in 3 from 0 in 3 anyway.

[JEN-32](https://linear.app/reveer/issue/JEN-32) and [JEN-34](https://linear.app/reveer/issue/JEN-34) change how agents behave, and each of their iterations needs a comparison against `main`. That's why this lands first.

## What Changes

- **Agents' behavior is measured by an evaluation, not a test.** Tests say whether jen works and always pass, so a failure is a bug. An evaluation says how well agents do, as a rate per task, and never fails. The behavior check leaves `npm run test:live`, and the known-flake list and the decisions accepting failed passes are retired. Where agents aren't perfect shows as a rate below 100%, not as a red test.
- **One command runs an evaluation:** `npm run eval`. It runs the tasks you choose, as many times as you choose, on the model you choose, against a build: the working tree, uncommitted changes included, or any git ref. Each build gets image tags of its own, and each evaluation a runtime of its own, so nothing touches the user's jen or another build's images. It removes everything it started.
- **It compares two builds, or two models on one build, measured side by side.** Both sides run fresh in the same evaluation, their runs interleaved, so they meet the model at the same time: a model name can be moved to a new snapshot, the provider's serving can change, and timing always varies with load. For each task it reports both rates, and says a build is better or worse only when the difference is larger than chance would explain. Otherwise it says the difference isn't clear, and how many more runs would settle it.
- **Each run reports more than pass or fail:** its faults, grouped by kind, how long it took, its model calls and the tokens they used. A change that makes agents slower or more expensive shows up even when nothing fails. Tokens come from the runtime, which counts each agent's usage from the model calls it already proxies.
- **Results are kept in the project.** Each evaluation's summary, with its builds, model, tasks, rates, faults by kind, timing and tokens, is committed under `evals/` with the change it measured, so a change's evidence is in its pull request and the summaries add up to a history of how agents do across jen's versions. A run's full transcript is kept for replay in `docs/interactions.html`, which is how the page gets its recording from now on. The handoff quotes the comparison in the pull request. Saved runs are a record, never a cache: a comparison never reuses an earlier measurement.
- **A task can be a prompt.** Besides the defined tasks, an evaluation can run a prompt given on the command line, judged by the faults every run is checked for, with its transcripts saved to read.
- **A few harder tasks join the eight,** chosen in the design for what agents don't yet do every time, such as long multi-step work in a workspace, recovering from a failed command, or a question relayed through two levels of sub-agents. They show where jen has room to grow.
- **A convention says when a change needs an evaluation.** Any change to what a model sees or what a tool call does is compared against `main`: agents' instructions, tool names, descriptions, inputs, results and errors, the loop's delivery of messages and notices, the runtime's refusals, the model adapter and the model route. A change under `src/agent/` or `src/runtime/` is evaluated unless its pull request says why it can't change behavior, and when in doubt it's evaluated. `deliver-change` quotes the comparison, or that reason, in the handoff. It's a prompted convention, not enforcement: a breach shows as such a pull request with neither an `evals/` summary nor a reason.
- **The hand check is a recipe, not a command.** Since `jen` exists ([JEN-25](https://linear.app/reveer/issue/JEN-25)), `jen new` and `jen @<root> open` start a root and open its page. `environment.md` says how to run a checkout's `jen` apart from the user's, under its own runtime name and image tags, and how to remove it. The click-or-Enter probe UI is dropped: the Safari bug it was for is fixed, and the sandbox check covers it on WebKit.

*Alternative: keep the behavior check as a test, with a pass bar below 100%.* A threshold still fails without any change about as often as the noise crosses it, and still says nothing about two builds.

*Alternative: an LLM judge for every task.* It adds noise of its own on top of the model's. Deterministic checks, like the command task's hash and the file task's exact bytes, stay the rule, and a prompt run is judged only by the shared faults.

## Capabilities

### New Capabilities

- `agent-evaluation`: measuring how agents behave on a real model: tasks and their checks, runs against isolated builds, rates and comparisons, saved results.

### Modified Capabilities

- `agent-delegation`: the two requirements for the behavior live check move to `agent-evaluation`, which no longer fails on a faulty run.
- `agent-runtime`: the runtime counts each agent's model usage from the calls it proxies, and reports it.

## Impact

- **Code:** `src/runtime/behavior.live.test.ts` becomes the evaluation, with its tasks and checks. The runtime's model route and its API gain each agent's usage. `package.json` gains `eval`. `evals/` holds the committed results; how transcripts are stored so they stay small enough to commit is decided in the design.
- **Docs:** `docs/interactions.html` replays saved runs, and its data is written by the evaluation.
- **Skills:** `deliver-change` quotes the comparison, or the reason there is none, in the handoff.
- **Record:** `conventions.md` says when a change is evaluated. `environment.md` describes the evaluation and the isolated-`jen` recipe, and loses the behavior check's flake list. `decisions.md` supersedes the entries that accepted failed passes and the "no worse than `main`" bar. The idea of a view of results over time goes to `ideas.md`.
- **Spend:** an evaluation calls a real model for every run, so a comparison of 50 runs a build costs about what the behavior check costs in four passes.
