/**
 * The runner: a loop over the same tick, and the things a loop has that a single pass
 * does not — an interval, a signal, and somewhere the project identity came from.
 *
 * Driven through `jen watch` exactly as an operator invokes it, with the tracker recorded
 * and execution replaced. What is under test is the loop; what a session involves is
 * `exec.test.ts`'s.
 *
 * The signal is delivered to the handler the runner installed rather than by emitting one on
 * the process, which would also reach the test runner's own handlers and take the suite down
 * with it. Reaching for the installed listener is also the stricter assertion: it fails if
 * the runner never installed one.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { run, type Io } from '../cli/cli.js';
import type { Transport } from '../cli/linear.js';
import type { Launch, RunRequest } from '../cli/run.js';
import { DEFAULT_INTERVAL_SECONDS } from '../cli/watch.js';
import { project, snapshot, changed } from './fixture.js';

const BOUND = [
  'resources:',
  '  - name: acme-web',
  '    kind: repository',
  '  - name: acme-web-tracker',
  '    kind: project-management',
  '    provider: linear',
  '    team: ENG',
  '    project: Acme Web',
  '',
].join('\n');

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
            nodes: [{ name: 'in progress' }, { name: 'Pending' }],
          },
        },
      ],
    },
  },
};

const PROJECT = {
  data: {
    team: {
      projects: {
        pageInfo: { hasNextPage: false },
        nodes: [{ id: 'project-1', name: 'Acme Web', status: { name: 'In Progress', type: 'started' } }],
      },
    },
  },
};

function issueNode(identifier: string) {
  return {
    id: `id-${identifier}`,
    identifier,
    branchName: `${identifier.toLowerCase()}-a-task`,
    state: { name: 'in progress' },
    labels: { pageInfo: { hasNextPage: false }, nodes: [{ name: 'task' }] },
    comments: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] },
  };
}

interface Recorded {
  query: string;
  variables: Record<string, unknown>;
}

/**
 * What can go wrong with the tracker a tick talks to, from a given tick onward.
 *
 * Three failures rather than one, because the loop's guarantee is about a *class* and the
 * three sit at different distances from code that names them. `failFrom` is the poll
 * answering with an error the tracker itself reports; `truncateFrom` is a connection lost
 * while the body is being read, which arrives as a rejection from `text()` rather than from
 * the request; `malformFrom` is a transport that does not answer with a response at all,
 * standing in for the faults nothing anticipated — a bug, a mocked layer, a runtime
 * mismatch. Only the first two are classified anywhere, and the loop must survive all three.
 */
interface TrackerOptions {
  issues?: string[];
  failFrom?: number;
  truncateFrom?: number;
  malformFrom?: number;
}

/**
 * A tracker that answers every tick the same way, so the loop is what varies.
 *
 * `failFrom` makes the poll fail from that tick onward, which is how "a failed tick does not
 * end the loop" is exercised against a failure the pipeline is expected to survive.
 */
function tracker(options: TrackerOptions = {}): {
  transport: Transport;
  requests: Recorded[];
  ticks: () => number;
} {
  const requests: Recorded[] = [];
  let ticks = 0;

  const transport: Transport = async (_input, init) => {
    const sent = JSON.parse(String(init?.body)) as Recorded;
    requests.push(sent);

    if (sent.query.includes('JenTeamStatuses')) {
      ticks += 1;
      return new Response(JSON.stringify(TEAM));
    }
    if (sent.query.includes('JenTeamProjects')) return new Response(JSON.stringify(PROJECT));

    if (options.truncateFrom !== undefined && ticks >= options.truncateFrom) {
      // A response whose headers arrived and whose body did not. `text()` rejects where the
      // `fetch` call itself already resolved, which is the seam the tracker's own error
      // handling has to reach across.
      const truncated = new Response('{}');
      Object.defineProperty(truncated, 'text', { value: () => Promise.reject(new TypeError('terminated')) });
      return truncated;
    }
    if (options.malformFrom !== undefined && ticks >= options.malformFrom) {
      // Not a response. Reading a header off it throws where nothing is looking, which is
      // exactly the shape of a fault the tick cannot classify.
      return undefined as unknown as Response;
    }
    if (options.failFrom !== undefined && ticks >= options.failFrom) {
      return new Response(JSON.stringify({ errors: [{ message: 'the tracker is briefly unreachable' }] }), {
        status: 500,
      });
    }
    return new Response(
      JSON.stringify({
        data: { issues: { pageInfo: { hasNextPage: false }, nodes: (options.issues ?? []).map(issueNode) } },
      }),
    );
  };

  return { transport, requests, ticks: () => ticks };
}

