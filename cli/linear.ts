/**
 * The tracker client: four read queries against Linear's GraphQL API, over global `fetch`,
 * with no writes and no dependency.
 *
 * `@linear/sdk` earns its weight where an application makes many varied calls. The tick
 * makes four, forever, against a package whose entire runtime dependency list is small
 * and whose tarball is asserted by test. Node 20.19 is already the engine floor and
 * has `fetch`, so four hand-written documents is less code than the SDK's wiring and
 * keeps the install cost of `jen run` at zero for adopters who never use it.
 *
 * Every document requests named fields rather than a fragment or a wildcard. Schema drift
 * is then ours to notice at the tick, loudly, instead of arriving as an empty candidate
 * set — which is indistinguishable from a healthy quiet pipeline and would go unnoticed
 * for exactly as long as nobody looked.
 *
 * Every connection here is bounded, and **every bounded connection asks for
 * `pageInfo { hasNextPage }` alongside its nodes.** A bound with no such flag cannot tell a
 * short answer from a truncated one, which is the same failure one level down: the caller
 * reads fewer issues, fewer statuses, or fewer labels than exist and has no way to know it.
 * Five connections are bounded — statuses, projects, issues, labels, comments — and all
 * five carry the flag. Anything added here carries it too, and the caller does something
 * with it.
 */

/** Where the tracker's API lives. Overridable only so tests can point at a recorded transport. */
export const LINEAR_ENDPOINT = 'https://api.linear.app/graphql';

/** The environment variable the tracker credential is read from, at the point of use. */
export const TOKEN_VARIABLE = 'LINEAR_API_KEY';

/**
 * How many of an issue's labels the poll asks for.
 *
 * Bounded like every other page here, and not a caller's choice because nothing has reason
 * to tune it: the tick reads labels to answer one yes-or-no question. Ten is well past what
 * a refined task carries, and the cost is paid per issue on every tick.
 *
 * An issue carrying more labels than this could hide its `task` label behind the bound. The
 * bound stands, and what changes is that the truncation is reported: {@link
 * TrackerIssue.moreLabels} carries it, so the decline names the bound instead of asserting
 * that nothing has refined the issue — which would be a claim the read cannot support.
 */
export const LABEL_PAGE_SIZE = 10;

/**
 * How many of a team's workflow statuses the startup check asks for.
 *
 * A team with more statuses than this is not a failure — the read reports the truncation and
 * the tick says so rather than asserting that a status it never saw does not exist.
 */
export const STATE_PAGE_SIZE = 50;

/**
 * How many projects matching the given name the tick asks for.
 *
 * Two, which is the smallest number that can tell one from several. The tick acts on one
 * project; what it needs to know is whether the name it was given picks out exactly that.
 */
export const PROJECT_PAGE_SIZE = 2;

/**
 * The project status types that halt dispatch, read as the tracker's own categories.
 *
 * Named individually rather than expressed as "anything but started". A project sitting in
 * a backlog or planning status while its tasks move is ordinary — jen's own does — and an
 * allow list would have stopped a working pipeline silently.
 *
 * These two are the ordinary *end* of a project rather than a way to pause one, which is
 * why pausing is {@link PAUSED_STATUS_NAME} instead of a third entry here. There is no
 * `paused` category to add: the tracker has exactly five — `backlog`, `planned`, `started`,
 * `completed`, `canceled` — and the pause it once carried as a project state became a
 * status *named* `Paused` filed under `planned`, which is the one category that must never
 * halt.
 */
export const HALTING_STATUS_TYPES = ['completed', 'canceled'] as const;

/**
 * The project status that halts dispatch by name, which the operator creates and moves the
 * project to when they want the pipeline to stop.
 *
 * Matched on the name because its category carries no signal: it is filed under the tracker's
 * `In Progress` — `type: started` — and halting on that type would halt every working
 * pipeline. Filing it anywhere the type could carry the signal means filing a pause as a
 * cancellation or a completion, which is the tracker then saying something untrue about the
 * project on every surface that reads the category.
 *
 * A name rather than a type is not the fragility type-matching exists to avoid. That rule is
 * about a *workspace's* names, which are the workspace's to choose and mean what it decides.
 * This one is jen's, prescribed exactly as the stage statuses in `stages.ts` are and verified
 * at bind time the same way — and what it costs is stated where the operator can act on it:
 * rename this status and the halt stops working.
 */
export const PAUSED_STATUS_NAME = 'On Pause';

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
  /** Every label the issue carries, as the team names them. Candidacy rests on one of these. */
  labels: string[];
  /** Whether the issue carries more labels than {@link LABEL_PAGE_SIZE} asked for. */
  moreLabels: boolean;
  /** Newest first. Bounded by the page size the poll was given. */
  comments: TrackerComment[];
  /**
   * Whether {@link comments} can be *shown* to hold the newest the issue carries.
   *
   * False where the page came back oldest-first, or where it is too short to tell and the
   * tracker holds more behind it. A caller reading the newest of anything must page first;
   * see {@link holdsNewest} for why this is established rather than assumed.
   */
  commentsAreNewest: boolean;
  /** Whether the tracker holds comments beyond the page above, in whichever direction. */
  moreComments: boolean;
  /** Where a follow-up read of this issue's comments resumes, when {@link moreComments}. */
  commentCursor: string | null;
}

