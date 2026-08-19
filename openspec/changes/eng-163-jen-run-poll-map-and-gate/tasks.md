## 1. The workflow gains `Pending`

- [x] 1.1 Add `Pending` to the stage table in `AGENTS.md`: `design-task` hands off to `Pending`, and every other stage names `Pending` alongside its normal handoff. State the two-move rule under *Stages* — a stage hands off or it parks the task at `Pending`, and never finishes leaving the task in its own status.
- [x] 1.2 Add the announcement to `AGENTS.md`'s *Conventions*, beside the existing end-of-session comment rule: a stage comments before it produces anything, carrying the `<!-- jen:run stage=<skill> event=start -->` marker, and its closing comment carries `event=end`. State the marker's exact form once, here, since six skills depend on it byte-for-byte.
- [x] 1.3 Replace the "no stage waits on a human" convention's ending — a stage that needs a human now moves the task to `Pending` and comments, rather than stopping and leaving the status alone.
- [x] 1.4 Add the circling rule to *Conventions*: a stage about to route a task backward for something the record shows already sent it back moves it to `Pending` instead, naming the objection and each round.
- [x] 1.5 Update `.claude/skills/design-task/SKILL.md` — design ends by moving the task to `Pending`, not by leaving it at `In Design`. This is the one skill whose *own* completion semantics change; the rest inherit from `AGENTS.md`.
- [x] 1.6 Check the other five skills for text that assumes a stage may finish without moving the status, or that names `In Design` → `In Progress` as the promotion, and correct it. Do not restate the shared conventions in any of them.
- [x] 1.7 Add `Pending` to the statuses `setup-jen` verifies, and to the documented status list in `scaffold/registry.yaml` if it names them.
- [ ] 1.8 Create the `Pending` status on jen's own Linear team. Operator action, not code — the pipeline cannot park a task on this project until it exists.

## 2. The tracker client

- [x] 2.1 Add `cli/linear.ts`: a thin GraphQL client over global `fetch`, reading its token from the environment at the point of use. No dependency added, no token written anywhere, no retry.
- [x] 2.2 Implement the two reads: the team's statuses, and the project's issues with status, identifier, suggested branch name, and their most recent comments nested in the same query. Bound both page sizes explicitly rather than relying on the default 50 — nested defaults are what would approach the 10,000-point per-query cap. Request named fields so a schema change fails loudly rather than returning an empty set.
- [x] 2.3 Add the per-issue comment fallback: where the nested page holds no `jen:run` marker, page that one issue's comments until a marker is found or they are exhausted.
- [x] 2.4 Surface a `RATELIMITED` response as a failure with its own message. It arrives as HTTP 400 with the code in the body, not as a 429, so a generic error check will report it as an unexplained bad request.
- [ ] 2.5 Unit-test the client against recorded responses, including the case that matters most: a query error must surface as a failure, never as zero candidates.

## 3. The table

- [x] 3.1 Add `cli/stages.ts`: the status→skill→role table, matching `AGENTS.md`'s stage table, with case-insensitive status lookup. Roles per `pipeline-identity` — `design-task`→`design`, `implement-task`→`dev`, the other three→`deliver`.
- [ ] 3.2 Add a test that parses the stage table out of `AGENTS.md` and asserts the compiled table matches it, in the idiom `test/payload.test.ts` uses for scaffold references. This is the only thing standing between the two statements and drift.

## 4. The tick

- [x] 4.1 Add `cli/run.ts`: startup checks first — every required credential present, the team and project supplied as input, and `Pending` resolving on the team — each refusing the run by name before anything is polled.
- [x] 4.2 Poll for issues in the team and project, and reduce to candidates by the table. Statuses absent from the table are not candidates, including ones jen has never heard of.
- [x] 4.3 Implement the in-flight test over the comments the poll already returned: find the most recent carrying a `jen:run` marker, and treat the task as in flight when that marker is `event=start`. Ignore comments without a marker entirely.
- [x] 4.4 Apply the concurrency cap over the candidate set, defaulting to 3 and settable by flag. Never emit two run requests for one task in a tick.
- [x] 4.5 Emit a run request per dispatch as one JSON object per line on stdout — task identifier, skill, role, branch — carrying no credential.
- [x] 4.6 Write the report to stderr: every candidate considered, and for each, dispatched or the reason it was declined.
- [x] 4.7 Wire `run` into `cli.ts` and the usage text, parsing its flags and environment. Keep `init` and `update` untouched — they stay filesystem-only.

## 5. Proving it

- [ ] 5.1 Unit-test the gate against the cases that carry the design: a start with no end is in flight; a start followed by an end is not; a task re-entering a status it was in before is a candidate again; unmarked comments change nothing.
- [ ] 5.2 Unit-test candidacy and mapping: `Todo` and `Pending` are never candidates, an unknown status is not a candidate, and each stage status maps to its skill and role.
- [ ] 5.3 Unit-test the refusals — missing credential, missing project identity, absent `Pending` — each naming what is missing and dispatching nothing.
- [ ] 5.4 Assert the tick writes nothing: no tracker mutation is reachable from the run path, and no file is written.
- [ ] 5.5 Run the tick against jen's own Linear project by hand and check the report describes reality. This is the first real exercise of the client — no raw query was run during design — and it is read-only, so it is safe against live data. Read `X-RateLimit-Complexity-Remaining` off the response and check the poll's actual cost against the design's estimate of roughly 1,050 points; bring the page sizes down if it is materially higher.

## 6. Notes

- [ ] 6.1 Write what this establishes into `cli/AGENTS.md`: that the tick writes nothing and why the announcement is therefore the session's rather than the dispatcher's, that the status table is a second statement of `AGENTS.md`'s and which test holds it, and that the client's queries name their fields so a schema change fails loudly.
