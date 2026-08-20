/**
 * The tick's decision, and the property underneath it: that running it changes nothing.
 *
 * The gate is exercised directly, because it is a pure function of what the tracker said
 * and that is the whole point of it — two runners over identical state reach identical
 * conclusions. The refusals and the writes-nothing property go through the command as an
 * operator invokes it.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { run, type Io } from '../cli/cli.js';
import type { Transport } from '../cli/linear.js';
import { COMMENT_PAGE_BUDGET, decide, inFlight, type Examined } from '../cli/run.js';
import { stageFor } from '../cli/stages.js';
import { repoRoot } from './helpers.js';

let clock = 0;

/** A comment, newer than every comment made before it. */
function comment(body: string) {
  clock += 1;
  return { id: `c${clock}`, createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, clock)).toISOString(), body };
}

function announcement(skill: string, event: 'start' | 'end') {
  return comment(`Picking this up.\n\n<!-- jen:run stage=${skill} event=${event} -->`);
}

/** Newest first, which is the order the client hands them over in. */
function newestFirst(...comments: ReturnType<typeof comment>[]) {
  return [...comments].reverse();
}

function candidate(identifier: string, status: string, running: boolean | { unreadable: string }): Examined {
  return {
    identifier,
    status,
    branch: `${identifier.toLowerCase()}-a-task`,
    stage: stageFor(status)!,
    presence: typeof running === 'boolean' ? { inFlight: running } : running,
  };
}

describe('the in-flight test', () => {
  it('reads a start with no end after it as a session still working', () => {
    expect(inFlight(newestFirst(announcement('implement-task', 'start')))).toBe(true);
  });

  it('reads a start followed by an end as a session that finished', () => {
    const comments = newestFirst(announcement('design-task', 'start'), announcement('design-task', 'end'));
    expect(inFlight(comments)).toBe(false);
  });

  // The whole of why re-entry needs no transition history: the earlier session left both
  // markers, so the most recent one is its `end` and the task is a candidate again.
  it('lets a task re-enter a status a session already worked', () => {
    const comments = newestFirst(
      announcement('implement-task', 'start'),
      announcement('implement-task', 'end'),
      announcement('review-task', 'start'),
      announcement('review-task', 'end'),
    );
    expect(inFlight(comments)).toBe(false);
  });

  it('ignores comments carrying no marker, wherever they fall', () => {
    const withNotes = newestFirst(
      announcement('implement-task', 'start'),
      comment('A note for a human about something odd here.'),
      comment('Reply from a person: go ahead.'),
    );
    expect(inFlight(withNotes), 'a human replying does not end a session').toBe(true);

    expect(inFlight(newestFirst(comment('nothing marked at all'))), 'nothing to establish').toBeUndefined();
    expect(inFlight([]), 'a task nothing has run against').toBeUndefined();
  });

  // A session that has moved the status and is still writing its closing comment is a
  // session still working the task. Matching the marker's stage against the task's current
  // one would dispatch the next stage on top of it.
  it('does not require the announcement to name the task\'s current stage', () => {
    expect(inFlight(newestFirst(announcement('implement-task', 'start')))).toBe(true);
  });
});