/**
 * The project the tick was told to act on, resolved to an entity rather than to a name.
 *
 * The status is the pipeline's halt, and it is read by `type` rather than by `name` so that
 * a workspace which renamed or added statuses is still understood. It is optional because
 * a project need not carry one, and a project with no status is not a paused project.
 */
export interface TrackerProject {
  id: string;
  /** The project's name as the workspace writes it, which the given name matched case-insensitively. */
  name: string;
  status?: { name: string; type: string };
}

/**
 * Every project the given name matched, bounded at {@link PROJECT_PAGE_SIZE}.
 *
 * A list rather than a single project, because "matched two" is the answer the caller most
 * needs and a client that picked one would be the silent failure this lookup exists to
 * remove: issues from an unrelated project polled, mapped, and dispatched as the
 * pipeline's own.
 */
export interface ProjectMatch {
  projects: TrackerProject[];
  /** Whether the tracker holds still more projects of that name behind the bound. */
  moreProjects: boolean;
}

export interface TrackerTeam {
  id: string;
  /** Every status the team carries, as the team names them. Bounded by the page asked for. */
  statuses: string[];
  /**
   * Whether the team carries more statuses than {@link statuses} holds.
   *
   * The difference between "the team has no `Pending`" and "no `Pending` was in the page the
   * tick read". Only the first is a fact, and the tick says which one it has.
   */
  moreStatuses: boolean;
}

/**
 * A poll's worth of issues, with whether the project holds more of them in these statuses.
 *
 * The flag is the point of the wrapper. A bare array cannot distinguish a project with forty
 * issues in stage statuses from one with four hundred, and the overflow would be neither
 * dispatched nor declined nor named — the exact silence this client's header exists to
 * refuse, since it is indistinguishable from a healthy quiet pipeline.
 */
