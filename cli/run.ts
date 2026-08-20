/**
 * The tick: one poll-map-gate-dispatch pass over the tracker, then exit.
 *
 * The loop is not here. `jen run` is the seam between the dispatcher and whatever drives
 * it, so a scheduled job and a long-running local process are both thin wrappers over this
 * one entry point rather than two implementations of the same decision that drift.
 *
 * Nothing below writes. Not to the tracker, not to the git host, not to the filesystem —
 * which is what makes a tick safe to run at any time, twice, and before anything exists to
 * consume what it emits. The comment marking a task as taken is the session's own, written
 * once the session is actually running; see `cli/AGENTS.md` for what that costs.
 */
import { EPIC_LABEL, fold, PENDING, stageFor, TASK_LABEL, type Stage } from './stages.js';
import {
  LABEL_PAGE_SIZE,
  newestFirst,
  RateLimited,
  STATE_PAGE_SIZE,
  Tracker,
  TrackerError,
  TOKEN_VARIABLE,
  type TrackerComment,
  type TrackerIssue,
} from './linear.js';

import type { Io } from './cli.js';

/**
 * The session announcement, exactly as the root `AGENTS.md` tells all six stages to write
 * it. Byte-for-byte across seven statements of it — six skills and this one — so
 * `test/stages.test.ts` holds this pattern against the form the workflow document states.
 */
export const MARKER = /<!--\s*jen:run\s+stage=([A-Za-z0-9-]+)\s+event=(start|end)\s*-->/;

export type Event = 'start' | 'end';

export interface Announcement {
  skill: string;
  event: Event;
}

/** The environment the tick reads. Everything it needs arrives here or as a flag. */
export interface Environment {
  [key: string]: string | undefined;
}

export interface TickInput {
  team?: string;
  project?: string;
  /** Simultaneous runs the pipeline may have in flight. A spend control, not a correctness one. */
  concurrency: number;
  issuePageSize: number;
  commentPageSize: number;
}

export const DEFAULTS = {
  concurrency: 3,
  issuePageSize: 50,
  commentPageSize: 10,
} as const;

/**
 * How many follow-up pages of one issue's comments a tick will read before giving up on it.
 *
 * Every other bound in this change exists to keep the poll cheap; this one exists because
 * the fallback has no natural end. Both walks in {@link established} can run long — the
 * backward one drains the whole record of a task nothing has ever announced against, and the
 * forward one drains it *by construction*, since it cannot exit early without settling on a
 * stale marker. Left uncapped, an ascending connection would make every long-running task
 * re-read its entire history on every tick, forever, growing with the discussion.
 *
 * Not a flag. `--comment-page` already moves what this reaches — five pages of thirty is
 * five pages of thirty — and it does so in fewer requests for the same comments read, so a
 * second lever would only offer the worse way to spend the same budget.
 *
 * **Exhausting it declines the candidate; it never falls through to dispatching.** "Not in
 * flight" is what dispatches, so treating an unreadable record as idle would start a session
 * on top of a live one — the failure the ordering evidence exists to prevent, arrived at from
 * the other side. Unproven is reported as unproven, every tick, where a person can see it.
 */
export const COMMENT_PAGE_BUDGET = 5;

/** What the executor consumes: one of these per dispatch, as a line of JSON on stdout. */
export interface RunRequest {
  task: string;
  skill: string;
  role: string;
  branch: string;
}

export type Verdict = { dispatch: RunRequest } | { declined: string };

export interface Outcome {
  identifier: string;
  status: string;
  verdict: Verdict;
}

/**
 * What a task's comment record established: a session is working it, none is, or the record
 * could not be read within the budget and neither can be claimed.
 */
export type Presence = { inFlight: boolean } | { unreadable: string };

/** A candidate, with everything the gate needs already established from the tracker. */
export interface Examined {
  identifier: string;
  status: string;
  branch: string;
  stage: Stage;
  presence: Presence;
}

/** The announcement a comment carries, if it carries one. */
export function announcementIn(comment: TrackerComment): Announcement | undefined {
  const match = MARKER.exec(comment.body);
  return match ? { skill: match[1]!, event: match[2] as Event } : undefined;
}

