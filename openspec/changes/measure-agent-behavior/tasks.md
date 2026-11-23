# Tasks

## 1. Usage in the runtime

- [ ] 1.1 In `src/runtime/server.ts`, `modelCall` keeps a copy of the provider's answer as it pipes it and, once it ends, adds the call to the caller's count: one call, and `usage`'s `input_tokens`, `input_tokens_details.cached_tokens`, `output_tokens`, `output_tokens_details.reasoning_tokens` and `cost` when present. An answer that doesn't parse or has no `usage` counts as a call with no tokens. Counts are kept in memory per agent with its root, and survive the agent's deletion. Update the file's header comment. Verify with tests in `server.test.ts` for each scenario in the `agent-runtime` delta's "counts each agent's model usage", including that the bytes the agent receives are unchanged.
- [ ] 1.2 Add `GET /usage` for the owner, answering `{"agents": [...]}` as the delta spec says, and `403` for an agent. Verify with tests in `server.test.ts` for usage by root, an agent's `403`, and `GET /agents` carrying no usage.
- [ ] 1.3 Find out whether the providers we use report `cost` in `usage`: one call each through OpenAI and OpenRouter, recorded in this file. Verify the design's usage decision matches what they send.

## 2. Tasks, runs and faults

- [ ] 2.1 Add `scripts/eval/tasks.ts` with the eight tasks and their checks moved from `src/runtime/behavior.live.test.ts`, unchanged in wording, an optional time limit per task, and each task's hash from its fields and its check's source. Verify with a test in `scripts/eval/tasks.test.ts` that the hash changes when a check's source changes and not otherwise.
- [ ] 2.2 Add `scripts/eval/run.ts`, which runs one task against a runtime as the behavior check does today (its own root, watching its tree, settling, the answer step), and returns its outcome, faults with their kinds, transcript, metrics and usage summed by root from `GET /usage`, treating a `404` there as no tokens. A harness failure returns errored with its reason. The fault rules are a pure function of the run's events and replies. Verify with tests in `scripts/eval/run.test.ts` that feed recorded events to the fault rules for each fault kind and each scenario under "Runs fail as the behavior check's did".
- [ ] 2.3 Add the `--prompt` task (`prompt-<8 hex>`, `--grant`, one or more replies passing). Verify with a test that a prompt run with two replies and no other fault passes, and one with none fails with `replies`.

## 3. Sides, builds and the command

- [ ] 3.1 Add `scripts/eval/build.ts`: a build's tree (a ref's `^{tree}`, or the working tree's through a temporary index with `git add -A`), its commit and whether it's dirty, and building the three targets into `jen-<target>:eval-<id>-<side>`, from a `git worktree add --detach` checkout for a ref, removed afterwards. Verify with tests in `scripts/eval/build.test.ts` on a temporary git repo that a dirty tree and its commit get the same tree, and that an untracked file changes it and an ignored one doesn't.
- [ ] 3.2 Add `scripts/eval/side.ts`, which starts a side's runtime as `jen-eval-<id>-<side>` with its images, the credentials and `JEN_MAX_AGENTS` fitted to `--parallel`, and removes everything labelled with that name, the runtime, and the image tags. Verify by running it against Docker and finding nothing of it left with `docker ps -a`, `docker volume ls`, `docker network ls` and `docker image ls`.
- [ ] 3.3 Add `scripts/eval/main.ts` and `npm run eval`: arguments as the design lists them, credentials from the environment or `.env`, a missing key or model failing before anything starts, one queue alternating sides and cycling tasks with `--parallel` in flight, and cleanup on exit and on `SIGINT`. Verify with tests in `scripts/eval/main.test.ts` for the arguments, the missing key, and the queue's order, and by interrupting a live evaluation with Ctrl-C and finding nothing of it left.

## 4. Statistics, results and the report

