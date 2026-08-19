/**
 * The tracker client: three read queries against Linear's GraphQL API, over global
 * `fetch`, with no writes and no dependency.
 *
 * `@linear/sdk` earns its weight where an application makes many varied calls. The tick
 * makes three, forever, against a package whose entire runtime dependency list is one
 * entry and whose tarball is asserted by test. Node 20.19 is already the engine floor and
 * has `fetch`, so three hand-written documents is less code than the SDK's wiring and
 * keeps the install cost of `jen run` at zero for adopters who never use it.
 *
 * Every document requests named fields rather than a fragment or a wildcard. Schema drift
 * is then ours to notice at the tick, loudly, instead of arriving as an empty candidate
 * set — which is indistinguishable from a healthy quiet pipeline and would go unnoticed
 * for exactly as long as nobody looked.
 */

/** Where the tracker's API lives. Overridable only so tests can point at a recorded transport. */
export const LINEAR_ENDPOINT = 'https://api.linear.app/graphql';

/** The environment variable the tracker credential is read from, at the point of use. */
export const TOKEN_VARIABLE = 'LINEAR_API_KEY';

/** Anything the tracker refused or answered unusably. Never swallowed into an empty result. */
export class TrackerError extends Error {}

/**
 * The tracker's rate limiter, which arrives as HTTP 400 with a `RATELIMITED` code in the
 * body rather than as a 429. A generic status check reports it as an unexplained bad
 * request, so it is recognised by name and carries its own message.
 */
export class RateLimited extends TrackerError {}

/** What the response headers say the tick has left. Absent where the tracker sent no header. */
export interface Budget {
  requestsRemaining?: number;
  complexityRemaining?: number;
  /** What the tracker charged for the query just made, where it says so. */
  complexityCharged?: number;
}

export interface TrackerComment {
  id: string;
  /** ISO-8601, as the tracker supplies it. Ordering is by this and nothing else. */
  createdAt: string;
  body: string;
}

export interface TrackerIssue {
  id: string;
  identifier: string;
  /** The tracker's own suggested branch name — the one value that crosses to the git host. */
  branchName: string;
  /** The status name as the team writes it, which need not match the workflow's capitalization. */
  status: string;
  /** Newest first. Bounded by the page size the poll was given. */
  comments: TrackerComment[];
  /** Whether the tracker holds comments older than the ones above. */
  moreComments: boolean;
  /** Where a follow-up read of this issue's comments resumes, when {@link moreComments}. */
  commentCursor: string | null;
}

export interface TrackerTeam {
  id: string;
  /** Every status the team carries, as the team names them. */
  statuses: string[];
}

export interface CommentPage {
  comments: TrackerComment[];
  hasNextPage: boolean;
  endCursor: string | null;
}

/** The transport, injectable so the client can be exercised against recorded responses. */
export type Transport = typeof fetch;

export interface TrackerOptions {
  token: string;
  endpoint?: string;
  transport?: Transport;
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: { message?: string; extensions?: { code?: string; type?: string } }[];
}

const HEADERS = {
  requestsRemaining: 'x-ratelimit-requests-remaining',
  complexityRemaining: 'x-ratelimit-complexity-remaining',
  complexityCharged: 'x-complexity',
} as const;

const TEAM_STATUSES = `
query JenTeamStatuses($team: String!, $states: Int!) {
  teams(first: 2, filter: { or: [{ key: { eqIgnoreCase: $team } }, { name: { eqIgnoreCase: $team } }] }) {
    nodes { id key name states(first: $states) { nodes { id name } } }
  }
}`;

const PIPELINE_ISSUES = `
query JenPipelineIssues($team: ID!, $project: String!, $states: [String!]!, $issues: Int!, $comments: Int!) {
  issues(
    first: $issues
    filter: {
      team: { id: { eq: $team } }
      project: { name: { eqIgnoreCase: $project } }
      state: { name: { in: $states } }
    }
  ) {
    nodes {
      id
      identifier
      branchName
      state { name }
      comments(first: $comments, orderBy: createdAt) {
        pageInfo { hasNextPage endCursor }
        nodes { id createdAt body }
      }
    }
  }
}`;

const ISSUE_COMMENTS = `
query JenIssueComments($issue: String!, $comments: Int!, $after: String) {
  issue(id: $issue) {
    comments(first: $comments, after: $after, orderBy: createdAt) {
      pageInfo { hasNextPage endCursor }
      nodes { id createdAt body }
    }
  }
}`;