/** The handler the runner installed, called as the signal would call it. */
function signalRunner(signal: NodeJS.Signals = 'SIGTERM'): void {
  const installed = process.listeners(signal).at(-1);
  expect(installed, 'the runner installed no handler for this signal').toBeDefined();
  (installed as (name: NodeJS.Signals) => void)(signal);
}

interface Watched {
  code: number;
  out: string[];
  err: string[];
  waits: number[];
  launched: RunRequest[];
  requests: Recorded[];
  ticks: number;
}

/** Runs the loop for `ticks` ticks, then stops it the way an operator would. */
async function jenWatch(
  args: string[],
  env: Record<string, string | undefined>,
  ticks: number,
  options: TrackerOptions & { launch?: Launch } = {},
): Promise<Watched> {
  const out: string[] = [];
  const err: string[] = [];
  const waits: number[] = [];
  const launched: RunRequest[] = [];
  const recorded = tracker(options);

  const wait = async (ms: number): Promise<void> => {
    waits.push(ms);
    if (waits.length >= ticks) signalRunner();
  };

  const launch: Launch =
    options.launch ??
    (async (request) => {
      launched.push(request);
      return { ok: true, failures: [], notes: [], terminated: false, sessionStarted: true };
    });

  const io: Io = { out: (line) => out.push(line), err: (line) => err.push(line) };
  const code = await run(['watch', ...args], io, { env, transport: recorded.transport, launch, wait });

  return {
    code: code as number,
    out,
    err,
    waits,
    launched,
    requests: recorded.requests,
    ticks: recorded.ticks(),
  };
}

const ENV = { LINEAR_API_KEY: 'lin_api_recorded' };
const baselineListeners = process.listenerCount('SIGTERM');
const baselineInterrupts = process.listenerCount('SIGINT');

