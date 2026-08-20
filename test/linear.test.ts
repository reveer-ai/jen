/**
 * The tracker client against recorded responses.
 *
 * No network, and none of these exercise the real schema — task 5.5 is what does that,
 * because no credential exists in this repository. What they hold is the client's own
 * behaviour: what it maps, what it orders, and above all what it refuses to swallow.
 */
import { describe, expect, it } from 'vitest';

import { RateLimited, Tracker, TrackerError, type Transport } from '../cli/linear.js';

interface Recorded {
  body?: unknown;
  status?: number;
  headers?: Record<string, string>;
  /** Sent instead of a response, for the transport failing outright. */
  throws?: Error;
}

interface Scripted {
  transport: Transport;
  /** Every request the client made, as the document and variables it sent. */
  sent: { query: string; variables: Record<string, unknown> }[];
}

function script(...responses: Recorded[]): Scripted {
  const sent: Scripted['sent'] = [];
  let index = 0;

  const transport: Transport = async (_input, init) => {
    sent.push(JSON.parse(String(init?.body)) as Scripted['sent'][number]);
    const recorded = responses[index++];
    if (!recorded) throw new Error(`the client made ${sent.length} requests and only ${responses.length} were recorded`);
    if (recorded.throws) throw recorded.throws;
    return new Response(JSON.stringify(recorded.body), {
      status: recorded.status ?? 200,
      headers: recorded.headers,
    });
  };

  return { transport, sent };
}

function tracker(scripted: Scripted): Tracker {
  return new Tracker({ token: 'lin_api_recorded', transport: scripted.transport });
}

function teamNodes(moreStatuses = false) {
  return {
    teams: {
      nodes: [
        {
          id: 'team-1',
          key: 'ENG',
          name: 'eng',
          states: {
            pageInfo: { hasNextPage: moreStatuses },
            nodes: [{ name: 'todo' }, { name: 'in progress' }, { name: 'Pending' }],
          },
        },
      ],
    },
  };
}

const team = teamNodes();

function issue(
  overrides: Partial<{
    identifier: string;
    state: string;
    labels: string[];
    moreLabels: boolean;
    comments: { id: string; createdAt: string; body: string }[];
    hasNextPage: boolean;
  }> = {},
) {
  return {
    id: 'issue-1',
    identifier: overrides.identifier ?? 'ENG-1',
    branchName: 'eng-1-a-task',
    state: { name: overrides.state ?? 'in progress' },
    labels: {
      pageInfo: { hasNextPage: overrides.moreLabels ?? false },
      nodes: (overrides.labels ?? ['task']).map((name) => ({ name })),
    },
    comments: {
      pageInfo: { hasNextPage: overrides.hasNextPage ?? false, endCursor: 'cursor-1' },
      nodes: overrides.comments ?? [],
    },
  };
}

/** Comments a page apart, so a page's ends can be compared. */
function dated(day: number, body: string) {
  return { id: `c${day}`, createdAt: `2026-08-${String(day).padStart(2, '0')}T00:00:00.000Z`, body };
}

describe('reading the team', () => {
  it('answers its id and every status it carries', async () => {
    const scripted = script({ body: { data: team } });
    expect(await tracker(scripted).team('eng')).toEqual({
      id: 'team-1',
      statuses: ['todo', 'in progress', 'Pending'],
      moreStatuses: false,
    });
    expect(scripted.sent[0]!.variables).toEqual({ team: 'eng', states: 50 });
  });

  // The difference between "the team has no `Pending`" and "no `Pending` was in what we
  // read". Only the first is a fact, and a team past the bound would otherwise be refused
  // with a message asserting something the read cannot support.
  it('says when the status page was cut short rather than presenting it as the whole team', async () => {
    const scripted = script({ body: { data: teamNodes(true) } });
    expect((await tracker(scripted).team('eng')).moreStatuses).toBe(true);
  });

  it('fails rather than guessing when the name matches no team', async () => {
    const scripted = script({ body: { data: { teams: { nodes: [] } } } });
    await expect(tracker(scripted).team('nope')).rejects.toThrow(/no team named or keyed `nope`/);
  });

  it('fails rather than picking one when the name matches two', async () => {
    const nodes = [team.teams.nodes[0]!, { ...team.teams.nodes[0]!, id: 'team-2', key: 'ENG2' }];
    const scripted = script({ body: { data: { teams: { nodes } } } });
    await expect(tracker(scripted).team('eng')).rejects.toThrow(/matches more than one team/);
  });
});

