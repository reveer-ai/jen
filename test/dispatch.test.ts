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
import { decide, inFlight, type Examined } from '../cli/run.js';
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

function candidate(identifier: string, status: string, running: boolean): Examined {
  return {
    identifier,
    status,
    branch: `${identifier.toLowerCase()}-a-task`,
    stage: stageFor(status)!,
    inFlight: running,
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
  return { data: { issues: { nodes } } };
}

function issueNode(identifier: string, state: string, comments: ReturnType<typeof comment>[] = []) {
  return {
    id: `id-${identifier}`,
    identifier,
    branchName: `${identifier.toLowerCase()}-a-task`,
    state: { name: state },
    comments: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: comments },
  };
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

  it('pages one issue\'s comments only where the nested page held no marker', async () => {
    const buried = {
      ...issueNode('ENG-1', 'in progress', [comment('a long human discussion')]),
      comments: {
        pageInfo: { hasNextPage: true, endCursor: 'cursor-1' },
        nodes: [comment('a long human discussion')],
      },
    };

    const session = script(
      { body: TEAM },
      { body: polled(buried) },
      {
        body: {
          data: {
            issue: {
              comments: {
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: [announcement('implement-task', 'start')],
              },
            },
          },
        },
      },
    );
    const result = await jenRun([], ENV, session);

    expect(session.requests, 'the fallback is one extra request, for the one issue').toHaveLength(3);
    expect(session.requests[2]!.variables).toEqual({ issue: 'id-ENG-1', comments: 10, after: 'cursor-1' });
    expect(result.out, 'the marker found by paging still gates the task').toEqual([]);
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
