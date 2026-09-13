/**
 * The property the whole suspend/resume model rests on: the model cannot tell it was
 * restarted.
 *
 * **That has no direct assertion**, so it is established by comparison. Run a sequence of
 * turns in one runtime and capture every request body. Run the same sequence again,
 * destroying the runtime and reconstructing it from the emitted log at every boundary, and
 * capture those. If the two sequences are byte-identical and in the same order, a restart
 * changed nothing the model could observe — because the model holds no state between calls,
 * so what we send is the entirety of what it sees.
 *
 * Byte-identity rather than deep equality, because providers key prompt caches on prefix
 * content: a difference of a single character is not cosmetic, it misses cache on every
 * resume, silently and expensively. `toEqual` cannot see key order and would pass on it.
 *
 * The two runs are given **different clocks on purpose**. If anything a clock touches ever
 * reached a request, this is what fails.
 */
import { describe, expect, it } from 'vitest';

import { aCall, aCapability, aRecord, asks, declines, says, scripted } from '../fixture.ts';
import { INTERRUPTED, type Event } from './events.ts';
import { Runtime } from './index.ts';

import type { Capability, CapabilityResult } from './capability.ts';
import type { ModelStep } from './model.ts';

const LIVE = () => 1_767_225_600_000;
const RESUMED = () => 1_798_761_600_000;

/** Ten turns, with calls, results, reasoning, a refusal and plain answers among them. */
const TURNS = [
  'Start.',
  'And then?',
  'Look at the tree.',
  'Read one.',
  'Summarize.',
  'Now delete it all.',
  'Then just list them.',
];

const SCRIPT: Partial<ModelStep>[] = [
  { content: 'Beginning.', reasoning: { content: 'The parent wants a start.' } },
  says('Then this.'),
  asks(aCall('c1', 'fs', { path: '.' })),
  { content: 'Two files.', usage: { in: 120, out: 8, model: 'scripted' } },
  asks(aCall('c2', 'fs', { path: 'README.md' }), aCall('c3', 'fs', { path: 'package.json' })),
  {
    content: 'Read both.',
    reasoning: {
      content: 'A chain of thought the provider handed back in its own shape.',
      opaque: { reasoning_details: [{ type: 'reasoning.encrypted', data: 'AAAA' }] },
    },
  },
  says('In summary: two files.'),
  // A refusal is a turn the model has to still remember declining, so it belongs in the
  // comparison rather than in a test of its own: it reaches the wire in a field of its own,
  // which is one more thing a reconstruction could spell differently.
  declines('I will not delete anything.'),
  // The turn after it is what makes the refusal observable at all: it is replayed in the
  // request this step answers, and a refusal lost on the way back would leave the model
  // meeting this message with no memory of having declined the last one.
  says('README.md and package.json.'),
];

function capabilities(): Capability[] {
  return [aCapability('fs', () => ({ content: 'README.md\npackage.json', ok: true }))];
}

/** One runtime, start to finish. */
async function live(events: readonly Event[], turns: readonly string[]): Promise<string[]> {
  const client = scripted(SCRIPT);
  const runtime = new Runtime({
    record: aRecord({ tools: ['fs'] }),
    events,
    capabilities: capabilities(),
    client,
    clock: LIVE,
  });
  for (const turn of turns) await runtime.turn(turn);
  return client.requests;
}

/** A new runtime for every turn, built from nothing but the log the last one emitted. */
async function reconstructed(events: readonly Event[], turns: readonly string[]): Promise<string[]> {
  const client = scripted(SCRIPT);
  let log: readonly Event[] = events;
  for (const turn of turns) {
    const runtime = new Runtime({
      record: aRecord({ tools: ['fs'] }),
      events: log,
      capabilities: capabilities(),
      client,
      clock: RESUMED,
    });
    await runtime.turn(turn);
    log = runtime.events;
  }
  return client.requests;
}

