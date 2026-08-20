## 1. The workflow gains `Pending`

- [x] 1.1 Add `Pending` to the stage table in `AGENTS.md`: `design-task` hands off to `Pending`, and every other stage names `Pending` alongside its normal handoff. State the two-move rule under *Stages* — a stage hands off or it parks the task at `Pending`, and never finishes leaving the task in its own status.
- [x] 1.2 Add the announcement to `AGENTS.md`'s *Conventions*, beside the existing end-of-session comment rule: a stage comments before it produces anything, carrying the `<!-- jen:run stage=<skill> event=start -->` marker, and its closing comment carries `event=end`. State the marker's exact form once, here, since six skills depend on it byte-for-byte.
- [x] 1.3 Replace the "no stage waits on a human" convention's ending — a stage that needs a human now moves the task to `Pending` and comments, rather than stopping and leaving the status alone.
- [x] 1.4 Add the circling rule to *Conventions*: a stage about to route a task backward for something the record shows already sent it back moves it to `Pending` instead, naming the objection and each round.
- [x] 1.5 Update `.claude/skills/design-task/SKILL.md` — design ends by moving the task to `Pending`, not by leaving it at `In Design`. This is the one skill whose *own* completion semantics change; the rest inherit from `AGENTS.md`.
- [x] 1.6 Check the other five skills for text that assumes a stage may finish without moving the status, or that names `In Design` → `In Progress` as the promotion, and correct it. Do not restate the shared conventions in any of them.
- [x] 1.7 Add `Pending` to the statuses `setup-jen` verifies, and to the documented status list in `scaffold/registry.yaml` if it names them.
- [x] 1.8 Create the `Pending` status on jen's own Linear team. Operator action, not code — the pipeline cannot park a task on this project until it exists.

## 2. The tracker client

- [x] 2.1 Add `cli/linear.ts`: a thin GraphQL client over global `fetch`, reading its token from the environment at the point of use. No dependency added, no token written anywhere, no retry.
- [x] 2.2 Implement the two reads: the team's statuses, and the project's issues with status, identifier, suggested branch name, and their most recent comments nested in the same query. Bound both page sizes explicitly rather than relying on the default 50 — nested defaults are what would approach the 10,000-point per-query cap. Request named fields so a schema change fails loudly rather than returning an empty set.
- [x] 2.3 Make the comment read ordering-independent, and page when it must. Compare the first and last `createdAt` in the page that came back: if it is descending, a full page is the newest and nothing more is needed. If it is ascending, or if the page holds no `jen:run` marker at all, page that one issue's comments through to the newest. Do not assume the documented descending default — the failure it hides is silent and permanent, not degraded.
- [x] 2.4 Surface a `RATELIMITED` response as a failure with its own message. It arrives as HTTP 400 with the code in the body, not as a 429, so a generic error check will report it as an unexplained bad request.
- [x] 2.5 Unit-test the client against recorded responses, including the case that matters most: a query error must surface as a failure, never as zero candidates.

## 3. The table

- [x] 3.1 Add `cli/stages.ts`: the status→skill→role table, matching `AGENTS.md`'s stage table, with case-insensitive status lookup. Roles per `pipeline-identity` — `design-task`→`design`, `implement-task`→`dev`, the other three→`deliver`.
- [x] 3.2 Add a test that parses the stage table out of `AGENTS.md` and asserts the compiled table matches it, in the idiom `test/payload.test.ts` uses for scaffold references. This is the only thing standing between the two statements and drift.

## 4. The tick

- [x] 4.1 Add `cli/run.ts`: startup checks first — every required credential present, the team and project supplied as input, and `Pending` resolving on the team — each refusing the run by name before anything is polled.
- [x] 4.2 Poll for issues in the team and project, and reduce to candidates by the table *and* the `task` label. Statuses absent from the table are not candidates, including ones jen has never heard of; an issue without the `task` label is not a candidate whatever its status. Request labels in the poll, and keep the label out of the server-side filter — a non-task issue has to be fetched to be reported, and 4.6 is where it surfaces.
- [x] 4.3 Implement the in-flight test over the comments the poll already returned: find the most recent carrying a `jen:run` marker, and treat the task as in flight when that marker is `event=start`. Ignore comments without a marker entirely.
- [x] 4.4 Apply the concurrency cap over the candidate set, defaulting to 3 and settable by flag. Never emit two run requests for one task in a tick.
- [x] 4.5 Emit a run request per dispatch as one JSON object per line on stdout — task identifier, skill, role, branch — carrying no credential.
- [x] 4.6 Write the report to stderr: every candidate considered, and for each, dispatched or the reason it was declined — plus every issue in a stage's status declined for not being a task, distinguishing an epic from an issue carrying neither label. This is the only place a person learns why an issue they moved into the pipeline did nothing.
- [x] 4.7 Wire `run` into `cli.ts` and the usage text, parsing its flags and environment. Keep `init` and `update` untouched — they stay filesystem-only.

## 5. Proving it

- [x] 5.1 Unit-test the gate against the cases that carry the design: a start with no end is in flight; a start followed by an end is not; a task re-entering a status it was in before is a candidate again; unmarked comments change nothing.
- [x] 5.2 Unit-test candidacy and mapping: `Todo` and `Pending` are never candidates, an unknown status is not a candidate, an epic in a stage status is not a candidate, an issue carrying neither label is not a candidate and appears in the report, and each stage status maps to its skill and role.
- [x] 5.3 Unit-test the refusals — missing credential, missing project identity, absent `Pending` — each naming what is missing and dispatching nothing.
- [x] 5.4 Assert the tick writes nothing: no tracker mutation is reachable from the run path, and no file is written.
- [ ] 5.5 Run the tick against jen's own Linear project by hand and check the report describes reality — re-run after the label gate and the ordering fallback land, since the first run is what produced both. It is read-only and safe against live data. Confirm ENG-136 and ENG-133 are now reported as declined epics rather than dispatched, and that every issue dispatched is one a person would agree should run.

- [x] 5.6 Unit-test the ordering fallback against recorded responses: a descending full page is used as-is; an ascending full page triggers the follow-up read and the marker found is the one from the newest comment; a page of a single comment is treated as complete. This is the test that stands in for an assumption the design deliberately stopped making.
- [x] 5.7 Check that every task in jen's own Linear project carries the `task` label, and label any that do not. Candidacy now rests on it, so a task refined before this rule existed would silently stop being picked up.

## 6. Notes

- [x] 6.1 Write what this establishes into `cli/AGENTS.md`: that the tick writes nothing and why the announcement is therefore the session's rather than the dispatcher's, that the status table is a second statement of `AGENTS.md`'s and which test holds it, and that the client's queries name their fields so a schema change fails loudly, and that the comment read establishes its own ordering rather than trusting the documented default — with why, since it reads like defensive noise until you know the failure is a task dispatched forever.