export interface IssuePage {
  issues: TrackerIssue[];
  moreIssues: boolean;
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
    nodes { id key name states(first: $states) { pageInfo { hasNextPage } nodes { id name } } }
  }
}`;

const TEAM_PROJECTS = `
query JenTeamProjects($team: String!, $project: String!, $projects: Int!) {
  team(id: $team) {
    projects(first: $projects, filter: { name: { eqIgnoreCase: $project } }) {
      pageInfo { hasNextPage }
      nodes { id name status { name type } }
    }
  }
}`;

const PIPELINE_ISSUES = `
query JenPipelineIssues($team: ID!, $project: String!, $states: [String!]!, $issues: Int!, $comments: Int!, $labels: Int!) {
  issues(
    first: $issues
    filter: {
      team: { id: { eq: $team } }
      project: { name: { eqIgnoreCase: $project } }
      state: { name: { in: $states } }
    }
  ) {
    pageInfo { hasNextPage }
    nodes {
      id
      identifier
      branchName
      state { name }
      labels(first: $labels) { pageInfo { hasNextPage } nodes { name } }
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
export function newestFirst(comments: TrackerComment[]): TrackerComment[] {
  return [...comments].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

interface CommentConnection {
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
  nodes: TrackerComment[];
}

/**
 * Whether a bounded page of comments can be shown to hold the newest ones.
 *
 * Sorting a page cannot rescue it: a sort orders what came back and says nothing about
 * what stayed behind the bound. Linear documents `orderBy: createdAt` as descending and
 * the documents above request it explicitly, but a documented default is not evidence, and
 * being wrong here is not a degraded answer — it is every marker on a long-running task
 * sitting behind the bound, the task reading as never announced, and a session dispatched
 * against it on every tick forever, with no error anywhere. So the page is made to carry
 * its own evidence and the assumption is not made at all.
 *
 * Three cases, and only the first costs nothing:
 *
 * - Nothing behind the bound — the page is the whole record, in either order.
 * - Two or more comments with more behind them — the first against the last says which way
 *   the connection runs. Newest first means this page is the newest.
 * - Anything else — a single comment with more behind it, or a page whose ends share a
 *   timestamp. The direction is unreadable, and unreadable is treated as unproven.
 */
function holdsNewest(connection: CommentConnection): boolean {
  if (!connection.pageInfo.hasNextPage) return true;

  const nodes = connection.nodes;
  if (nodes.length < 2) return false;
  return nodes[0]!.createdAt.localeCompare(nodes[nodes.length - 1]!.createdAt) > 0;
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

    // Reading the body is a second chance to lose the connection, and a separate one from
    // reaching the endpoint: the response object arrives as soon as the headers do, so a
    // stream that dies mid-body rejects here rather than at the `fetch` above. Left bare it
    // escapes as a `TypeError` that no caller classifies — the same transient fault as an
    // unreachable tracker, wearing a shape that ends a runner instead of being retried.
    let text: string;
    try {
      text = await response.text();
    } catch (error) {
      throw new TrackerError(
        `could not read the tracker's answer: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

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
  async team(team: string, statePageSize = STATE_PAGE_SIZE): Promise<TrackerTeam> {
    const data = await this.#query<{
      teams: {
        nodes: {
          id: string;
          key: string;
          name: string;
          states: { pageInfo: { hasNextPage: boolean }; nodes: { name: string }[] };
        }[];
      };
    }>(TEAM_STATUSES, { team, states: statePageSize });

    const found = data.teams.nodes;
    if (found.length === 0) throw new TrackerError(`the tracker has no team named or keyed \`${team}\``);
    if (found.length > 1) {
      throw new TrackerError(
        `\`${team}\` matches more than one team (${found.map((node) => `${node.key} ${node.name}`).join(', ')})`,
      );
    }

    const only = found[0]!;
    return {
      id: only.id,
      statuses: only.states.nodes.map((state) => state.name),
      moreStatuses: only.states.pageInfo.hasNextPage,
    };
  }

  /**
   * Every project of the given name that this team can reach, with its status.
   *
   * Asked of the *team* rather than of the workspace, and that is the part worth keeping:
   * the poll filters issues by this team and by the project's name, so a project of the
   * same name in a team the pipeline does not act on is not an ambiguity the tick has. A
   * workspace-wide lookup would refuse a run that was never in danger.
   *
   * Two are asked for so that several is distinguishable from one. Reading whatever comes
   * back first cannot tell those apart, and the failure is silent in the direction that
   * matters — the tick would poll an unrelated project's issues as though they were the
   * pipeline's.
   */
  async project(teamId: string, project: string, projectPageSize = PROJECT_PAGE_SIZE): Promise<ProjectMatch> {
    const data = await this.#query<{
      team: {
        projects: {
          pageInfo: { hasNextPage: boolean };
          nodes: { id: string; name: string; status: { name: string; type: string } | null }[];
        };
      } | null;
    }>(TEAM_PROJECTS, { team: teamId, project, projects: projectPageSize });

    if (!data.team) throw new TrackerError(`the tracker no longer has a team with id ${teamId}`);

    return {
      projects: data.team.projects.nodes.map((node) => ({
        id: node.id,
        name: node.name,
        status: node.status ?? undefined,
      })),
      moreProjects: data.team.projects.pageInfo.hasNextPage,
    };
  }

  /**
   * Every issue in the project sitting in one of the given statuses, with its most recent
   * comments nested in the same query.
   *
   * One request whatever the pipeline's width, which is what keeps a poll that runs
   * unattended forever from scaling its cost with the number of tasks in flight. Both page
   * sizes are the caller's and are bounded explicitly — the API's default of 50 applied at
   * two levels is what would approach the single-query complexity cap.
   *
   * The tick does not page this connection, and does not need to: what it owes a person is
   * that the report account for everything sitting in a stage's status, which a truthful
   * {@link IssuePage.moreIssues} satisfies. Paging it would make every tick's cost scale with
   * a project's backlog to serve a case an operator fixes once with a larger page.
   */
  async issues(
    teamId: string,
    project: string,
    statuses: string[],
    issuePageSize: number,
    commentPageSize: number,
    labelPageSize = LABEL_PAGE_SIZE,
  ): Promise<IssuePage> {
    if (statuses.length === 0) return { issues: [], moreIssues: false };

    const data = await this.#query<{
      issues: {
        pageInfo: { hasNextPage: boolean };
        nodes: {
          id: string;
          identifier: string;
          branchName: string;
          state: { name: string };
          labels: { pageInfo: { hasNextPage: boolean }; nodes: { name: string }[] };
          comments: CommentConnection;
        }[];
      };
    }>(PIPELINE_ISSUES, {
      team: teamId,
      project,
      states: statuses,
      issues: issuePageSize,
      comments: commentPageSize,
      labels: labelPageSize,
    });

    return {
      issues: data.issues.nodes.map((node) => ({
        id: node.id,
        identifier: node.identifier,
        branchName: node.branchName,
        status: node.state.name,
        labels: node.labels.nodes.map((label) => label.name),
        moreLabels: node.labels.pageInfo.hasNextPage,
        comments: newestFirst(node.comments.nodes),
        commentsAreNewest: holdsNewest(node.comments),
        moreComments: node.comments.pageInfo.hasNextPage,
        commentCursor: node.comments.pageInfo.endCursor,
      })),
      moreIssues: data.issues.pageInfo.hasNextPage,
    };
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