describe('the gate', () => {
  it('dispatches a candidate nothing is working, naming skill, role, and branch', () => {
    const outcomes = decide([candidate('ENG-1', 'In Progress', false)], 3);
    expect(outcomes).toEqual([
      {
        identifier: 'ENG-1',
        status: 'In Progress',
        verdict: { dispatch: { task: 'ENG-1', skill: 'implement-task', role: 'dev', branch: 'eng-1-a-task' } },
      },
    ]);
  });

  it('declines a task a session has announced itself against', () => {
    const [only] = decide([candidate('ENG-1', 'In Review', true)], 3);
    expect(only!.verdict).toEqual({ declined: 'a session has announced itself and not yet reported' });
  });

  it('emits at most one run request per task', () => {
    const outcomes = decide([candidate('ENG-1', 'In Design', false), candidate('ENG-2', 'In Testing', false)], 3);
    const dispatched = outcomes.flatMap((outcome) => ('dispatch' in outcome.verdict ? [outcome.verdict.dispatch.task] : []));
    expect(dispatched).toEqual(['ENG-1', 'ENG-2']);
    expect(new Set(dispatched).size).toBe(dispatched.length);
  });

  it('stops at the cap and leaves the rest for the next tick', () => {
    const outcomes = decide(
      [
        candidate('ENG-1', 'In Progress', false),
        candidate('ENG-2', 'In Review', false),
        candidate('ENG-3', 'In Testing', false),
      ],
      2,
    );
    expect(outcomes.map((outcome) => ('dispatch' in outcome.verdict ? 'dispatched' : 'declined'))).toEqual([
      'dispatched',
      'dispatched',
      'declined',
    ]);
    expect(outcomes[2]!.verdict).toEqual({ declined: '2 runs are in flight and the cap is 2' });
  });

  // The ceiling holds across runners because both derive it from the same announcements on
  // the same tasks, rather than from what either of them remembers launching.
  it('counts runs already in flight against the cap', () => {
    const outcomes = decide(
      [
        candidate('ENG-1', 'In Progress', true),
        candidate('ENG-2', 'In Review', true),
        candidate('ENG-3', 'In Testing', false),
      ],
      2,
    );
    expect(outcomes.every((outcome) => 'declined' in outcome.verdict)).toBe(true);
    expect(outcomes[2]!.verdict).toEqual({ declined: '2 runs are in flight and the cap is 2' });
  });

  // The budget's whole point. "Not in flight" is what dispatches, so a record the tick could
  // not finish reading must not fall through to it — that would start a session on top of a
  // live one, which is the failure the ordering evidence exists to prevent, from the far side.
  it('declines a candidate whose record it could not read, rather than treating it as idle', () => {
    const [only] = decide([candidate('ENG-1', 'In Progress', { unreadable: 'the record ran on' })], 3);
    expect(only!.verdict).toEqual({ declined: 'the record ran on' });
  });

  // It may well be a live session. A spend control that errs should err toward fewer of them.
  it('counts an unreadable record against the cap', () => {
    const outcomes = decide(
      [candidate('ENG-1', 'In Progress', { unreadable: 'unproven' }), candidate('ENG-2', 'In Review', false)],
      1,
    );
    expect(outcomes[1]!.verdict).toEqual({ declined: '1 runs are in flight and the cap is 1' });
  });

  it('reports every candidate it considered, dispatched or not', () => {
    const outcomes = decide([candidate('ENG-1', 'In Progress', true), candidate('ENG-2', 'In Review', false)], 3);
    expect(outcomes.map((outcome) => outcome.identifier)).toEqual(['ENG-1', 'ENG-2']);
  });
});