describe('a resumed agent sends what an uninterrupted one would have sent', () => {
  it('is byte-identical, in the same order, across a plain exchange', async () => {
    const one = await live([], TURNS.slice(0, 2));
    const other = await reconstructed([], TURNS.slice(0, 2));
    expect(other).toEqual(one);
    expect(one.length).toBeGreaterThan(1);
  });

  // A log with nothing but messages in it would not exercise the projection's only
  // structural work — folding a run of calls into one assistant message, and putting each
  // result immediately after the message that asked for it.
  it('is byte-identical across turns carrying capability calls and their results', async () => {
    const one = await live([], TURNS);
    const other = await reconstructed([], TURNS);
    expect(other).toEqual(one);

    const sent = JSON.parse(one.at(-1)!) as { messages: { role: string }[] };
    expect(sent.messages.filter((message) => message.role === 'tool').length).toBeGreaterThan(0);
    expect(sent.messages.filter((message) => message.role === 'assistant').length).toBeGreaterThan(0);
  });

  it('carries a provider’s own reasoning representation through the reconstruction', async () => {
    const other = await reconstructed([], TURNS);
    expect(other.some((request) => request.includes('reasoning.encrypted'))).toBe(true);
  });

  it('carries a refusal through it, still in the field it came back in', async () => {
    const one = await live([], TURNS);
    const other = await reconstructed([], TURNS);
    expect(other).toEqual(one);

    const sent = JSON.parse(other.at(-1)!) as { messages: Record<string, unknown>[] };
    expect(sent.messages).toContainEqual({ role: 'assistant', content: null, refusal: 'I will not delete anything.' });
  });

  it('sends the same bytes however many times it is reconstructed', async () => {
    expect(await reconstructed([], TURNS)).toEqual(await reconstructed([], TURNS));
  });
});

/**
 * The log as it stood at the instant a process died mid-call: the call is written down and
 * its result is not, because the result never arrived.
 *
 * Captured from a real run rather than assembled by hand, so it is the log a runtime
 * actually produces at that moment rather than the log we imagine it produces.
 */
async function interrupted(): Promise<Event[]> {
  let snapshot: Event[] = [];
  let reached: () => void = () => {};
  const hit = new Promise<void>((resolve) => (reached = resolve));

  const hangs: Capability = {
    name: 'fs',
    description: 'A capability that never comes back.',
    schema: { type: 'object' },
    invoke: (): Promise<CapabilityResult> => {
      snapshot = runtime.events;
      reached();
      return new Promise<CapabilityResult>(() => {});
    },
  };

  const runtime = new Runtime({
    record: aRecord({ tools: ['fs'] }),
    capabilities: [hangs],
    client: scripted([asks(aCall('c1', 'fs', { path: '.' })), says('Done.')]),
    clock: LIVE,
  });

  void runtime.turn('Start.');
  await hit;
  return snapshot;
}

describe('an interrupted call is answered, and the answer survives the comparison', () => {
  it('leaves the call written down with no result', async () => {
    const log = await interrupted();
    expect(log.at(-1)).toMatchObject({ type: 'usage' });
    expect(log.some((event) => event.type === 'tool_call' && event.id === 'c1')).toBe(true);
    expect(log.some((event) => event.type === 'tool_result')).toBe(false);
  });

  it('answers it on reconstruction, without invoking the capability again', async () => {
    const log = await interrupted();
    const capability = aCapability('fs');
    const runtime = new Runtime({
      record: aRecord({ tools: ['fs'] }),
      events: log,
      capabilities: [capability],
      client: scripted([says('I will not assume that took effect.')]),
      clock: RESUMED,
    });

    await expect(runtime.run()).resolves.toBe('I will not assume that took effect.');
    expect(capability.inputs, 'the interrupted call was re-executed').toEqual([]);
    expect(runtime.events.filter((event) => event.type === 'tool_result')).toMatchObject([
      { id: 'c1', ok: false, content: INTERRUPTED },
    ]);
  });

  // The point of the comparison here: the synthesized result is a real event, so a runtime
  // that resumes across it sends what a runtime carrying it from the start would send.
  it('sends the same bytes as a run that carried the answer from the start', async () => {
    const log = await interrupted();
    const script = [says('I will not assume that took effect.'), says('Done again.')];

    const whole = scripted(script);
    const once = new Runtime({
      record: aRecord({ tools: ['fs'] }),
      events: log,
      capabilities: capabilities(),
      client: whole,
      clock: LIVE,
    });
    await once.run();
    await once.turn('And again.');

    const across = scripted(script);
    const first = new Runtime({
      record: aRecord({ tools: ['fs'] }),
      events: log,
      capabilities: capabilities(),
      client: across,
      clock: RESUMED,
    });
    await first.run();
    const second = new Runtime({
      record: aRecord({ tools: ['fs'] }),
      events: first.events,
      capabilities: capabilities(),
      client: across,
      clock: RESUMED,
    });
    await second.turn('And again.');

    expect(across.requests).toEqual(whole.requests);
    expect(across.requests[0], 'the interruption never reached the wire').toContain(INTERRUPTED);
  });
});