describe('the runner', () => {
  it('ticks, waits, and ticks again until it is stopped', async () => {
    const root = project({ 'registry.yaml': BOUND }, 'watch-loop');
    const result = await jenWatch([root], ENV, 3);

    expect(result.code, 'a runner that was asked to stop and did is not a failure').toBe(0);
    expect(result.ticks, 'three ticks, and the stop landed during the third interval').toBe(3);
    expect(result.err.join('\n')).toContain('SIGTERM received');
  });

  // Measured from the end of a tick rather than from its start, which is what makes two
  // ticks unable to overlap. A tick waits for the sessions it launched, so a long session
  // delays the following poll — accepted, and the reason the interval is a floor.
  it('waits its interval between ticks, and honours a different one', async () => {
    const root = project({ 'registry.yaml': BOUND }, 'watch-interval');

    const byDefault = await jenWatch([root], ENV, 2);
    expect(byDefault.waits).toEqual([DEFAULT_INTERVAL_SECONDS * 1000, DEFAULT_INTERVAL_SECONDS * 1000]);

    const faster = await jenWatch([root, '--interval', '5'], ENV, 2);
    expect(faster.waits).toEqual([5000, 5000]);
  });

  it('rejects an interval that is not a positive whole number of seconds', async () => {
    const root = project({ 'registry.yaml': BOUND }, 'watch-bad-interval');
    for (const value of ['0', '-1', 'soon', '1.5']) {
      const result = await jenWatch([root, '--interval', value], ENV, 1);
      expect(result.code, value).toBe(1);
      expect(result.err.join('\n'), value).toContain('--interval takes a positive whole number');
    }
  });

  // The pipeline's answer to a failed tick is the next tick. A tracker that was briefly
  // unreachable, a rate limit, and a paused project all resolve without a restart.
  it('reports a failed tick and runs the next one anyway', async () => {
    const root = project({ 'registry.yaml': BOUND }, 'watch-failing');
    const result = await jenWatch([root], ENV, 3, { failFrom: 1 });

    expect(result.ticks).toBe(3);
    expect(result.code).toBe(0);
    expect(result.err.join('\n')).toContain('the tracker');
  });

  // The loop's guarantee is not a list of failures it happens to know. `tick()` names three
  // and rethrows the rest, so the runner's survival cannot rest on the naming — a fault
  // nobody anticipated is still one failed tick.
  it('survives a tick that fails in a way nothing classified', async () => {
    const root = project({ 'registry.yaml': BOUND }, 'watch-unclassified');
    const result = await jenWatch([root], ENV, 3, { malformFrom: 1 });

    expect(result.ticks, 'the loop kept ticking').toBe(3);
    expect(result.code, 'and a stopped runner is not a failed one').toBe(0);

    const reported = result.err.join('\n');
    expect(reported, 'the failure was reported rather than thrown past the loop').toContain('the tick failed');
    expect(reported, 'and the operator is told the loop is still running').toContain('is the retry');
  });

  // The case the fault above stands in for, at its real source: a body read that dies
  // mid-stream. It is a tracker failure like any other and is now named as one, so it is
  // both caught below in the loop and reported above it as what it actually is.
  it('reports a connection lost mid-body as a tracker failure, and ticks again', async () => {
    const root = project({ 'registry.yaml': BOUND }, 'watch-truncated');
    const result = await jenWatch([root], ENV, 3, { truncateFrom: 1 });

    expect(result.ticks).toBe(3);
    expect(result.code).toBe(0);
    expect(result.err.join('\n'), 'named as the tracker rather than as an unclassified fault').toContain(
      "could not read the tracker's answer",
    );
  });

  // What cannot change while the process runs is answered once rather than forever: the
  // environment a tick reads is fixed for the length of a process, so looping on it would
  // print the same message until somebody noticed.
  it('exits non-zero without looping when a credential is missing', async () => {
    const root = project({ 'registry.yaml': BOUND }, 'watch-no-credential');
    const result = await jenWatch([root], {}, 1);

    expect(result.code).toBe(1);
    expect(result.err.join('\n')).toContain('LINEAR_API_KEY is not set');
    expect(result.ticks, 'nothing was polled').toBe(0);
    expect(result.waits, 'and nothing was waited out').toEqual([]);
  });

  // The intersection the two refusal cases above each hide, by holding fixed the one value
  // that hides it: one binds the project so only the credential is missing, the other supplies
  // the credential so only the binding is. Both missing is what an unbound checkout with
  // nothing exported looks like — a first run — and there the registry is not the answer to
  // the refusal being made, so offering it contradicts the line it prints under.
  it('does not offer the registry under a refusal the registry cannot answer', async () => {
    const root = project({ 'registry.yaml': 'resources:\n  - name: acme\n    kind: repository\n' }, 'watch-neither');
    const result = await jenWatch([root], {}, 1);

    expect(result.code).toBe(1);

    const refused = result.err.join('\n');
    expect(refused, 'the credential is what stopped it, and is what it says').toContain('LINEAR_API_KEY is not set');
    expect(refused, 'and binding the checkout would not change that').not.toContain('Or bind the checkout');
    expect(refused, 'so the checkout is not named as a remedy either').not.toContain(root);
    expect(result.ticks).toBe(0);
  });

  it('exits non-zero when the checkout names no tracker project and none was given', async () => {
    const root = project({ 'registry.yaml': 'resources:\n  - name: acme\n    kind: repository\n' }, 'watch-unbound');
    const result = await jenWatch([root], ENV, 1);

    expect(result.code).toBe(1);

    const refused = result.err.join('\n');
    expect(refused).toContain('no tracker team was given');

    // The refusal has to name all three places this runner looked. The shared message knows
    // two of them, and the registry — the one an operator pointing it at a checkout was
    // relying on — is the one only this runner can speak to.
    expect(refused, 'the checkout it read').toContain(root);
    expect(refused, 'and what that registry was missing').toContain('project-management');
    expect(result.ticks).toBe(0);
  });

  // Four ways for a checkout to supply nothing, and the refusal has to tell them apart: a
  // person fixes each one differently, and the runner's own output is the only place they
  // find out which one it was. This used to be asserted through the planner, which read the
  // registry to render a file; the runner is now its only reader, so it is asserted here.
  it('names which way the checkout supplied nothing, rather than that it did', async () => {
    const cases: [string, Record<string, string>, RegExp][] = [
      ['absent', {}, /has no registry\.yaml/],
      ['unparseable', { 'registry.yaml': 'resources:\n  - name: [unclosed\n' }, /could not be parsed/],
      ['no tracker', { 'registry.yaml': 'resources:\n  - name: acme\n    kind: repository\n' }, /names no/],
      [
        'two trackers',
        { 'registry.yaml': `${BOUND}  - name: other\n    kind: project-management\n    team: OPS\n    project: Ops\n` },
        /names 2 /,
      ],
    ];

    for (const [label, files, why] of cases) {
      const root = project(files, `watch-nothing-${label.replace(/ /g, '-')}`);
      const result = await jenWatch([root], ENV, 1);

      expect(result.code, label).toBe(1);
      expect(result.err.join('\n'), label).toMatch(why);
      expect(result.ticks, label).toBe(0);
    }
  });

  // A tracker resource that answers for one value and not the other. The refusal names the
  // field the resource is missing rather than the file, because the file is present and
  // correct and re-reading it is not what fixes this.
  it('names the field a tracker resource is missing, rather than the file', async () => {
    const root = project(
      { 'registry.yaml': 'resources:\n  - name: acme-web-tracker\n    kind: project-management\n    team: ENG\n' },
      'watch-half-bound',
    );
    const result = await jenWatch([root], ENV, 1);

    expect(result.code).toBe(1);
    expect(result.err.join('\n')).toMatch(/names no `project`/);
    expect(result.ticks).toBe(0);
  });
});