- [ ] 4.1 Add `scripts/eval/stats.ts` with the Wilson interval, the two-sided Fisher's exact test, the Mann–Whitney U test, the runs-per-side estimate at 80% power, and the count of tasks chance would flag. Verify with tests in `scripts/eval/stats.test.ts` against published values for each, and the delta's "Too few runs" and "A clear drop" scenarios.
- [ ] 4.2 Add `scripts/eval/results.ts`: the `evals/<UTC start>-<id>/` folder, `runs.jsonl` appended as each run ends, with agent IDs shortened, and `summary.json` written at the end or marked partial on an interrupt. Verify with a test that an interrupted evaluation's folder holds its runs and a partial summary.
- [ ] 4.3 Add `npm run eval -- report <evaluation>`, printing the Markdown report from `summary.json`, which an evaluation also prints when it ends. Verify with a test on a stored summary of two sides that the tables show rates, intervals, fault kinds, medians and verdicts, and tokens only where both sides have them.

## 5. Replay

- [ ] 5.1 In `docs/interactions.html`, add a control that opens a `runs.jsonl` the user picks, a choice of run by side, task and outcome, and a failed run's faults. Verify in a browser that the page, opened as a file, replays a run from a stored `runs.jsonl` and shows a failed run's faults, and that it still replays its committed recording.
- [ ] 5.2 Add `npm run eval -- record <evaluation>`, writing `docs/interactions.data.js` with each task's first passed run, or else its first failed run. Verify with a test that a task with no passed run is recorded from a failed one.

## 6. Retire the behavior check

- [ ] 6.1 Delete `src/runtime/behavior.live.test.ts` and `JEN_LIVE_RECORD`. Verify that `npm run check`, and `npm test` pass, that `npx vitest list --config vitest.live.config.ts` lists no behavior check, and that no file names either any more.

## 7. The harder tasks

- [ ] 7.1 Add `project`, `recover` and `relay` to `scripts/eval/tasks.ts` with the checks the design describes. Verify each check with a unit test that a hand-made passing result passes and a failing one fails.
- [ ] 7.2 Measure each on `openai/gpt-6-luna` with `npm run eval -- --tasks project,recover,relay --runs 20`. Make harder or replace a task that passes 20 of 20, and read the transcripts of one that never passes to rule out a fault in the task. Verify that the evaluation committed under `evals/` shows each task below 100% and above 0%, or the record says why one isn't.

## 8. Record, convention and handoff

- [ ] 8.1 In `edda/conventions.md`, add the rule for when a change is evaluated, as the proposal states it. In `.agents/skills/deliver-change/SKILL.md`, add that the handoff quotes the comparison's report from `evals/`, or the reason there is none. Verify both say the same thing and neither repeats the other.
- [ ] 8.2 In `edda/environment.md`: describe `scripts/eval/`, `npm run eval` and its subcommands, `evals/` and `GET /usage`; remove the behavior check and its flake list; add the hand-check recipe (images under tags of their own, `jen` with `JEN_RUNTIME_NAME` and the three image variables, and the cleanup commands). Verify the recipe by running it as written: a root answers, its page opens, and nothing of it is left after the cleanup.
- [ ] 8.3 In `edda/decisions.md`, log this change's decisions and mark 2026-11-11's tolerated delegation failures and 2026-11-18's accepted Luna flake superseded. Add a view of results over time to `edda/ideas.md`. Verify each superseded entry links to the one replacing it.
- [ ] 8.4 Update `docs/architecture.html` if it describes the behavior check or the model route's handling, and `docs/interactions.html`'s description of where its data comes from. Verify with the views' `describes` tags that each view whose sources changed was checked.

## 9. Evaluating this change

- [ ] 9.1 Evaluate the working tree against `main` on the eight tasks: `npm run eval -- --against main --tasks <the eight> --runs 20`. Verify that its folder is committed under `evals/`, that no task is worse with the tokens shown on this side only, and that nothing of it is left in Docker.
- [ ] 9.2 Run `npm run check`, `npm test` and `npm run test:live`. Verify they pass, other than the known flakes `environment.md` lists.

## Workflow follow-up

- `flo-review` reviews the implementation, then `deliver-change` hands it to the maintainer with the report from 9.1.
- Once approved, `deliver-change` archives the change and merges it.
