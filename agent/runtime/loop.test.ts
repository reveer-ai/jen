/**
 * The loop, and the turn boundary that is the whole of an agent's completion signal.
 *
 * Everything here runs against the scripted client. The property under test is what the
 * runtime *does with what it is given*, and a live model would make that non-deterministic
 * for reasons unrelated to any of it.
 */
import { describe, expect, it } from 'vitest';

import { aCall, aCapability, aRecord, asks, says, scripted } from '../fixture.ts';
import { Runtime } from './index.ts';

const CLOCK = () => 1_767_225_600_000;

function runtime(script: Parameters<typeof scripted>[0], overrides: Partial<Parameters<typeof aRecord>[0]> = {}) {
  const client = scripted(script);
  return {
    client,
    agent: new Runtime({
      record: aRecord({ tools: ['fs'], ...overrides }),
      capabilities: [aCapability('fs')],
      client,
      clock: CLOCK,
    }),
  };
}

describe('a turn ends on content with nothing outstanding', () => {
  it('returns that content as the message to the parent', async () => {
    const { agent, client } = runtime([says('There are two files.')]);
    await expect(agent.turn('What is here?')).resolves.toBe('There are two files.');
    expect(client.taken).toBe(1);
  });

  it('writes the agent’s own words into the log as its message', async () => {
    const { agent } = runtime([says('Done.')]);
    await agent.turn('Go.');
    expect(agent.events.filter((event) => event.type === 'message')).toMatchObject([
      { from: 'parent', content: 'Go.' },
      { from: 'self', content: 'Done.' },
    ]);
  });

  // No status field, no completion channel, nothing the agent writes to announce it has
  // finished. The content with nothing outstanding is the entire signal.
  it('records nothing else that could be read as a completion signal', async () => {
    const { agent } = runtime([says('Done.')]);
    await agent.turn('Go.');
    const types = new Set(agent.events.map((event) => event.type));
    expect([...types].sort()).toEqual(['charter', 'message', 'usage']);
  });
});

describe('a step continues when capabilities are called', () => {
  it('dispatches each one, appends its result, and takes another step', async () => {
    const { agent, client } = runtime([asks(aCall('c1', 'fs', { path: '.' })), says('Two files.')]);
    await expect(agent.turn('What is here?')).resolves.toBe('Two files.');

    expect(client.taken).toBe(2);
    expect(agent.events.map((event) => event.type)).toEqual([
      'charter',
      'message',
      'tool_call',
      'usage',
      'tool_result',
      'message',
      'usage',
    ]);
    // Asserting the result succeeded, so this cannot pass on a dispatch that failed and
    // was recorded as a result anyway — which is what a missing registration looks like.
    expect(agent.events.filter((event) => event.type === 'tool_result')).toMatchObject([{ ok: true }]);
  });

  it('hands the capability the arguments the model produced', async () => {
    const capability = aCapability('fs');
    const agent = new Runtime({
      record: aRecord({ tools: ['fs'] }),
      capabilities: [capability],
      client: scripted([asks(aCall('c1', 'fs', { path: 'README.md' })), says('Read it.')]),
      clock: CLOCK,
    });
    await agent.turn('Go.');
    expect(capability.inputs).toEqual([{ path: 'README.md' }]);
  });

  it('carries the results back into what the next step sends', async () => {
    const { agent } = runtime([asks(aCall('c1', 'fs')), says('Two files.')]);
    await agent.turn('Go.');
    const messages = agent.request().messages;
    expect(messages.filter((message) => message.role === 'tool')).toMatchObject([{ content: 'done' }]);
  });
});

describe('a runtime holding no capabilities is valid', () => {
  it('reasons and produces a message to its parent, offering no tools at all', async () => {
    const agent = new Runtime({ record: aRecord({ tools: [] }), client: scripted([says('I thought about it.')]), clock: CLOCK });
    await expect(agent.turn('Think.')).resolves.toBe('I thought about it.');
    expect(agent.request().tools).toBeUndefined();
  });

  it('fails construction when its record names one that cannot be resolved', () => {
    expect(() => new Runtime({ record: aRecord({ tools: ['spawn'] }), client: scripted([]) })).toThrow(/"spawn"/);
  });

  it('does not begin a turn with a reduced set instead', async () => {
    const client = scripted([says('Done.')]);
    expect(() => new Runtime({ record: aRecord({ tools: ['fs', 'spawn'] }), capabilities: [aCapability('fs')], client })).toThrow();
    expect(client.taken).toBe(0);
  });
});