describe('where the runner gets the project it polls', () => {
  it('reads the checkout it was pointed at, and passes the values into the tick', async () => {
    const root = project({ 'registry.yaml': BOUND }, 'watch-registry');
    const result = await jenWatch([root], ENV, 1);

    expect(result.requests[0]!.variables.team).toBe('ENG');
    expect(result.requests[1]!.variables.project).toBe('Acme Web');
    expect(result.err.join('\n'), 'and says where they came from').toContain('(registry)');
  });

  it('lets a flag beat the registry, and the environment beat it too', async () => {
    const root = project({ 'registry.yaml': BOUND }, 'watch-override');

    const flagged = await jenWatch([root, '--team', 'OPS', '--project', 'Ops Web'], ENV, 1);
    expect(flagged.requests[0]!.variables.team).toBe('OPS');
    expect(flagged.requests[1]!.variables.project).toBe('Ops Web');
    expect(flagged.err.join('\n')).toContain('(flag)');

    const exported = await jenWatch([root], { ...ENV, JEN_TEAM: 'OPS', JEN_PROJECT: 'Ops Web' }, 1);
    expect(exported.requests[0]!.variables.team).toBe('OPS');
    expect(exported.err.join('\n')).toContain('(environment)');
  });

  it('takes the working directory when no path was given', async () => {
    const root = project({ 'registry.yaml': BOUND }, 'watch-cwd');
    const out: string[] = [];
    const err: string[] = [];
    const recorded = tracker();
    const waits: number[] = [];

    const code = await run(['watch'], { out: (line) => out.push(line), err: (line) => err.push(line) }, {
      env: ENV,
      cwd: root,
      transport: recorded.transport,
      launch: async () => ({ ok: true, failures: [], notes: [], terminated: false, sessionStarted: true }),
      wait: async (ms) => {
        waits.push(ms);
        signalRunner();
      },
    });

    expect(code).toBe(0);
    expect(recorded.requests[0]!.variables.team).toBe('ENG');
  });

  it('rejects a second project path rather than guessing which one it meant', async () => {
    const result = await jenWatch(['one', 'two'], ENV, 1);
    expect(result.code).toBe(1);
    expect(result.err.join('\n')).toContain('takes one project path');
  });
});

