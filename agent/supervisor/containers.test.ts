/**
 * The whole thing, against a real container runtime.
 *
 * Everything else in this directory runs against a double, which is right for a change that
 * is mostly a state machine over stored data. Three assertions are not about the state
 * machine at all — that a fully dormant tree holds no container, that an agent which asked
 * to stay resident still holds its own, and that a run killed with containers live is swept
 * and resumes — and a double cannot make any of them, because the double decides what
 * `docker ps` would have said.
 *
 * **These tests need a running container runtime, and nothing in CI runs them.** See
 * `agent/AGENTS.md`. They inherit that from `sandbox/docker.test.ts` and are written to the
 * same shape: everything is labelled with this file's own run id and swept in `afterAll`.
 *
 * The agents are the shell peer in `harness.ts` rather than the real runtime, because what
 * is under test is containers and not reasoning. `sh` is the whole of what a sandbox image
 * has to provide, so this needs no image of its own.
 */
import { execFile, spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { aRecord } from '../fixture.ts';
import { DockerSandboxDriver } from '../sandbox/docker.ts';
import { SHELL_PEER, type HarnessConfig } from './harness.ts';
import { Supervisor } from './index.ts';
import { Store } from './store.ts';

import type { AgentRecord } from '../record.ts';

const run = promisify(execFile);

/** Scopes every label, every agent id, and the sweep, to this run of this file. */
const RUN = `jen-test-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** Small, public, and carrying the `sh` a sandbox idles on and the peer is written in. */
const IMAGE = 'busybox:stable';

const HARNESS = join(import.meta.dirname, 'harness.ts');

const opened: Store[] = [];

async function ask(...args: string[]): Promise<string> {
  try {
    return (await run('docker', args)).stdout.trim();
  } catch (error) {
    return ((error as { stdout?: string }).stdout ?? '').trim();
  }
}

async function lines(...args: string[]): Promise<string[]> {
  return (await ask(...args)).split('\n').filter((line) => line !== '');
}

/** Containers of this run that are still running. */
async function running(): Promise<string[]> {
  return lines('ps', '--filter', `label=jen.run=${RUN}`, '--format', '{{.Label "jen.agent"}}');
}

async function all(): Promise<string[]> {
  return lines('ps', '-a', '--filter', `label=jen.run=${RUN}`, '--format', '{{.Label "jen.agent"}}');
}

function aPeerRecord(id: string, charter: string, parent: string | null = null): AgentRecord {
  return aRecord({ id, charter, parent, environment: IMAGE, workspace: '/workspace', tools: [] });
}

async function aStore(): Promise<{ store: Store; root: string }> {
  const root = join(await mkdtemp(join(tmpdir(), 'jen-containers-')), '.jen');
  const store = await Store.open(root, RUN);
  opened.push(store);
  return { store, root };
}

function aSupervisor(store: Store): Supervisor {
  return new Supervisor({
    store,
    driver: new DockerSandboxDriver({ run: RUN }),
    command: ['sh', '-c', SHELL_PEER],
  });
}

async function until(satisfied: () => Promise<boolean>, what: string, ms = 60_000): Promise<void> {
  const started = Date.now();
  while (!(await satisfied())) {
    if (Date.now() - started > ms) throw new Error(`never reached ${what}.`);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

beforeAll(async () => {
  if ((await ask('version', '--format', '{{.Server.Version}}')) === '') {
    throw new Error('these tests need a running container runtime, and none is reachable. See agent/AGENTS.md.');
  }
  await run('docker', ['pull', IMAGE], { timeout: 240_000 });
}, 600_000);

afterEach(async () => {
  for (const store of opened.splice(0)) await store.close();
});

afterAll(async () => {
  for (const id of await lines('ps', '-aq', '--filter', `label=jen.run=${RUN}`)) await ask('rm', '--force', id);
  for (const name of await lines('volume', 'ls', '-q', '--filter', `label=jen.run=${RUN}`)) {
    await ask('volume', 'rm', '--force', name);
  }
});

describe('a dormant tree holds nothing, and a resident agent holds its own', () => {
  /**
   * In a tree, every ancestor of every working agent is idle by construction — so a
   * substrate that kept idle agents resident would scale containers with the shape of the
   * org chart rather than with the work. That is the argument the whole suspension model
   * exists for, and this is where it is either true of real containers or it is not.
   *
   * **The assertion is that each agent was honoured, never that suspension always tears
   * down.** An agent that asked to stay resident and still has its container is the correct
   * result rather than a leak.
   */
  it('leaves one container running, belonging to the agent that asked for it', async () => {
    const { store } = await aStore();
    const supervisor = aSupervisor(store);

    // A tree rather than three roots: every ancestor of every working agent is idle by
    // construction, which is the shape the whole suspension argument is about.
    await supervisor.add(aPeerRecord(`${RUN}-chief`, 'GO: finish and ask for nothing.'));
    await supervisor.add(aPeerRecord(`${RUN}-go`, 'GO: finish and ask for nothing.', `${RUN}-chief`));
    await supervisor.add(aPeerRecord(`${RUN}-stay`, 'STAY: keep my container.', `${RUN}-chief`));

    await until(
      async () => store.ids().every((id) => store.agent(id).state.status === 'waiting'),
      'every agent suspending',
    );
    await until(async () => (await running()).length <= 1, 'the dormant agents’ containers ending');

    expect(await running()).toEqual([`${RUN}-stay`]);
    expect(supervisor.resident).toEqual([`${RUN}-stay`]);

    // And the ones that went dormant lost nothing: their workspaces are still there, which
    // is what a later message would wake them into.
    expect((await lines('volume', 'ls', '--filter', `label=jen.run=${RUN}`, '--format', '{{.Name}}')).length).toBe(3);

    await supervisor.shutdown();
    expect(await running()).toEqual([]);
  }, 300_000);
});

/**
 * Start a supervisor in a process group of its own, wait for its tree to settle, and kill
 * the whole group without warning.
 *
 * A test cannot `kill -9` the process it is running in, and a supervisor shut down politely
 * is not the case any of this exists for. What survives is the store and the workspaces,
 * and that is all any supervisor after this one is given.
 */
async function killedMidFlight(root: string, records: AgentRecord[]): Promise<void> {
  const config: HarnessConfig = { root, run: RUN, records, until: 'working' };
  // Detached, so it leads a process group of its own and the kill reaches the whole of it
  // rather than only the node process at the top.
  const child = spawn(process.execPath, [HARNESS, JSON.stringify(config)], {
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let said = '';
  let complained = '';
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => (said += chunk));
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => (complained += chunk));

  try {
    await until(async () => said.includes('ready'), `the tree working (${complained})`);
    expect((await running()).sort()).toEqual(records.map((record) => record.id).sort());
  } finally {
    try {
      process.kill(-child.pid!, 'SIGKILL');
    } catch {
      // Already gone, which is the state this was trying to reach anyway.
    }
    await new Promise((resolve) => child.on('close', resolve));
  }

  // The containers outlived it, which is the case the sweep exists for: they are not
  // children of the process that made them, and nothing remains to walk the tree.
  expect((await running()).length).toBe(records.length);
}

describe('a run killed with containers live is swept, and resumes', () => {
  /**
   * A real kill, of a real process group, with real containers running — which is why the
   * supervisor is started in a process of its own. A test cannot `kill -9` the process it is
   * running in, and a supervisor shut down politely is not the case any of this exists for.
   *
   * What survives the kill is the store and the workspaces, and that is all the second
   * supervisor is given: a fresh driver holding no handle on anything, over the same
   * directory.
   */
  it('resumes every agent from records and transcripts alone', async () => {
    const { root } = await aStore();
    const records = [
      aPeerRecord(`${RUN}-held-1`, 'HOLD: go quiet mid-turn.'),
      aPeerRecord(`${RUN}-held-2`, 'HOLD: go quiet mid-turn.', `${RUN}-held-1`),
    ];
    await killedMidFlight(root, records);

    // Everything the next supervisor is given: the store, and a driver holding no handle on
    // anything.
    const reopened = await Store.open(root, RUN);
    opened.push(reopened);
    expect(reopened.ids().sort()).toEqual(records.map((record) => record.id).sort());
    for (const record of records) expect(reopened.agent(record.id).state.status).toBe('working');

    const supervisor = aSupervisor(reopened);
    await supervisor.resume();

    await until(
      async () => records.every((record) => reopened.agent(record.id).state.status === 'waiting'),
      'both agents continuing where they stopped',
    );

    // Continued from the stored transcript rather than starting over: the peer emitted its
    // continuation because its log already carried steps, and the log now carries both.
    for (const record of records) {
      expect((await reopened.transcript(record.id)).map((event) => event.type)).toEqual([
        'charter',
        'usage',
        'message',
      ]);
    }

    await supervisor.shutdown();
    expect(await running()).toEqual([]);
  }, 300_000);

  /**
   * The one line in this change that destroys a day of work if it is wrong, asked of the
   * thing that would actually lose it.
   *
   * The workspaces carry the same `jen.run` label the sweep queries by, so the wrong query
   * finds them — and it would run at the moment after a crash when what is in them is least
   * recoverable.
   */
  it('is swept to nothing, keeps every workspace, and then carries on', async () => {
    const { root } = await aStore();
    const records = [
      aPeerRecord(`${RUN}-alpha`, 'HOLD: go quiet mid-turn.'),
      aPeerRecord(`${RUN}-beta`, 'HOLD: go quiet mid-turn.', `${RUN}-alpha`),
    ];
    await killedMidFlight(root, records);

    // The sweep, from the marking alone, holding a handle on nothing.
    await new DockerSandboxDriver({ run: RUN }).destroyAll();
    expect(await running()).toEqual([]);
    expect(await all()).toEqual([]);

    const workspaces = await lines('volume', 'ls', '--filter', `label=jen.run=${RUN}`, '--format', '{{.Name}}');
    expect(workspaces).toHaveLength(2);

    // Resumed after the sweep, each into its own workspace. The peer appends a line every
    // time it starts, so what is read back is the agent's own work from before the kill —
    // planted by nothing the test did.
    const reopened = await Store.open(root, RUN);
    opened.push(reopened);
    const supervisor = aSupervisor(reopened);
    await supervisor.resume();

    await until(
      async () => records.every((record) => reopened.agent(record.id).state.status === 'waiting'),
      'both agents continuing after the sweep',
    );
    await supervisor.shutdown();

    for (const part of ['alpha', 'beta']) {
      const name = workspaces.find((workspace) => workspace.includes(part));
      expect(name, `${part} has no workspace`).toBeDefined();
      const history = await ask('run', '--rm', '--volume', `${name!}:/w`, IMAGE, 'cat', '/w/history');
      expect(history.split('\n').filter((line) => line === 'started')).toHaveLength(2);
    }
  }, 300_000);
});