/**
 * Whether a session is working the task, from the most recent comment carrying a marker.
 *
 * Comments arrive newest first, so the first marked one wins and everything older is
 * irrelevant — which is exactly what makes re-entry work without reading transition
 * history. A task routed back into a status it was in before carries that session's
 * `start` *and* its `end`; the most recent marker is `end`, so it is a candidate again.
 *
 * Comments carrying no marker change nothing. A stage's note to a human and a person's
 * reply both sit between a `start` and its `end` routinely.
 *
 * The marker's `stage` is deliberately not compared against the task's current stage. A
 * session that has already moved the status and is still writing its closing comment is a
 * session still working the task, and matching on stage would dispatch the next one on top
 * of it.
 */
export function inFlight(comments: TrackerComment[]): boolean | undefined {
  for (const comment of comments) {
    const announcement = announcementIn(comment);
    if (announcement) return announcement.event === 'start';
  }
  return undefined;
}

/**
 * The gate, as a pure function of what the tracker said.
 *
 * Two ticks over identical tracker state reach identical conclusions, which is what lets
 * two runners share one ceiling without knowing about each other. The in-flight count is
 * over the candidates already fetched: a run in flight against a task whose status has
 * since left the pipeline is missed, but that is a session on its way out rather than one
 * about to start work, so counting it would only make the cap more conservative.
 *
 * A candidate whose record could not be read counts *toward* the cap for the same reason it
 * is not dispatched: it may well be a live session, and a spend control that errs should err
 * toward fewer sessions.
 */
export function decide(examined: Examined[], concurrency: number): Outcome[] {
  let running = examined.filter((candidate) => !('inFlight' in candidate.presence) || candidate.presence.inFlight).length;

  return examined.map((candidate): Outcome => {
    const common = { identifier: candidate.identifier, status: candidate.status };

    if ('unreadable' in candidate.presence) {
      return { ...common, verdict: { declined: candidate.presence.unreadable } };
    }
    if (candidate.presence.inFlight) {
      return { ...common, verdict: { declined: 'a session has announced itself and not yet reported' } };
    }
    if (running >= concurrency) {
      return { ...common, verdict: { declined: `${running} runs are in flight and the cap is ${concurrency}` } };
    }

    running += 1;
    return {
      ...common,
      verdict: {
        dispatch: {
          task: candidate.identifier,
          skill: candidate.stage.skill,
          role: candidate.stage.role,
          branch: candidate.branch,
        },
      },
    };
  });
}

/** A refusal: the tick declines to run at all, naming what is missing. */
class Refusal extends Error {}

function line(label: string, detail: string): string {
  return `  ${label.padEnd(11)}${detail}`;
}

/**
 * The most recent announcement on an issue, paging that one issue's comments where the
 * nested page cannot answer it.
 *
 * Two different reasons to page, and they need different loops, which is the whole of why
 * this reads as two branches rather than one:
 *
 * - **The page is the newest and holds no marker.** A task with a long human discussion
 *   since its last session. Every further page is strictly older, so the first marker found
 *   walking backward is still the most recent one and the walk stops there.
 * - **The page cannot be shown to be the newest.** It came back oldest-first, or it was too
 *   short to tell. Paging forward from here walks toward *newer* comments, so stopping at
 *   the first marker would settle on a stale one — the walk has to reach the end before
 *   anything is read out of it.
 *
 * Both are bounded to the one issue that needs them, and both are bounded again by {@link
 * COMMENT_PAGE_BUDGET} — neither walk ends on its own in the case that matters, so the
 * ceiling is what keeps a long discussion from being re-read in full on every tick forever.
 * Running out of budget is reported as unproven and declines the candidate; it is never read
 * as "nothing is working it", which is what would dispatch.
 *
 * The alternative to the fallback, a larger nested page, pays complexity on every tick
 * against every issue to serve the rare one.
 */