describe('what the runner holds', () => {
  // No lock file, no ledger, no queue. Restarting re-establishes everything from the tracker,
  // and two instances on one project are governed by the in-flight test and the cap the
  // tracker represents rather than by anything held on either host.
  it('writes nothing to the checkout it was pointed at', async () => {
    const root = project({ 'registry.yaml': BOUND, 'src/app.ts': 'export const app = 1;\n' }, 'watch-stateless');
    const before = snapshot(root);

    await jenWatch([root], ENV, 2, { issues: ['ENG-1'] });

    expect(changed(before, snapshot(root))).toEqual([]);
    expect(readFileSync(join(root, 'registry.yaml'), 'utf8'), 'the registry is read, never written').toBe(BOUND);
    for (const name of ['.jen', 'jen.lock', '.jen-state.json']) {
      expect(existsSync(join(root, name)), `${name} must not exist`).toBe(false);
    }
  });

  it('leaves no signal handler behind when it stops', async () => {
    const root = project({ 'registry.yaml': BOUND }, 'watch-handlers');
    await jenWatch([root], ENV, 2);

    expect(process.listenerCount('SIGTERM')).toBe(baselineListeners);
    expect(process.listenerCount('SIGINT')).toBe(baselineInterrupts);
  });

  // `jen run` installs its handlers per invocation and removes them on the way out. The loop
  // installs its own for the length of the process, and the two must never both be installed
  // — which is why `watch` calls the tick directly rather than routing through `run`'s.
  it('installs exactly one handler however many ticks it runs', async () => {
    const root = project({ 'registry.yaml': BOUND }, 'watch-one-handler');
    const counts: number[] = [];
    const recorded = tracker();

    await run(['watch', root], { out: () => {}, err: () => {} }, {
      env: ENV,
      transport: recorded.transport,
      launch: async () => ({ ok: true, failures: [], notes: [], terminated: false, sessionStarted: true }),
      wait: async () => {
        counts.push(process.listenerCount('SIGTERM'));
        if (counts.length >= 3) signalRunner();
      },
    });

    expect(counts).toEqual([baselineListeners + 1, baselineListeners + 1, baselineListeners + 1]);
  });

  it('dispatches through the same tick, emitting the same requests and records', async () => {
    const root = project({ 'registry.yaml': BOUND }, 'watch-dispatch');
    const result = await jenWatch([root], ENV, 1, { issues: ['ENG-1'] });

    expect(result.launched.map((request) => request.task)).toEqual(['ENG-1']);
    const emitted = result.out.map((line) => JSON.parse(line) as { event: string });
    expect(emitted.map((line) => line.event)).toEqual(['dispatch', 'outcome']);
  });

  it('stops the sessions in flight rather than orphaning them', async () => {
    const root = project({ 'registry.yaml': BOUND }, 'watch-stop');
    let stopped = false;

    const err: string[] = [];
    const io: Io = { out: () => {}, err: (line) => err.push(line) };
    const recorded = tracker({ issues: ['ENG-1'] });
    const code = await run(['watch', root], io, {
      env: ENV,
      transport: recorded.transport,
      // A session that outlives the stop signal, so the runner has something in flight to
      // reach when it is asked to stop.
      launch: async () => {
        signalRunner();
        return { ok: false, failures: ['stopped'], notes: [], terminated: true, sessionStarted: true };
      },
      wait: async () => {
        stopped = true;
      },
    });

    expect(code).toBe(0);
    expect(stopped, 'a stop during a tick starts no interval and no further tick').toBe(false);
    expect(err.join('\n'), 'the sessions in flight are reached rather than orphaned').toContain(
      'sessions in flight are being stopped',
    );
  });
});

describe('the usage text', () => {
  it('names watch and its interval, and does not qualify the runner as local', async () => {
    const out: string[] = [];
    await run(['watch', '--help'], { out: (line) => out.push(line), err: () => {} }, { env: ENV });
    const usage = out.join('\n');

    expect(usage).toMatch(/^ {2}watch {2,}\S/m);
    expect(usage).toContain('--interval');
    expect(usage).toContain(`${DEFAULT_INTERVAL_SECONDS} seconds`);
    expect(usage, 'the runner jen ships is the runner, unqualified').not.toMatch(/local runner/i);
    expect(usage, 'the runner does not remove the git host').toMatch(/git-host identities/);
    expect(usage, 'and a runner jen does not ship is equally valid').toMatch(/does not ship is\s+equally valid/);
  });

  it('has no --dry-run, and says what to reach for instead', async () => {
    const root = project({ 'registry.yaml': BOUND }, 'watch-dry-run');
    const result = await jenWatch([root, '--dry-run'], ENV, 1);

    expect(result.code).toBe(1);
    expect(result.err.join('\n')).toContain('jen run --dry-run');
  });
});