describe('candidacy', () => {
  it('maps each stage status to its skill and its role', () => {
    expect(
      ['In Design', 'In Progress', 'In Review', 'In Testing', 'In Delivery'].map((status) => {
        const stage = stageFor(status)!;
        return [stage.skill, stage.role];
      }),
    ).toEqual([
      ['design-task', 'design'],
      ['implement-task', 'dev'],
      ['review-task', 'deliver'],
      ['test-task', 'deliver'],
      ['deliver-task', 'deliver'],
    ]);
  });

  it('never makes a candidate of `Todo`, `Pending`, or a status jen has never heard of', () => {
    for (const status of ['Todo', 'Pending', 'Backlog', 'Done', 'Canceled', 'Blocked on Legal']) {
      expect(stageFor(status), status).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------------------
// The command as an operator invokes it.

interface Recorded {
  body: unknown;
  status?: number;
}

interface Session {
  transport: Transport;
  requests: { query: string; variables: Record<string, unknown> }[];
}

function script(...responses: Recorded[]): Session {
  const requests: Session['requests'] = [];
  let index = 0;
  const transport: Transport = async (_input, init) => {
    requests.push(JSON.parse(String(init?.body)) as Session['requests'][number]);
    const recorded = responses[index++] ?? { body: { data: null } };
    return new Response(JSON.stringify(recorded.body), { status: recorded.status ?? 200 });
  };
  return { transport, requests };
}

interface Captured {
  code: number;
  out: string[];
  err: string[];
  requests: Session['requests'];
}

async function jenRun(
  args: string[],
  env: Record<string, string | undefined>,
  session: Session = script(),
): Promise<Captured> {
  const out: string[] = [];
  const err: string[] = [];
  const io: Io = { out: (line) => out.push(line), err: (line) => err.push(line) };
  const code = await run(['run', ...args], io, { env, transport: session.transport });
  return { code, out, err, requests: session.requests };
}

const TEAM = {
  data: {
    teams: {
      nodes: [
        {
          id: 'team-1',
          key: 'ENG',
          name: 'eng',
          states: {
            pageInfo: { hasNextPage: false },
            nodes: [
              { name: 'backlog' },
              { name: 'todo' },
              { name: 'in design' },
              { name: 'in progress' },
              { name: 'in review' },
              { name: 'in testing' },
              { name: 'in delivery' },
              { name: 'Pending' },
              { name: 'done' },
            ],
          },
        },
      ],
    },
  },
};

function polled(...nodes: unknown[]) {
  return { data: { issues: { pageInfo: { hasNextPage: false }, nodes } } };
}

/** A poll the issue page bound cut short, which is a thing the report has to say out loud. */
function truncated(...nodes: unknown[]) {
  return { data: { issues: { pageInfo: { hasNextPage: true }, nodes } } };
}

function issueNode(
  identifier: string,
  state: string,
  comments: ReturnType<typeof comment>[] = [],
  labels: string[] = ['task'],
  moreLabels = false,
) {
  return {
    id: `id-${identifier}`,
    identifier,
    branchName: `${identifier.toLowerCase()}-a-task`,
    state: { name: state },
    labels: { pageInfo: { hasNextPage: moreLabels }, nodes: labels.map((name) => ({ name })) },
    comments: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: comments },
  };
}

/** An issue whose nested comment page is bounded, in the order the tracker sent it. */
function withCommentPage(node: ReturnType<typeof issueNode>, nodes: ReturnType<typeof comment>[]) {
  return { ...node, comments: { pageInfo: { hasNextPage: true, endCursor: 'cursor-1' }, nodes } };
}

/** One further page of a single issue's comments, as the follow-up read returns it. */
function commentPage(nodes: ReturnType<typeof comment>[], hasNextPage = false, endCursor: string | null = null) {
  return { body: { data: { issue: { comments: { pageInfo: { hasNextPage, endCursor }, nodes } } } } };
}

const ENV = { LINEAR_API_KEY: 'lin_api_recorded', JEN_TEAM: 'eng', JEN_PROJECT: 'jen' };

describe('the tick refuses before it polls', () => {
  it('names the missing credential', async () => {
    const session = script();
    const result = await jenRun([], { JEN_TEAM: 'eng', JEN_PROJECT: 'jen' }, session);
    expect(result.code).toBe(1);
    expect(result.err.join('\n')).toContain('LINEAR_API_KEY is not set');
    expect(session.requests, 'nothing may be polled before the refusal').toEqual([]);
  });

  it('names the missing project identity rather than discovering it', async () => {
    const withoutTeam = await jenRun([], { LINEAR_API_KEY: 'x', JEN_PROJECT: 'jen' });
    expect(withoutTeam.code).toBe(1);
    expect(withoutTeam.err.join('\n')).toContain('no tracker team was given');

    const withoutProject = await jenRun([], { LINEAR_API_KEY: 'x', JEN_TEAM: 'eng' });
    expect(withoutProject.code).toBe(1);
    expect(withoutProject.err.join('\n')).toContain('no tracker project was given');
  });

  it('refuses a team carrying no `Pending`, and dispatches nothing', async () => {
    const withoutPending = structuredClone(TEAM);
    withoutPending.data.teams.nodes[0]!.states.nodes = [{ name: 'in progress' }, { name: 'done' }];

    const session = script({ body: withoutPending }, { body: polled(issueNode('ENG-1', 'in progress')) });
    const result = await jenRun([], ENV, session);

    expect(result.code).toBe(1);
    expect(result.err.join('\n')).toContain('carries no `Pending` status');
    expect(result.out, 'nothing may be dispatched').toEqual([]);
    expect(session.requests, 'the refusal comes before the poll').toHaveLength(1);
  });

  it('surfaces a tracker failure as a failure, never as a quiet pipeline', async () => {
    const session = script({ body: { errors: [{ message: 'Authentication required' }] }, status: 401 });
    const result = await jenRun([], ENV, session);
    expect(result.code).toBe(1);
    expect(result.out).toEqual([]);
    expect(result.err.join('\n')).toContain('answered 401');
  });
});

describe('a tick that runs', () => {
  it('emits one JSON run request per dispatch on stdout, carrying no credential', async () => {
    const session = script(
      { body: TEAM },
      { body: polled(issueNode('ENG-1', 'in progress'), issueNode('ENG-2', 'in review')) },
    );
    const result = await jenRun([], ENV, session);

    expect(result.code, result.err.join('\n')).toBe(0);
    expect(result.out.map((line) => JSON.parse(line))).toEqual([
      { task: 'ENG-1', skill: 'implement-task', role: 'dev', branch: 'eng-1-a-task' },
      { task: 'ENG-2', skill: 'review-task', role: 'deliver', branch: 'eng-2-a-task' },
    ]);
    expect(result.out.join('\n')).not.toContain('lin_api_recorded');
    expect(result.err.join('\n')).not.toContain('lin_api_recorded');
  });

  it('asks the tracker only for statuses that map to a stage', async () => {
    const session = script({ body: TEAM }, { body: polled() });
    await jenRun([], ENV, session);

    const states = session.requests[1]!.variables.states as string[];
    expect(states).toEqual(['in design', 'in progress', 'in review', 'in testing', 'in delivery']);
    for (const excluded of ['todo', 'Pending', 'backlog', 'done']) expect(states).not.toContain(excluded);
  });

  it('declines a task a session is working, and says so in the report', async () => {
    const session = script(
      { body: TEAM },
      { body: polled(issueNode('ENG-1', 'in progress', newestFirst(announcement('implement-task', 'start')))) },
    );
    const result = await jenRun([], ENV, session);

    expect(result.code).toBe(0);
    expect(result.out, 'a task in flight is not dispatched').toEqual([]);
    expect(result.err.join('\n')).toContain('a session has announced itself and not yet reported');
  });

  it('honours the concurrency cap', async () => {
    const session = script(
      { body: TEAM },
      {
        body: polled(
          issueNode('ENG-1', 'in design'),
          issueNode('ENG-2', 'in progress'),
          issueNode('ENG-3', 'in review'),
        ),
      },
    );
    const result = await jenRun(['--concurrency', '1'], ENV, session);

    expect(result.out).toHaveLength(1);
    expect(result.err.join('\n')).toContain('the cap is 1');
  });

  it('reports a tick with nothing to do, and exits successfully', async () => {
    const session = script({ body: TEAM }, { body: polled() });
    const result = await jenRun([], ENV, session);

    expect(result.code).toBe(0);
    expect(result.out).toEqual([]);
    expect(result.err.join('\n')).toContain('no task is sitting in a stage status');
  });

  // Two ticks over identical state reach identical conclusions, which is what lets two
  // runners share one ceiling without knowing about each other.
  it('reaches the same conclusion twice over unchanged state', async () => {
    const state = [{ body: TEAM }, { body: polled(issueNode('ENG-1', 'in progress')) }] as const;
    const first = await jenRun([], ENV, script(...state));
    const second = await jenRun([], ENV, script(...state));
    expect(second.out).toEqual(first.out);
  });
});

// The design deliberately stopped assuming the tracker returns comments newest-first, so
// what stands in for that assumption is here: the tick reads the direction off each page and
// pages where it cannot be shown to hold the newest.
describe('establishing the most recent announcement from a bounded page', () => {
  it('treats a page with nothing behind it as the whole record, and reads no further', async () => {
    const session = script(
      { body: TEAM },
      { body: polled(issueNode('ENG-1', 'in progress', [announcement('implement-task', 'start')])) },
    );
    const result = await jenRun([], ENV, session);

    expect(session.requests, 'one comment, nothing behind it — there is nothing to page for').toHaveLength(2);
    expect(result.out).toEqual([]);
  });

  // Newest-first and markerless: every further page is strictly older, so the first marker
  // found walking backward is still the most recent one and the walk stops there.
  it('pages backward from a newest-first page that held no marker, stopping at the first', async () => {
    const started = announcement('implement-task', 'start');
    const discussion = [comment('a question'), comment('an answer'), comment('a follow-up')];

    const session = script(
      { body: TEAM },
      { body: polled(withCommentPage(issueNode('ENG-1', 'in progress'), newestFirst(...discussion))) },
      commentPage([started], true, 'cursor-2'),
      commentPage([comment('older still')]),
    );
    const result = await jenRun([], ENV, session);

    expect(session.requests, 'the walk stops at the marker rather than draining the record').toHaveLength(3);
    expect(session.requests[2]!.variables).toEqual({ issue: 'id-ENG-1', comments: 10, after: 'cursor-1' });
    expect(result.out, 'the marker found by paging still gates the task').toEqual([]);
  });

  // The failure the evidence exists for. The bounded page holds the *oldest* comments, so
  // the `start` is in it and the `end` that closed that session is behind the bound. Trusting
  // the page reads the task as in flight and never dispatches it again — no error, forever.
  it('pages forward through an oldest-first page before reading a marker out of it', async () => {
    const started = announcement('review-task', 'start');
    const note = comment('a note to a human, mid-session');
    const ended = announcement('review-task', 'end');

    const session = script(
      { body: TEAM },
      { body: polled(withCommentPage(issueNode('ENG-1', 'in review'), [started, note])) },
      commentPage([ended]),
    );
    const result = await jenRun([], ENV, session);

    expect(session.requests).toHaveLength(3);
    expect(
      result.out.map((line) => JSON.parse(line)),
      'the newest marker is the `end` behind the bound, so the task is a candidate again',
    ).toEqual([{ task: 'ENG-1', skill: 'review-task', role: 'deliver', branch: 'eng-1-a-task' }]);
  });

  it('reaches the end before deciding, rather than stopping at the first marker it passes', async () => {
    const first = comment('the first thing said');
    const started = announcement('test-task', 'start');
    const ended = announcement('test-task', 'end');
    const since = comment('a person replying afterwards');
    const latest = comment('the latest word');

    const session = script(
      { body: TEAM },
      { body: polled(withCommentPage(issueNode('ENG-1', 'in testing'), [first, started])) },
      commentPage([ended, since], true, 'cursor-2'),
      commentPage([latest]),
    );
    const result = await jenRun([], ENV, session);

    expect(session.requests, 'every remaining page is read, because each one is newer').toHaveLength(4);
    expect(result.out.map((line) => JSON.parse(line))).toEqual([
      { task: 'ENG-1', skill: 'test-task', role: 'deliver', branch: 'eng-1-a-task' },
    ]);
  });
});

// Neither walk above ends on its own in the case that matters: the backward one drains the
// whole record of a task nothing has ever announced against, and the forward one drains it by
// construction. Uncapped, an ascending connection makes every long-running task re-read its
// entire history on every tick, forever, growing with the discussion rather than settling.
describe('the ceiling on how far the fallback will read', () => {
  /** More pages than any budget will spend, so what stops the walk is the budget and not the script. */
  function endless(count: number) {
    return Array.from({ length: count }, (_, index) =>
      commentPage([comment(`page ${index} of a long discussion`)], true, `cursor-${index + 2}`),
    );
  }

  it('stops the backward walk at the budget and declines rather than reporting it idle', async () => {
    const session = script(
      { body: TEAM },
      { body: polled(withCommentPage(issueNode('ENG-1', 'in progress'), newestFirst(comment('b'), comment('a')))) },
      ...endless(COMMENT_PAGE_BUDGET + 3),
    );
    const result = await jenRun([], ENV, session);

    expect(session.requests, 'the team, the poll, and the budget — and not one page more').toHaveLength(
      2 + COMMENT_PAGE_BUDGET,
    );
    expect(result.out, 'an unread record is not evidence that nothing is working the task').toEqual([]);
    expect(result.err.join('\n')).toContain('unproven');
    expect(result.err.join('\n'), 'the operator needs the lever named').toContain('--comment-page');
  });

  // The expensive branch, and the one the mechanism exists to serve: it cannot exit early
  // without settling on a stale marker, so without a ceiling it never exits early at all.
  it('stops the forward walk at the budget too, where there is no early exit to rely on', async () => {
    const session = script(
      { body: TEAM },
      { body: polled(withCommentPage(issueNode('ENG-1', 'in review'), [comment('oldest'), comment('newer')])) },
      ...endless(COMMENT_PAGE_BUDGET + 3),
    );
    const result = await jenRun([], ENV, session);

    expect(session.requests).toHaveLength(2 + COMMENT_PAGE_BUDGET);
    expect(result.out).toEqual([]);
    expect(result.err.join('\n')).toContain('oldest-first');
  });

  // The budget is the ceiling, not the reach: `--comment-page` is what moves how far the same
  // number of requests gets, which is why there is no second flag for the budget itself.
  it('reads a record that fits inside the budget without declining it', async () => {
    const session = script(
      { body: TEAM },
      { body: polled(withCommentPage(issueNode('ENG-1', 'in progress'), newestFirst(comment('b'), comment('a')))) },
      commentPage([comment('still nothing marked')], true, 'cursor-2'),
      commentPage([announcement('implement-task', 'end')]),
    );
    const result = await jenRun([], ENV, session);

    expect(session.requests).toHaveLength(4);
    expect(result.out.map((line) => JSON.parse(line))).toEqual([
      { task: 'ENG-1', skill: 'implement-task', role: 'dev', branch: 'eng-1-a-task' },
    ]);
  });
});

// A bound with nothing said about it is the failure this change spends the most effort ruling
// out: a page that came back short is indistinguishable from a pipeline with nothing in it.
describe('a bound that cut the answer short', () => {
  it('names the issues it did not examine rather than exiting 0 over them', async () => {
    const session = script({ body: TEAM }, { body: truncated(issueNode('ENG-1', 'in progress')) });
    const result = await jenRun([], ENV, session);

    expect(result.code, 'the tick cannot act on this, and it is not an error').toBe(0);
    expect(result.out.map((line) => JSON.parse(line)), 'what it did see is still dispatched').toEqual([
      { task: 'ENG-1', skill: 'implement-task', role: 'dev', branch: 'eng-1-a-task' },
    ]);
    const report = result.err.join('\n');
    expect(report).toContain('more issues are sitting in a stage status than the page bound of 50');
    expect(report).toContain('--issue-page');
  });

  it('says nothing about a bound that did not truncate', async () => {
    const session = script({ body: TEAM }, { body: polled(issueNode('ENG-1', 'in progress')) });
    const result = await jenRun([], ENV, session);
    expect(result.err.join('\n')).not.toContain('--issue-page');
  });

  // "The team has no `Pending`" and "no `Pending` was in what the tick read" are different
  // claims, and only the first is a fact. The refusal stands either way; the message may not.
  it('refuses a team without `Pending` without asserting more than it read', async () => {
    const bounded = structuredClone(TEAM);
    bounded.data.teams.nodes[0]!.states.nodes = [{ name: 'in progress' }];
    bounded.data.teams.nodes[0]!.states.pageInfo.hasNextPage = true;

    const result = await jenRun([], ENV, script({ body: bounded }));

    expect(result.code).toBe(1);
    expect(result.err.join('\n')).toContain('may exist behind that bound');
  });

  it('does not claim a stage status is absent when the status page was cut short', async () => {
    const bounded = structuredClone(TEAM);
    bounded.data.teams.nodes[0]!.states.nodes = [{ name: 'in progress' }, { name: 'Pending' }];
    bounded.data.teams.nodes[0]!.states.pageInfo.hasNextPage = true;

    const result = await jenRun([], ENV, script({ body: bounded }, { body: polled() }));
    const report = result.err.join('\n');

    expect(result.code).toBe(0);
    expect(report).toContain('carries more than 50 statuses');
    expect(report, 'the absence is of the reading, not of the team').not.toContain('the team carries no `In Design`');
    expect(report).toContain('no `In Design` status was among the ones read');
  });

  it('declines an issue whose label page was cut short without claiming nothing refined it', async () => {
    const session = script({ body: TEAM }, { body: polled(issueNode('ENG-9', 'in design', [], ['urgent'], true)) });
    const result = await jenRun([], ENV, session);

    expect(result.out).toEqual([]);
    const report = result.err.join('\n');
    expect(report).toContain('no `task` label was among the 10 labels read');
    expect(report, 'that claim is about the issue, and a truncated page cannot support it').not.toContain(
      'nothing has refined it',
    );
  });
});

// Candidacy is the status *and* the label. The label is tested here rather than expressed in
// the poll's filter, so an issue that fails it is fetched, declined, and named — the only
// place a person learns why an issue they moved into the pipeline did nothing.
describe('an issue in a stage status that is not a task', () => {
  it('declines an epic, names it, and does not read its comments to do so', async () => {
    const session = script(
      { body: TEAM },
      { body: polled(withCommentPage(issueNode('ENG-136', 'in progress', [], ['epic']), [comment('epic chatter')])) },
    );
    const result = await jenRun([], ENV, session);

    expect(result.code).toBe(0);
    expect(result.out, 'an epic has no change and no PR — a stage against one finds nothing to do').toEqual([]);
    expect(session.requests, 'the gate runs before the comment read, so the fallback never fires').toHaveLength(2);
    expect(result.err.join('\n')).toContain('ENG-136');
    expect(result.err.join('\n')).toContain('an epic, not a task');
  });

  it('declines an issue carrying neither label, and says something different about it', async () => {
    const session = script({ body: TEAM }, { body: polled(issueNode('ENG-9', 'in design', [], [])) });
    const result = await jenRun([], ENV, session);

    expect(result.code).toBe(0);
    expect(result.out).toEqual([]);
    expect(result.err.join('\n')).toContain('ENG-9');
    expect(result.err.join('\n'), 'unrefined is a different thing from an epic, and only one is actionable').toContain(
      'it carries neither the `task` nor the `epic` label',
    );
  });

  it('accounts for the non-tasks alongside the candidates in one report', async () => {
    const session = script(
      { body: TEAM },
      {
        body: polled(
          issueNode('ENG-163', 'in progress'),
          issueNode('ENG-136', 'in progress', [], ['epic']),
          issueNode('ENG-133', 'in progress', [], ['epic']),
        ),
      },
    );
    const result = await jenRun([], ENV, session);

    expect(result.out.map((line) => JSON.parse(line)), 'only the task runs').toEqual([
      { task: 'ENG-163', skill: 'implement-task', role: 'dev', branch: 'eng-163-a-task' },
    ]);
    const report = result.err.join('\n');
    for (const identifier of ['ENG-163', 'ENG-136', 'ENG-133']) expect(report, identifier).toContain(identifier);
  });

  // A project made entirely of epics is not a pipeline with work in it, and the cap exists
  // to ration sessions rather than to ration reading.
  it('spends no concurrency on an issue it declined for not being a task', async () => {
    const session = script(
      { body: TEAM },
      {
        body: polled(
          issueNode('ENG-136', 'in progress', [], ['epic']),
          issueNode('ENG-133', 'in review', [], ['epic']),
          issueNode('ENG-163', 'in testing'),
        ),
      },
    );
    const result = await jenRun(['--concurrency', '1'], ENV, session);

    expect(result.out.map((line) => JSON.parse(line))).toEqual([
      { task: 'ENG-163', skill: 'test-task', role: 'deliver', branch: 'eng-163-a-task' },
    ]);
  });
});

describe('the tick writes nothing', () => {
  it('sends the tracker queries and never a mutation', async () => {
    const session = script({ body: TEAM }, { body: polled(issueNode('ENG-1', 'in progress')) });
    await jenRun([], ENV, session);

    expect(session.requests.length).toBeGreaterThan(0);
    for (const { query } of session.requests) {
      expect(query.trimStart(), 'every document the tick sends is a read').toMatch(/^query /);
      expect(query).not.toMatch(/\bmutation\b/);
    }
  });

  // A source check as well as a behavioural one: the property is that no mutation is
  // *reachable* from the run path, which a test exercising one path cannot establish alone.
  it('has no mutation and no file write anywhere on its path', () => {
    for (const module of ['cli/run.ts', 'cli/linear.ts', 'cli/stages.ts']) {
      const source = readFileSync(`${repoRoot}${module}`, 'utf8');
      expect(source, `${module} must send no mutation`).not.toMatch(/\bmutation\s+\w/);
      expect(source, `${module} must not reach the filesystem`).not.toMatch(/from 'node:fs'/);
      expect(source, `${module} must not write a file`).not.toMatch(/writeFileSync|mkdirSync|unlinkSync|createWriteStream/);
    }
  });
});