async function established(
  tracker: Tracker,
  issue: TrackerIssue,
  pageSize: number,
  budget = COMMENT_PAGE_BUDGET,
): Promise<Presence> {
  let hasNextPage = issue.moreComments;
  let cursor = issue.commentCursor;
  let left = budget;

  const spent = (): boolean => {
    if (left === 0) return true;
    left -= 1;
    return false;
  };

  const unreadable = (why: string): Presence => ({
    unreadable:
      `${why} after ${budget} further page${budget === 1 ? '' : 's'} of ${pageSize}, so whether a session is ` +
      'working it is unproven — raise --comment-page to read further rather than dispatching on an unread record',
  });

  if (issue.commentsAreNewest) {
    const nested = inFlight(issue.comments);
    if (nested !== undefined) return { inFlight: nested };

    while (hasNextPage) {
      if (spent()) return unreadable("no announcement was found in this task's newest comments");
      const page = await tracker.comments(issue.id, pageSize, cursor);
      const older = inFlight(page.comments);
      if (older !== undefined) return { inFlight: older };
      hasNextPage = page.hasNextPage;
      cursor = page.endCursor;
    }

    // No session has ever announced itself against this task.
    return { inFlight: false };
  }

  const all = [...issue.comments];
  while (hasNextPage) {
    if (spent()) return unreadable("the tracker returned this task's comments oldest-first and the record ran on");
    const page = await tracker.comments(issue.id, pageSize, cursor);
    all.push(...page.comments);
    hasNextPage = page.hasNextPage;
    cursor = page.endCursor;
  }

  return { inFlight: inFlight(newestFirst(all)) ?? false };
}

/**
 * Why an issue sitting in a stage's status is not a candidate for one, or nothing where it
 * is. Read before the comments are, so an epic costs no page of a discussion it will never
 * be dispatched against.
 */
function notATask(issue: TrackerIssue): string | undefined {
  const carried = new Set(issue.labels.map(fold));
  if (carried.has(fold(TASK_LABEL))) return undefined;
  if (carried.has(fold(EPIC_LABEL))) {
    return 'an epic, not a task; its children are what the pipeline runs, and it has no change of its own';
  }
  // Same decline either way, but not the same claim: "nothing has refined it" is a statement
  // about the issue, and a truncated label page cannot support one.
  return issue.moreLabels
    ? `not a task; no \`${TASK_LABEL}\` label was among the ${LABEL_PAGE_SIZE} labels read, and it carries more behind that bound`
    : `not a task; it carries neither the \`${TASK_LABEL}\` nor the \`${EPIC_LABEL}\` label, so nothing has refined it`;
}

/**
 * One tick.
 *
 * Every refusal happens before anything is polled, so a misconfigured run fails naming
 * what is missing rather than partway through a pass that has already emitted some of its
 * run requests.
 */
