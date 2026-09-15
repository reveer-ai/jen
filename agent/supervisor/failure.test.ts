/**
 * What the supervisor does with failure, which is turn it into input and nothing else.
 *
 * A child that dies produces nothing, and its parent is suspended waiting on a message that
 * will never arrive — so without this, nothing notices: the parent waits, the tree stops,
 * and no failure is reported anywhere. Delivering the ending as an ordinary message is what
 * lets the parent's weights choose between retrying, replacing, escalating and giving up,
 * none of which the substrate should be choosing.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { aRecord } from '../fixture.ts';
import { INTERRUPTED } from '../runtime/events.ts';
import { aRun, TestDriver, until, untilStored, type Run } from './double.ts';
import { SUBSTRATE } from './index.ts';

import type { Event } from '../runtime/events.ts';

const runs: Run[] = [];

afterEach(async () => {
  for (const run of runs.splice(0)) await run.end();
});

const AT = '2026-01-01T00:00:00.000Z';

/** A parent and a child, both booted and both mid-turn. */
async function aPair(): Promise<Run> {
  const run = await aRun({ clock: () => Date.parse(AT) });
  runs.push(run);
  await run.supervisor.add(aRecord({ id: 'a', parent: null }), 'Begin.');
  await run.supervisor.add(aRecord({ id: 'a-1', parent: 'a' }), 'Look at the tree.');
  return run;
}

describe('an agent that ends without speaking is reported to its parent', () => {
  it('wakes a parent suspended on a child that died', async () => {
    const run = await aPair();
    const parent = run.driver.latest('a')!;
    const child = run.driver.latest('a-1')!;
    await parent.until(() => parent.messages().length > 0);

    parent.ask('a:1', 'await', {}, 60_000);
    await until(() => run.store.agent('a').state.status === 'waiting', 'the parent suspending');

    child.die({ code: 137, signal: null });
    await parent.until(() => parent.answers().size === 1, 'the parent being woken');

    const answer = parent.answers().get('a:1')!;
    expect(answer.content).toContain('a-1 terminated');
    expect(answer.content).toContain('exit 137');
    // Woken rather than left waiting indefinitely, which is the whole of what this is for.
    expect(run.store.agent('a').state).toEqual({ status: 'working' });
  });

  /**
   * A parent must never be misled about who spoke. The flag carries it through the store and
   * the marker carries it into the text, because a parent reasoning about a report has only
   * the text in front of it.
   */
  it('marks the report as the substrate’s rather than the child’s', async () => {
    const run = await aPair();
    const parent = run.driver.latest('a')!;
    const child = run.driver.latest('a-1')!;
    await parent.until(() => parent.messages().length > 0);

    child.die({ code: null, signal: 'SIGKILL' });
    await until(() => run.store.agent('a').mailbox.length > 0, 'the report being posted');

    expect(run.store.agent('a').mailbox[0]).toEqual({
      from: 'a-1',
      content: 'a-1 terminated: SIGKILL',
      substrate: true,
    });

    parent.answered('Nothing more from me.');
    await parent.until(() => parent.messages().length > 1, 'the report reaching the conversation');
    expect(parent.messages().at(-1)).toBe(`${SUBSTRATE} a-1 terminated: SIGKILL`);
  });

  it('reports nothing for an agent that spoke and then exited', async () => {
    const run = await aPair();
    const child = run.driver.latest('a-1')!;
    await child.until(() => child.messages().length > 0);

    // The turn ends, which puts it at a boundary asking for nothing, so its body goes —
    // the ordinary way a body ends, and the one that must not read as a death.
    child.answered('Two files.');
    await until(() => run.driver.latest('a-1')!.destroyed, 'the body ending');

    expect(run.store.agent('a').mailbox).toMatchObject([{ from: 'a-1', content: 'Two files.' }]);
    expect(run.store.agent('a').mailbox.some((message) => message.substrate === true)).toBe(false);
  });

  it('reports nothing for a body the supervisor itself tore down', async () => {
    const run = await aRun({ clock: () => Date.parse(AT) });
    runs.push(run);
    await run.supervisor.add(aRecord({ id: 'a', parent: null }), 'Begin.');

    const peer = run.driver.latest('a')!;
    await peer.until(() => peer.messages().length > 0);
    peer.ask('a:1', 'await', {}, 0);

    await until(() => peer.destroyed, 'the suspension');
    expect(run.toHuman).toEqual([]);
  });
});

/**
 * The two cases that look alike, and the distinction 6.3 is about.
 *
 * A body lost while the supervisor was watching is a death. A supervisor restarting over a
 * store finds **every** agent bodiless, and reading that as a tree of deaths would deliver a
 * termination report for every agent in the run at the moment it was recovering from one.
 */