describe('polling the project', () => {
  it('maps each issue and bounds both page sizes explicitly', async () => {
    const scripted = script({ body: { data: { issues: { pageInfo: { hasNextPage: false }, nodes: [issue()] } } } });
    const issues = (await tracker(scripted).issues('team-1', 'jen', ['in progress'], 50, 10)).issues;

    expect(issues).toEqual([
      {
        id: 'issue-1',
        identifier: 'ENG-1',
        branchName: 'eng-1-a-task',
        status: 'in progress',
        labels: ['task'],
        moreLabels: false,
        comments: [],
        commentsAreNewest: true,
        moreComments: false,
        commentCursor: 'cursor-1',
      },
    ]);
    expect(scripted.sent[0]!.variables).toEqual({
      team: 'team-1',
      project: 'jen',
      states: ['in progress'],
      issues: 50,
      comments: 10,
      labels: 10,
    });
  });

  // The in-flight test reads the most recent marked comment and nothing else, so ordering
  // is the whole contract. Sorted here rather than trusted from the connection: a page that
  // came back oldest-first would silently hide every recent marker behind the bound.
  it('orders comments newest first whatever order they arrive in', async () => {
    const comments = [
      { id: 'c1', createdAt: '2026-08-01T00:00:00.000Z', body: 'oldest' },
      { id: 'c3', createdAt: '2026-08-03T00:00:00.000Z', body: 'newest' },
      { id: 'c2', createdAt: '2026-08-02T00:00:00.000Z', body: 'middle' },
    ];
    const scripted = script({ body: { data: { issues: { pageInfo: { hasNextPage: false }, nodes: [issue({ comments })] } } } });
    const [only] = (await tracker(scripted).issues('team-1', 'jen', ['in progress'], 50, 10)).issues;
    expect(only!.comments.map((comment) => comment.body)).toEqual(['newest', 'middle', 'oldest']);
  });

  it('carries every label the issue holds, since candidacy rests on one of them', async () => {
    const scripted = script({ body: { data: { issues: { pageInfo: { hasNextPage: false }, nodes: [issue({ labels: ['epic', 'urgent'] })] } } } });
    const [only] = (await tracker(scripted).issues('team-1', 'jen', ['in progress'], 50, 10)).issues;
    expect(only!.labels).toEqual(['epic', 'urgent']);
  });

  // A bounded page with no flag cannot tell forty issues in stage statuses from four hundred,
  // and the overflow would be neither dispatched, nor declined, nor named anywhere. Nothing
  // errors and the tick exits 0 — which is the one failure shape indistinguishable from a
  // healthy quiet pipeline.
  it('says when the project holds more issues in these statuses than the page read', async () => {
    const scripted = script({ body: { data: { issues: { pageInfo: { hasNextPage: true }, nodes: [issue()] } } } });
    const page = await tracker(scripted).issues('team-1', 'jen', ['in progress'], 50, 10);

    expect(page.issues).toHaveLength(1);
    expect(page.moreIssues, 'the caller has to be able to say the answer was cut short').toBe(true);
  });

  it('says when an issue carries more labels than the bound read', async () => {
    const scripted = script({
      body: { data: { issues: { pageInfo: { hasNextPage: false }, nodes: [issue({ labels: ['urgent'], moreLabels: true })] } } },
    });
    const [only] = (await tracker(scripted).issues('team-1', 'jen', ['in progress'], 50, 10)).issues;

    expect(only!.labels).toEqual(['urgent']);
    expect(only!.moreLabels, '`task` may be behind the bound, so nothing may claim it is absent').toBe(true);
  });

  it('asks nothing when no status resolved on the team', async () => {
    const scripted = script();
    expect(await tracker(scripted).issues('team-1', 'jen', [], 50, 10)).toEqual({ issues: [], moreIssues: false });
    expect(scripted.sent).toEqual([]);
  });

  it('pages one issue\'s comments where the nested page held no marker', async () => {
    const scripted = script({
      body: {
        data: {
          issue: {
            comments: {
              pageInfo: { hasNextPage: true, endCursor: 'cursor-2' },
              nodes: [{ id: 'c9', createdAt: '2026-08-09T00:00:00.000Z', body: 'older still' }],
            },
          },
        },
      },
    });

    expect(await tracker(scripted).comments('issue-1', 10, 'cursor-1')).toEqual({
      comments: [{ id: 'c9', createdAt: '2026-08-09T00:00:00.000Z', body: 'older still' }],
      hasNextPage: true,
      endCursor: 'cursor-2',
    });
    expect(scripted.sent[0]!.variables).toEqual({ issue: 'issue-1', comments: 10, after: 'cursor-1' });
  });
});