export async function tick(input: TickInput, io: Io, env: Environment, transport?: typeof fetch): Promise<number> {
  try {
    const token = env[TOKEN_VARIABLE];
    if (!token) {
      throw new Refusal(
        `${TOKEN_VARIABLE} is not set. The tick reads its tracker credential from the environment at the point ` +
          'of use, and never from a file.',
      );
    }
    if (!input.team) throw new Refusal('no tracker team was given. Pass --team, or set JEN_TEAM.');
    if (!input.project) throw new Refusal('no tracker project was given. Pass --project, or set JEN_PROJECT.');
    if (input.concurrency < 1) throw new Refusal(`--concurrency must be at least 1, and was ${input.concurrency}.`);

    const tracker = new Tracker({ token, transport });
    const team = await tracker.team(input.team);

    // `Pending` is where every stage puts a task that needs a person. A team without it has
    // stages that can pick a task up and then have nowhere to put it, which leaves the task
    // in a stage status — which the pipeline reads as a session still working it. Refusing
    // outright is the cheaper failure, and it happens before any session is started.
    const carried = new Map(team.statuses.map((status) => [fold(status), status]));
    if (!carried.has(fold(PENDING))) {
      throw new Refusal(
        `the team \`${input.team}\` carries no \`${PENDING}\` status, so no stage could park a task that needs ` +
          'a person. Add it in the tracker and re-run.' +
          (team.moreStatuses
            ? ` This read was bounded at ${STATE_PAGE_SIZE} statuses and the team carries more, so \`${PENDING}\` ` +
              'may exist behind that bound — the refusal is that the tick could not see it, not that it is absent.'
            : ''),
      );
    }

    io.err(`jen run — ${input.team}/${input.project}`);
    io.err('');

    // The poll filters on the team's own status names rather than the workflow's, resolved
    // case-insensitively here. `project-binding` already settles that `in design` and
    // `In Design` are one status; this is where that is spent.
    const wanted: { name: string; stage: Stage }[] = [];
    const absent: string[] = [];
    for (const status of ['In Design', 'In Progress', 'In Review', 'In Testing', 'In Delivery']) {
      const stage = stageFor(status)!;
      const actual = carried.get(fold(status));
      if (actual === undefined) absent.push(status);
      else wanted.push({ name: actual, stage });
    }
    if (team.moreStatuses) {
      io.err(
        line(
          'note',
          `the team carries more than ${STATE_PAGE_SIZE} statuses and this read was bounded there, so any named ` +
            'below as absent may simply be behind that bound',
        ),
      );
    }
    for (const status of absent) {
      io.err(
        line(
          'note',
          team.moreStatuses
            ? `no \`${status}\` status was among the ones read, so nothing sitting in it will be polled`
            : `the team carries no \`${status}\` status, so nothing can sit in it`,
        ),
      );
    }

    const { issues, moreIssues } = await tracker.issues(
      team.id,
      input.project,
      wanted.map((entry) => entry.name),
      input.issuePageSize,
      input.commentPageSize,
    );

    // The tick cannot act on this and does not need to. What it owes a person is that the
    // report account for everything sitting in a stage's status, and an unexamined remainder
    // named is that; an unexamined remainder passed over in silence is the one failure this
    // whole path is built to refuse, since it reads exactly like a quiet pipeline.
    if (moreIssues) {
      io.err(
        line(
          'note',
          `more issues are sitting in a stage status than the page bound of ${input.issuePageSize}, and the rest ` +
            'were not examined. Raise --issue-page.',
        ),
      );
    }

    const examined: Examined[] = [];
    // Everything in a stage's status that is not a task. Declined here rather than filtered
    // out of the poll, so that a person who moved an issue into the pipeline and saw nothing
    // happen has somewhere to find out why. Silence would be indistinguishable from a
    // pipeline with nothing to do.
    const notTasks: Outcome[] = [];

    for (const issue of issues) {
      // Mapped again from the issue's own status rather than trusted from the filter: the
      // table is the authority on candidacy, and a status it does not name is not a
      // candidate however it came back.
      const stage = stageFor(issue.status);
      if (!stage) continue;

      const declined = notATask(issue);
      if (declined !== undefined) {
        notTasks.push({ identifier: issue.identifier, status: issue.status, verdict: { declined } });
        continue;
      }

      examined.push({
        identifier: issue.identifier,
        status: issue.status,
        branch: issue.branchName,
        stage,
        presence: await established(tracker, issue, input.commentPageSize),
      });
    }

    // Candidates first and the non-tasks after, because the second group is the standing
    // background of any project with epics in it and the first is what changed this tick.
    const outcomes = [...decide(examined, input.concurrency), ...notTasks];

    for (const outcome of outcomes) {
      if ('dispatch' in outcome.verdict) {
        const request = outcome.verdict.dispatch;
        io.out(JSON.stringify(request));
        io.err(line('dispatched', `${outcome.identifier}  ${request.skill} as ${request.role}  ${request.branch}`));
      } else {
        io.err(line('declined', `${outcome.identifier}  ${outcome.status} — ${outcome.verdict.declined}`));
      }
    }

    if (outcomes.length === 0) io.err(line('idle', 'no task is sitting in a stage status'));

    const { complexityCharged, complexityRemaining, requestsRemaining } = tracker.budget;
    const budget = [
      complexityCharged === undefined ? undefined : `${complexityCharged} points charged`,
      complexityRemaining === undefined ? undefined : `${complexityRemaining} points left this hour`,
      requestsRemaining === undefined ? undefined : `${requestsRemaining} requests left this hour`,
    ].filter((part): part is string => part !== undefined);
    if (budget.length > 0) io.err(line('budget', budget.join(', ')));

    return 0;
  } catch (error) {
    if (error instanceof Refusal) {
      io.err(`jen run: ${error.message}`);
      io.err('Nothing was polled and nothing was dispatched.');
      return 1;
    }
    if (error instanceof RateLimited || error instanceof TrackerError) {
      io.err(`jen run: ${error.message}`);
      return 1;
    }
    throw error;
  }
}