describe('a supervisor restarting over a store sweeps and resumes rather than mourns', () => {
  it('resumes what was working and synthesizes nothing', async () => {
    const first = await aPair();
    const parent = first.driver.latest('a')!;
    await parent.until(() => parent.messages().length > 0);
    for (const event of [
      { type: 'charter', at: AT, content: aRecord().charter },
      { type: 'message', at: AT, from: 'parent', content: 'Begin.' },
    ] satisfies Event[]) {
      parent.append(event);
    }
    await untilStored(async () => (await first.store.length('a')) === 2, 'the log being stored');

    expect(first.store.agent('a').state).toEqual({ status: 'working' });
    expect(first.store.agent('a-1').state).toEqual({ status: 'working' });
    await first.store.close();

    // A fresh driver, because a killed supervisor's handles do not survive it — which is the
    // reason the sweep is driven by the run's marking rather than by anything remembered.
    const driver = new TestDriver();
    const second = await aRun({ directory: first.directory, driver });
    runs.push(second);
    await second.supervisor.resume();

    expect(driver.sweeps).toBe(1);
    expect(driver.all('a')).toHaveLength(1);
    expect(driver.all('a-1')).toHaveLength(1);
    // Booted on what was stored, so each continues where it stopped.
    expect((JSON.parse(driver.latest('a')!.boot) as { events: Event[] }).events).toHaveLength(2);
    // And nothing was mourned: no termination reached anybody.
    expect(second.toHuman).toEqual([]);
    expect(second.store.agent('a').mailbox).toEqual([]);
  });

  it('leaves every workspace alone while it sweeps', async () => {
    const first = await aPair();
    first.driver.workspace('a').set('notes.md', 'a day of work');
    first.driver.workspace('a-1').set('found.md', 'two files');
    await first.store.close();

    const driver = new TestDriver();
    driver.workspaces.set('a', new Map([['notes.md', 'a day of work']]));
    driver.workspaces.set('a-1', new Map([['found.md', 'two files']]));

    const second = await aRun({ directory: first.directory, driver });
    runs.push(second);
    await second.supervisor.resume();

    expect(driver.workspace('a').get('notes.md')).toBe('a day of work');
    expect(driver.workspace('a-1').get('found.md')).toBe('two files');
    expect(driver.released).toEqual([]);
  });

  it('gives a resumed agent the interruption its log earned, and not a message', async () => {
    const first = await aPair();
    const peer = first.driver.latest('a')!;
    await peer.until(() => peer.messages().length > 0);
    for (const event of [
      { type: 'charter', at: AT, content: aRecord().charter },
      { type: 'tool_call', at: AT, id: 'c1', name: 'fs', arguments: '{}' },
      { type: 'usage', at: AT, in: 1, out: 1, model: 'scripted' },
    ] satisfies Event[]) {
      peer.append(event);
    }
    await untilStored(async () => (await first.store.length('a')) === 3);
    await first.store.close();

    const second = await aRun({ directory: first.directory, driver: new TestDriver() });
    runs.push(second);
    await second.supervisor.resume();

    // Nothing was appended for it, because nothing arrived — the agent died mid-call, and
    // `answerInterrupted` is exactly right about that.
    const log = await second.store.transcript('a');
    expect(log).toHaveLength(3);
    expect(JSON.stringify(log)).not.toContain(INTERRUPTED);
  });
});

describe('a stalled tree is surfaced and never resolved', () => {
  it('reports every agent waiting with nothing pending', async () => {
    const run = await aPair();
    const parent = run.driver.latest('a')!;
    const child = run.driver.latest('a-1')!;
    await parent.until(() => parent.messages().length > 0);

    // The ordinary shape of it: a parent waiting on a child that is waiting on the parent.
    parent.ask('a:1', 'await', {}, 60_000);
    child.ask('a-1:1', 'await', {}, 60_000);

    await until(() => run.stalls.length > 0, 'the deadlock being surfaced');
    expect(run.stalls.at(-1)?.sort()).toEqual(['a', 'a-1']);
    expect(run.supervisor.stalled).toBe(true);
  });

  it('wakes, messages and terminates nobody when it finds one', async () => {
    const run = await aPair();
    const parent = run.driver.latest('a')!;
    const child = run.driver.latest('a-1')!;
    await parent.until(() => parent.messages().length > 0);

    parent.ask('a:1', 'await', {}, 60_000);
    child.ask('a-1:1', 'await', {}, 60_000);
    await until(() => run.stalls.length > 0);
    await new Promise((resolve) => setTimeout(resolve, 40));

    // Breaking a deadlock is a judgment about the work, and the human is who the substrate
    // has for that.
    expect(parent.answers().size).toBe(0);
    expect(child.answers().size).toBe(0);
    expect(parent.messages()).toHaveLength(1);
    expect(run.store.agent('a-1').state.status).toBe('waiting');
    expect(run.driver.live).toHaveLength(2);
  });

  it('does not report a run with a message still pending', async () => {
    const run = await aPair();
    const parent = run.driver.latest('a')!;
    const child = run.driver.latest('a-1')!;
    await parent.until(() => parent.messages().length > 0);

    // The child answers while the parent is still mid-turn, so the message sits in the
    // parent's mailbox — every agent is waiting and delivery will wake one.
    child.answered('Two files.');
    await until(() => run.store.agent('a').mailbox.length > 0, 'the message being posted');
    parent.ask('a:1', 'await', {}, 60_000);

    await parent.until(() => parent.answers().size === 1, 'the pending message being delivered');
    expect(run.stalls).toEqual([]);
    expect(run.supervisor.stalled).toBe(false);
  });

  /**
   * A timer only decides whether a body stays up; it can never produce a message. So a
   * stalled tree is stalled whether or not one is armed, and waiting for timers to expire
   * before saying so would delay the diagnosis and change nothing about it.
   */
  it('reaches the same verdict whatever residency the agents named', async () => {
    for (const residency of [0, 60_000]) {
      const run = await aPair();
      const parent = run.driver.latest('a')!;
      const child = run.driver.latest('a-1')!;
      await parent.until(() => parent.messages().length > 0);

      parent.ask('a:1', 'await', {}, residency);
      child.ask('a-1:1', 'await', {}, residency);

      await until(() => run.stalls.length > 0, `a deadlock with residency ${residency}`);
      expect(run.supervisor.stalled).toBe(true);
    }
  });
});
