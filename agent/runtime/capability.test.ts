/**
 * The capability surface.
 *
 * No capability ships in this change, so nothing outside this file exercises the interface
 * — the sandbox's one-driver problem, again. It is held the same way: a trivial capability
 * defined in the suite, and the requirement that an empty registry be valid, which is what
 * forces the loop to have no capability-specific branch to begin with.
 */
import { describe, expect, it } from 'vitest';

import { aCall, aCapability, aRecord, asks, says, scripted } from '../fixture.ts';
import { CapabilityError, declare, dispatch, resolveCapabilities } from './capability.ts';
import { Runtime } from './index.ts';

const NEVER = new AbortController().signal;
const CLOCK = () => 1_767_225_600_000;

describe('the registry is built from the record', () => {
  it('offers exactly what the record names, in that order', () => {
    const registry = resolveCapabilities(['beta', 'alpha'], [aCapability('alpha'), aCapability('beta')]);
    expect([...registry.keys()]).toEqual(['beta', 'alpha']);
    expect(declare(registry).map((tool) => tool.function.name)).toEqual(['beta', 'alpha']);
  });

  it('is valid holding nothing at all', () => {
    const registry = resolveCapabilities([], []);
    expect(registry.size).toBe(0);
    expect(declare(registry)).toEqual([]);
  });

  it('fails construction on a name it cannot resolve, naming it', () => {
    expect(() => resolveCapabilities(['fs', 'spawn'], [aCapability('fs')])).toThrow(CapabilityError);
    expect(() => resolveCapabilities(['fs', 'spawn'], [aCapability('fs')])).toThrow(/"spawn"/);
  });

  // Two agents, one runtime, different authority. This is the whole of how that works.
  it('gives two runtimes different capabilities and leaves them otherwise identical', () => {
    const available = [aCapability('fs'), aCapability('spawn')];
    const one = new Runtime({ record: aRecord({ tools: ['fs'] }), capabilities: available, client: scripted([]) });
    const two = new Runtime({ record: aRecord({ tools: ['spawn'] }), capabilities: available, client: scripted([]) });

    expect(one.request().tools?.map((tool) => tool.function.name)).toEqual(['fs']);
    expect(two.request().tools?.map((tool) => tool.function.name)).toEqual(['spawn']);
    expect(Object.getPrototypeOf(one)).toBe(Object.getPrototypeOf(two));
  });
});

describe('a failure is a result, not a crash', () => {
  it('records a capability that raised as that invocation’s result', async () => {
    const registry = resolveCapabilities(
      ['boom'],
      [
        aCapability('boom', () => {
          throw new Error('the disk is on fire');
        }),
      ],
    );

    const result = await dispatch(registry, aCall('c1', 'boom'), NEVER, CLOCK);
    expect(result.ok).toBe(false);
    expect(result.content).toContain('the disk is on fire');
  });

  it('answers a name the model invented rather than failing', async () => {
    const registry = resolveCapabilities(['fs'], [aCapability('fs')]);
    const result = await dispatch(registry, aCall('c1', 'teleport'), NEVER, CLOCK);
    expect(result.ok).toBe(false);
    expect(result.content).toContain('"teleport"');
    expect(result.content).toContain('"fs"');
  });

  it('answers arguments that are not JSON rather than failing', async () => {
    const registry = resolveCapabilities(['fs'], [aCapability('fs')]);
    const result = await dispatch(registry, { id: 'c1', name: 'fs', arguments: '{"path":' }, NEVER, CLOCK);
    expect(result.ok).toBe(false);
    expect(result.content).toMatch(/not valid JSON/);
  });

  it('keeps the loop going afterwards rather than ending the run', async () => {
    const runtime = new Runtime({
      record: aRecord({ tools: ['boom'] }),
      capabilities: [
        aCapability('boom', () => {
          throw new Error('nope');
        }),
      ],
      client: scripted([asks(aCall('c1', 'boom')), says('I could not do that.')]),
      clock: CLOCK,
    });

    await expect(runtime.turn('Go.')).resolves.toBe('I could not do that.');
    expect(runtime.events.filter((event) => event.type === 'tool_result')).toMatchObject([{ ok: false }]);
  });
});

/**
 * Local and forwarded capabilities are the same thing to the loop, and that is the
 * mechanism by which the runtime never holds the authority to spawn. `fs` will do real work
 * inside the sandbox; `spawn` will write a line to the supervisor and wait. Nothing in the
 * dispatch can tell which is which, so the runtime cannot come to contain a branch that
 * knows what spawning means.
 */
describe('the loop cannot tell local from forwarded', () => {
  it('dispatches both through one path, with the same shape of result', async () => {
    const local = aCapability('fs', () => ({ content: 'README.md', ok: true }));
    // Stands in for a forwarded one: it does not answer in this tick, it answers when
    // something outside gets back to it.
    const forwarded = aCapability('spawn', async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      return { content: 'agent-2', ok: true };
    });

    const runtime = new Runtime({
      record: aRecord({ tools: ['fs', 'spawn'] }),
      capabilities: [local, forwarded],
      client: scripted([asks(aCall('a', 'fs'), aCall('b', 'spawn')), says('Both done.')]),
      clock: CLOCK,
    });

    await runtime.turn('Go.');

    const results = runtime.events.filter((event) => event.type === 'tool_result');
    expect(results.map((event) => event.id)).toEqual(['a', 'b']);
    expect(results.map((event) => Object.keys(event).sort())).toEqual([
      ['at', 'content', 'id', 'ms', 'ok', 'type'],
      ['at', 'content', 'id', 'ms', 'ok', 'type'],
    ]);

    // And the model sees no difference either: both are `tool` messages and nothing in
    // them says where the work happened.
    const messages = runtime.request().messages.filter((message) => message.role === 'tool');
    expect(messages.map((message) => Object.keys(message).sort())).toEqual([
      ['content', 'role', 'tool_call_id'],
      ['content', 'role', 'tool_call_id'],
    ]);
  });
});