// A sort orders what came back and says nothing about what stayed behind the bound, so the
// page is made to carry its own evidence rather than the documented descending default being
// taken on trust. Being wrong is not a degraded answer: every marker sits behind the bound,
// the task reads as never announced, and it is dispatched forever with no error anywhere.
describe('whether a comment page can be shown to hold the newest', () => {
  async function polled(nodes: { id: string; createdAt: string; body: string }[], hasNextPage: boolean) {
    const scripted = script({
      body: {
        data: {
          issues: {
            pageInfo: { hasNextPage: false },
            nodes: [
              {
                ...issue(),
                comments: { pageInfo: { hasNextPage, endCursor: 'cursor-1' }, nodes },
              },
            ],
          },
        },
      },
    });
    const [only] = (await tracker(scripted).issues('team-1', 'jen', ['in progress'], 50, 10)).issues;
    return only!;
  }

  it('takes a descending page with more behind it as the newest', async () => {
    const page = await polled([dated(9, 'newest'), dated(5, 'middle'), dated(1, 'oldest')], true);
    expect(page.commentsAreNewest).toBe(true);
    expect(page.moreComments).toBe(true);
  });

  it('refuses an ascending page as the newest, however it sorts afterwards', async () => {
    const page = await polled([dated(1, 'oldest'), dated(5, 'middle'), dated(9, 'newest')], true);
    expect(page.commentsAreNewest, 'oldest-first means every recent comment is behind the bound').toBe(false);
    expect(page.comments.map((comment) => comment.body), 'still handed over newest first').toEqual([
      'newest',
      'middle',
      'oldest',
    ]);
  });

  it('takes a page with nothing behind it as the whole record, in either order', async () => {
    expect((await polled([dated(1, 'oldest'), dated(9, 'newest')], false)).commentsAreNewest).toBe(true);
    expect((await polled([dated(9, 'newest'), dated(1, 'oldest')], false)).commentsAreNewest).toBe(true);
    expect((await polled([dated(3, 'the only one')], false)).commentsAreNewest, 'one comment is the record').toBe(true);
    expect((await polled([], false)).commentsAreNewest, 'no comments at all is the record too').toBe(true);
  });

  // One comment with more behind it is trivially both orders, and two sharing a timestamp
  // are no better. Unreadable is treated as unproven rather than resolved in either
  // direction — the cost is a request, and the cost of guessing wrong is permanent.
  it('treats an unreadable page as unproven rather than guessing', async () => {
    expect((await polled([dated(3, 'the only one')], true)).commentsAreNewest).toBe(false);
    expect((await polled([dated(3, 'a'), dated(3, 'b')], true)).commentsAreNewest).toBe(false);
  });
});

describe('what the client refuses to swallow', () => {
  // The one that matters most. Everything downstream reads an empty candidate set as a
  // quiet pipeline, so a query error returned as zero issues would look like a healthy
  // tick for exactly as long as nobody went looking.
  it('raises a query error rather than answering with no candidates', async () => {
    const scripted = script({
      body: { errors: [{ message: "Cannot query field 'branchName' on type 'Issue'." }] },
    });
    const call = tracker(scripted).issues('team-1', 'jen', ['in progress'], 50, 10);
    await expect(call).rejects.toBeInstanceOf(TrackerError);
    await expect(call).rejects.toThrow(/Cannot query field 'branchName'/);
  });

  it('raises a partial response with no data rather than treating it as empty', async () => {
    const scripted = script({ body: { data: null } });
    await expect(tracker(scripted).issues('team-1', 'jen', ['in progress'], 50, 10)).rejects.toThrow(/no data/);
  });

  // Linear sends this as HTTP 400 with the code in the body, not as a 429, so a status
  // check alone reports it as an unexplained bad request.
  it('names a rate limit as a rate limit, arriving as a 400', async () => {
    const scripted = script({
      status: 400,
      body: { errors: [{ message: 'Rate limit exceeded', extensions: { code: 'RATELIMITED' } }] },
    });
    const call = tracker(scripted).team('eng');
    await expect(call).rejects.toBeInstanceOf(RateLimited);
    await expect(call).rejects.toThrow(/rate-limited/);
  });

  it('reports any other refusal with its status and body', async () => {
    const scripted = script({ status: 401, body: { errors: [{ message: 'Authentication required' }] } });
    const call = tracker(scripted).team('eng');
    await expect(call).rejects.toBeInstanceOf(TrackerError);
    await expect(call).rejects.not.toBeInstanceOf(RateLimited);
    await expect(call).rejects.toThrow(/answered 401/);
  });

  it('reports a transport that never reached the tracker', async () => {
    const scripted = script({ throws: new Error('getaddrinfo ENOTFOUND api.linear.app') });
    await expect(tracker(scripted).team('eng')).rejects.toThrow(/could not reach the tracker: getaddrinfo/);
  });

  it('makes exactly one request per read, with no retry behind it', async () => {
    const scripted = script({ status: 500, body: {} });
    await expect(tracker(scripted).team('eng')).rejects.toThrow();
    expect(scripted.sent).toHaveLength(1);
  });
});

describe('the budget', () => {
  it('carries what the tracker charged and what is left, for the report', async () => {
    const scripted = script({
      body: { data: team },
      headers: {
        'x-complexity': '1043',
        'x-ratelimit-complexity-remaining': '1998957',
        'x-ratelimit-requests-remaining': '4998',
      },
    });
    const client = tracker(scripted);
    await client.team('eng');
    expect(client.budget).toEqual({
      complexityCharged: 1043,
      complexityRemaining: 1998957,
      requestsRemaining: 4998,
    });
  });

  it('reports nothing where the tracker sent no headers', async () => {
    const scripted = script({ body: { data: team } });
    const client = tracker(scripted);
    await client.team('eng');
    expect(client.budget).toEqual({
      complexityCharged: undefined,
      complexityRemaining: undefined,
      requestsRemaining: undefined,
    });
  });
});