describe('the charter opens the conversation', () => {
  it('seeds it into an empty log, as the agent’s first event', async () => {
    const { agent } = runtime([says('Done.')]);
    expect(agent.events[0]).toMatchObject({ type: 'charter', content: aRecord().charter });
  });

  it('does not seed a second one into a log that already carries it', () => {
    const client = scripted([]);
    const first = new Runtime({ record: aRecord(), client, clock: CLOCK });
    const resumed = new Runtime({ record: aRecord(), events: first.events, client, clock: CLOCK });
    expect(resumed.events.filter((event) => event.type === 'charter')).toHaveLength(1);
  });
});

/**
 * The runtime is identical at every depth, and nothing here branches on `parent`. The test
 * is a comparison rather than an assertion about a field, because "no branch distinguishes
 * them" is a claim about behaviour and not about a value.
 */
describe('the root’s runtime holds nothing extra', () => {
  it('sends the same request and runs the same loop as one constructed at depth', async () => {
    const script = [asks(aCall('c1', 'fs')), says('Done.')];
    const root = runtime(script, { parent: null });
    const child = runtime(script, { parent: 'agent-0' });

    await expect(root.agent.turn('Go.')).resolves.toBe('Done.');
    await expect(child.agent.turn('Go.')).resolves.toBe('Done.');

    expect(root.client.requests).toEqual(child.client.requests);
    expect(root.agent.events).toEqual(child.agent.events);
  });

  it('offers the same operations to both', () => {
    const root = runtime([], { parent: null }).agent;
    const child = runtime([], { parent: 'agent-0' }).agent;
    const operations = (agent: Runtime) =>
      Object.getOwnPropertyNames(Object.getPrototypeOf(agent) as object).sort();
    expect(operations(root)).toEqual(operations(child));
    expect(operations(root)).toEqual(['constructor', 'events', 'request', 'run', 'turn']);
  });

  // The runtime implements none of them. `spawn` and the rest arrive as capabilities like
  // anything else, which is what keeps a runtime from holding authority one below it lacks.
  it('names no operation that provisions, destroys, or routes', () => {
    const operations = Object.getOwnPropertyNames(Runtime.prototype).join(' ');
    expect(operations).not.toMatch(/spawn|send|await|stop|sandbox|provision|destroy|route/i);
  });
});

/**
 * The log is the substrate's only verification surface: a parent that cannot reconstruct
 * what a child did from it has no way to catch a confident lie, and a claim an agent writes
 * about itself is exactly as forgeable as the prose beside it. What makes that possible is
 * the part the provider's message array cannot carry — when a step happened, what it cost,
 * and how each invocation went.
 */
describe('the log carries what the message array cannot', () => {
  it('records when each step occurred and what it cost in tokens', async () => {
    const client = scripted([
      { content: '', calls: [aCall('c1', 'fs')], usage: { in: 412, out: 17, model: 'a-model' } },
      { content: 'Done.', usage: { in: 480, out: 4, model: 'a-model' } },
    ]);
    const agent = new Runtime({
      record: aRecord({ tools: ['fs'] }),
      capabilities: [aCapability('fs')],
      client,
      clock: CLOCK,
    });
    await agent.turn('Go.');

    expect(agent.events.filter((event) => event.type === 'usage')).toEqual([
      { type: 'usage', at: new Date(CLOCK()).toISOString(), in: 412, out: 17, model: 'a-model' },
      { type: 'usage', at: new Date(CLOCK()).toISOString(), in: 480, out: 4, model: 'a-model' },
    ]);
    expect(agent.events.every((event) => typeof event.at === 'string' && !Number.isNaN(Date.parse(event.at)))).toBe(true);
  });

  it('records each invocation’s duration and whether it succeeded', async () => {
    let tick = 0;
    const agent = new Runtime({
      record: aRecord({ tools: ['fs', 'boom'] }),
      capabilities: [
        aCapability('fs'),
        aCapability('boom', () => {
          throw new Error('no');
        }),
      ],
      client: scripted([asks(aCall('c1', 'fs'), aCall('c2', 'boom')), says('Done.')]),
      // Advances once per reading, so a duration that was never measured reads as zero.
      clock: () => 1_767_225_600_000 + tick++ * 5,
    });
    await agent.turn('Go.');

    expect(agent.events.filter((event) => event.type === 'tool_result')).toMatchObject([
      { id: 'c1', ok: true, ms: 5 },
      { id: 'c2', ok: false, ms: 5 },
    ]);
  });

  // None of it reaches the model. The transcript is richer than the conversation, which is
  // the whole reason it is stored as events rather than as what was sent.
  it('sends none of it to the model', async () => {
    const client = scripted([says('Done.')]);
    const agent = new Runtime({ record: aRecord({ tools: [] }), client, clock: CLOCK });
    await agent.turn('Go.');
    expect(client.requests[0]).not.toMatch(/"at"|"ms"|"ok"|"usage"|tokens/);
  });
});
