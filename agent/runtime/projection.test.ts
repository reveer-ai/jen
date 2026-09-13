/**
 * The projection, which the whole suspend/resume model leans on.
 *
 * Two properties are under test and they are not the same one. *Determinism* is that the
 * same log projects to the same bytes every time — the property prompt caching depends on.
 * *Validity* is that what comes out is a conversation a provider will accept: an assistant
 * message's calls answered by the results immediately after it, and nothing left dangling.
 *
 * Byte comparison rather than deep equality throughout, because key order is part of what
 * is being claimed and `toEqual` cannot see it.
 */
import { describe, expect, it } from 'vitest';

import { answerInterrupted, type Event } from './events.js';
import { project } from './projection.js';

const AT = '2026-01-01T00:00:00.000Z';

function bytes(events: readonly Event[]): string {
  return JSON.stringify(project(events));
}

const CONVERSATION: Event[] = [
  { type: 'charter', at: AT, content: 'Find out what is in the repository.' },
  { type: 'message', at: AT, from: 'parent', content: 'Start.' },
  { type: 'reasoning', at: AT, content: 'I should look at the tree first.' },
  { type: 'tool_call', at: AT, id: 'call-1', name: 'fs.list', arguments: '{"path":"."}' },
  { type: 'tool_result', at: AT, id: 'call-1', content: 'README.md\npackage.json', ok: true, ms: 12 },
  { type: 'usage', at: AT, in: 480, out: 96, model: 'a-model' },
  { type: 'message', at: AT, from: 'self', content: 'Two files.' },
];

describe('a log becomes a conversation', () => {
  it('gives each event its role', () => {
    expect(project(CONVERSATION).map((message) => message.role)).toEqual([
      'system',
      'user',
      'assistant',
      'tool',
      'assistant',
    ]);
  });

  it('projects what a step cost into nothing at all', () => {
    const withoutUsage = CONVERSATION.filter((event) => event.type !== 'usage');
    expect(bytes(CONVERSATION)).toBe(bytes(withoutUsage));
  });

  it('never projects when an event happened', () => {
    const later = CONVERSATION.map((event) => ({ ...event, at: '2029-12-31T23:59:59.999Z' }));
    expect(bytes(CONVERSATION)).toBe(bytes(later));
  });

  // One message, not two. A provider requires an assistant message's calls to be answered
  // by the results that immediately follow it, so a run of calls cannot be split.
  it('folds a run of calls into one assistant message', () => {
    const parallel: Event[] = [
      { type: 'message', at: AT, from: 'parent', content: 'Look at both.' },
      { type: 'tool_call', at: AT, id: 'a', name: 'fs.read', arguments: '{"path":"one"}' },
      { type: 'tool_call', at: AT, id: 'b', name: 'fs.read', arguments: '{"path":"two"}' },
      { type: 'tool_result', at: AT, id: 'a', content: 'one', ok: true, ms: 1 },
      { type: 'tool_result', at: AT, id: 'b', content: 'two', ok: true, ms: 1 },
    ];

    const messages = project(parallel);
    expect(messages.map((message) => message.role)).toEqual(['user', 'assistant', 'tool', 'tool']);
    expect(messages[1]?.tool_calls?.map((call) => call.id)).toEqual(['a', 'b']);
  });

  // A model that says something *and* calls a capability has not ended its turn — the
  // content belongs to the same assistant message the calls do, or resume loses it.
  it('keeps content the model produced alongside its calls', () => {
    const both: Event[] = [
      { type: 'message', at: AT, from: 'parent', content: 'Go.' },
      { type: 'message', at: AT, from: 'self', content: 'Looking now.' },
      { type: 'tool_call', at: AT, id: 'a', name: 'fs.list', arguments: '{}' },
      { type: 'tool_result', at: AT, id: 'a', content: 'ok', ok: true, ms: 1 },
    ];

    const messages = project(both);
    expect(messages.map((message) => message.role)).toEqual(['user', 'assistant', 'tool']);
    expect(messages[1]?.content).toBe('Looking now.');
    expect(messages[1]?.tool_calls).toHaveLength(1);
  });

  it('answers every call it projects, and projects no answer to nothing', () => {
    const messages = project(CONVERSATION);
    const asked = messages.flatMap((message) => message.tool_calls ?? []).map((call) => call.id);
    const answered = messages.filter((message) => message.role === 'tool').map((message) => message.tool_call_id);
    expect(answered).toEqual(asked);
  });
});