function header(headers: Headers, name: string): number | undefined {
  const raw = headers.get(name);
  if (raw === null) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

/** Newest first, which is the only order the in-flight test ever reads. */
function newestFirst(comments: TrackerComment[]): TrackerComment[] {
  return [...comments].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

interface CommentConnection {
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
  nodes: TrackerComment[];
}

export class Tracker {
  readonly #token: string;
  readonly #endpoint: string;
  readonly #transport: Transport;

  /** What the most recent response said about the budget. Reported, never acted on. */
  budget: Budget = {};

  constructor(options: TrackerOptions) {
    this.#token = options.token;
    this.#endpoint = options.endpoint ?? LINEAR_ENDPOINT;
    this.#transport = options.transport ?? fetch;
  }

  /**
   * One request. No retry and no backoff: the pipeline's answer to a failed tick is the
   * next tick, and a tick that retries inside itself makes a deterministic failure cost
   * three requests instead of one while hiding it from the report either way.
   */
  async #query<T>(document: string, variables: Record<string, unknown>): Promise<T> {
    let response: Response;
    try {
      response = await this.#transport(this.#endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: this.#token },
        body: JSON.stringify({ query: document, variables }),
      });
    } catch (error) {
      throw new TrackerError(`could not reach the tracker: ${error instanceof Error ? error.message : String(error)}`);
    }

    this.budget = {
      requestsRemaining: header(response.headers, HEADERS.requestsRemaining),
      complexityRemaining: header(response.headers, HEADERS.complexityRemaining),
      complexityCharged: header(response.headers, HEADERS.complexityCharged),
    };

    const text = await response.text();
    let payload: GraphQLResponse<T> | undefined;
    try {
      payload = JSON.parse(text) as GraphQLResponse<T>;
    } catch {
      payload = undefined;
    }

    const codes = (payload?.errors ?? []).map((error) => error.extensions?.code ?? error.extensions?.type ?? '');
    if (codes.includes('RATELIMITED')) {
      throw new RateLimited(
        'the tracker rate-limited this query. Linear reports this as HTTP 400 with a RATELIMITED code rather ' +
          'than as a 429, and either the hourly budget or the 10,000-point single-query cap can produce it.',
      );
    }

    if (!response.ok) {
      throw new TrackerError(`the tracker answered ${response.status}: ${text.slice(0, 500)}`);
    }

    // A query error must never read as "no work". Everything downstream treats an empty
    // candidate set as a quiet pipeline, so this is the one failure that has to be loud.
    if (payload?.errors?.length) {
      const messages = payload.errors.map((error) => error.message ?? 'unspecified error').join('; ');
      throw new TrackerError(`the tracker rejected the query: ${messages}`);
    }

    if (!payload?.data) {
      throw new TrackerError(`the tracker answered with no data: ${text.slice(0, 500)}`);
    }

    return payload.data;
  }

  /**
   * The team's identity and every status it carries.
   *
   * The tick needs both: the statuses to check that `Pending` exists and to resolve the
   * workflow's status names onto the team's own, and the id to filter the poll by team
   * exactly rather than by a name that two teams could share.
   */
  async team(team: string, statePageSize = 50): Promise<TrackerTeam> {
    const data = await this.#query<{
      teams: { nodes: { id: string; key: string; name: string; states: { nodes: { name: string }[] } }[] };
    }>(TEAM_STATUSES, { team, states: statePageSize });

    const found = data.teams.nodes;
    if (found.length === 0) throw new TrackerError(`the tracker has no team named or keyed \`${team}\``);
    if (found.length > 1) {
      throw new TrackerError(
        `\`${team}\` matches more than one team (${found.map((node) => `${node.key} ${node.name}`).join(', ')})`,
      );
    }

    const only = found[0]!;
    return { id: only.id, statuses: only.states.nodes.map((state) => state.name) };
  }

  /**
   * Every issue in the project sitting in one of the given statuses, with its most recent
   * comments nested in the same query.
   *
   * One request whatever the pipeline's width, which is what keeps a poll that runs
   * unattended forever from scaling its cost with the number of tasks in flight. Both page
   * sizes are the caller's and are bounded explicitly — the API's default of 50 applied at
   * two levels is what would approach the single-query complexity cap.
   */
  async issues(
    teamId: string,
    project: string,
    statuses: string[],
    issuePageSize: number,
    commentPageSize: number,
  ): Promise<TrackerIssue[]> {
    if (statuses.length === 0) return [];

    const data = await this.#query<{
      issues: {
        nodes: {
          id: string;
          identifier: string;
          branchName: string;
          state: { name: string };
          comments: CommentConnection;
        }[];
      };
    }>(PIPELINE_ISSUES, {
      team: teamId,
      project,
      states: statuses,
      issues: issuePageSize,
      comments: commentPageSize,
    });

    return data.issues.nodes.map((node) => ({
      id: node.id,
      identifier: node.identifier,
      branchName: node.branchName,
      status: node.state.name,
      comments: newestFirst(node.comments.nodes),
      moreComments: node.comments.pageInfo.hasNextPage,
      commentCursor: node.comments.pageInfo.endCursor,
    }));
  }

  /**
   * One further page of a single issue's comments.
   *
   * The fallback for a task carrying more recent comments than the nested page holds — a
   * long human discussion since its last session. Per-issue and rare, which is what buys
   * the common case being one request.
   */
  async comments(issueId: string, pageSize: number, after: string | null): Promise<CommentPage> {
    const data = await this.#query<{ issue: { comments: CommentConnection } | null }>(ISSUE_COMMENTS, {
      issue: issueId,
      comments: pageSize,
      after,
    });

    if (!data.issue) throw new TrackerError(`the tracker no longer has an issue with id ${issueId}`);

    return {
      comments: newestFirst(data.issue.comments.nodes),
      hasNextPage: data.issue.comments.pageInfo.hasNextPage,
      endCursor: data.issue.comments.pageInfo.endCursor,
    };
  }
}