describe('the projection does not vary between runs', () => {
  it('is byte-identical when a log is projected twice', () => {
    expect(bytes(CONVERSATION)).toBe(bytes(CONVERSATION));
  });

  // Reasoning is the part with a provider's own shape in it, so it is the part most likely
  // to be reordered or re-serialized by something along the way.
  it('is byte-identical for a log carrying reasoning content', () => {
    const reasoned: Event[] = [
      { type: 'message', at: AT, from: 'parent', content: 'Think.' },
      {
        type: 'reasoning',
        at: AT,
        content: 'A long chain of thought.',
        opaque: { reasoning_details: [{ type: 'reasoning.encrypted', data: 'AAAA' }], signature: 'zzz' },
      },
      { type: 'message', at: AT, from: 'self', content: 'Done.' },
    ];

    expect(bytes(reasoned)).toBe(bytes(reasoned));
    expect(bytes(reasoned)).toBe(JSON.stringify(project(structuredClone(reasoned))));
  });

  it('replays a provider’s representation verbatim and invents none where there is none', () => {
    const opaque = { reasoning_details: [{ type: 'reasoning.encrypted', data: 'AAAA' }] };
    const withShape = project([
      { type: 'reasoning', at: AT, content: 'text', opaque },
      { type: 'message', at: AT, from: 'self', content: 'Done.' },
    ]);
    expect(withShape[0]?.reasoning_details).toEqual(opaque.reasoning_details);

    const withoutShape = project([
      { type: 'reasoning', at: AT, content: 'text' },
      { type: 'message', at: AT, from: 'self', content: 'Done.' },
    ]);
    // The readable text is the transcript's, not the wire's. Nothing is made up for it.
    expect(JSON.stringify(withoutShape)).toBe(JSON.stringify([{ role: 'assistant', content: 'Done.' }]));
  });
});

describe('an interrupted call is answered, and answered once', () => {
  const interrupted: Event[] = [
    { type: 'message', at: AT, from: 'parent', content: 'Go.' },
    { type: 'tool_call', at: AT, id: 'call-1', name: 'spawn', arguments: '{"name":"child"}' },
  ];

  const now = () => '2026-02-02T00:00:00.000Z';

  it('leaves no call unanswered, which is what the provider demands', () => {
    const answered = answerInterrupted(interrupted, now);
    const messages = project(answered);
    const asked = messages.flatMap((message) => message.tool_calls ?? []).map((call) => call.id);
    const replies = messages.filter((message) => message.role === 'tool').map((message) => message.tool_call_id);
    expect(replies).toEqual(asked);
    expect(messages.at(-1)?.role).toBe('tool');
  });

  it('appends the answer as a real event rather than patching what is sent', () => {
    const answered = answerInterrupted(interrupted, now);
    expect(answered).toHaveLength(interrupted.length + 1);
    expect(answered.at(-1)).toMatchObject({ type: 'tool_result', id: 'call-1', ok: false });
  });

  it('does not add a second one on a further resume', () => {
    const once = answerInterrupted(interrupted, now);
    const twice = answerInterrupted(once, now);
    expect(twice).toEqual(once);
    expect(JSON.stringify(project(twice))).toBe(JSON.stringify(project(once)));
  });

  it('leaves a log whose calls are all answered exactly as it found it', () => {
    expect(answerInterrupted(CONVERSATION, now)).toEqual(CONVERSATION);
  });
});
