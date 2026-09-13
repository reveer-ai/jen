/**
 * Booting: what arrives, what it may not arrive in, and what happens when it arrives wrong.
 *
 * The shared-pipe half of this — that the frame survives the sandbox's credential delivery
 * — is in `sandbox/docker.test.ts`, against a real runtime, because it is a property of
 * what the prologue actually does with the descriptor rather than of anything here.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';

import { aRecord, says, scripted } from '../fixture.ts';
import { BootError, readBootFrame } from './boot.ts';
import { Runtime } from './index.ts';

function pipe(...chunks: string[]): Readable {
  return Readable.from(chunks.map((chunk) => Buffer.from(chunk, 'utf8')));
}

function bytes(...chunks: Buffer[]): Readable {
  return Readable.from(chunks);
}

function frame(body: Record<string, unknown>): string {
  return `${JSON.stringify(body)}\n`;
}

describe('the frame carries a record and a log, together', () => {
  it('reads them from one line', async () => {
    const events = [{ type: 'charter', at: '2026-01-01T00:00:00.000Z', content: 'Do the thing.' }];
    const read = await readBootFrame(pipe(frame({ record: aRecord(), events })));
    expect(read.record).toEqual(aRecord());
    expect(read.events).toEqual(events);
  });

  it('reads a frame that arrives split across several chunks', async () => {
    const whole = frame({ record: aRecord(), events: [] });
    const read = await readBootFrame(pipe(whole.slice(0, 7), whole.slice(7, 40), whole.slice(40)));
    expect(read.record.id).toBe(aRecord().id);
  });

  // The frame is on this channel precisely because a log grows without bound, so a large one
  // split across many chunks is the ordinary case rather than an edge — and it is the case
  // the reading has to stay linear over. The cost is what the note in `boot.ts` is about;
  // what is asserted here is that scanning only the arriving chunk finds the same line.
  it('reads a large frame arriving in many chunks, with the remainder left intact', async () => {
    const events = Array.from({ length: 20_000 }, (_, index) => ({
      type: 'message',
      at: '2026-01-01T00:00:00.000Z',
      from: 'self',
      content: `something the agent said, the ${index}th time`,
    }));
    const rest = '{"type":"stop"}\n';
    const whole = Buffer.from(frame({ record: aRecord(), events }) + rest, 'utf8');
    expect(whole.length).toBeGreaterThan(1_000_000);

    const chunks: Buffer[] = [];
    for (let at = 0; at < whole.length; at += 64 * 1024) chunks.push(whole.subarray(at, at + 64 * 1024));

    const input = bytes(...chunks);
    const read = await readBootFrame(input);
    expect(read.events).toHaveLength(events.length);
    expect(read.events.at(-1)).toEqual(events.at(-1));

    let remaining = '';
    for await (const chunk of input) remaining += String(chunk);
    expect(remaining).toBe(rest);
  });

  // A newline is one byte and cannot hide inside a multi-byte sequence, which is what makes
  // scanning chunk by chunk safe — but the decoding still has to happen after the join and
  // not before it, so a character split across the boundary is worth holding down.
  it('reads a frame whose chunk boundary falls inside a character', async () => {
    const whole = Buffer.from(frame({ record: aRecord({ charter: 'Ich muss das Ähnliche prüfen.' }), events: [] }));
    const split = whole.indexOf(Buffer.from('Ä', 'utf8')) + 1;
    expect(split).toBeGreaterThan(0);

    const read = await readBootFrame(bytes(whole.subarray(0, split), whole.subarray(split)));
    expect(read.record.charter).toBe('Ich muss das Ähnliche prüfen.');
  });

  // What follows the frame is the line protocol the supervisor and the runtime converse
  // over. Consuming a byte of it here would swallow the start of that conversation.
  it('leaves everything after the line where it was', async () => {
    const rest = '{"type":"message"}\n{"type":"stop"}\n';
    const input = pipe(frame({ record: aRecord(), events: [] }) + rest);
    await readBootFrame(input);

    let remaining = '';
    for await (const chunk of input) remaining += String(chunk);
    expect(remaining).toBe(rest);
  });
});

describe('an empty log is valid and means an agent that has not yet run', () => {
  it('is accepted as an empty array', async () => {
    expect((await readBootFrame(pipe(frame({ record: aRecord(), events: [] })))).events).toEqual([]);
  });

  it('is accepted as no log at all, which says the same thing', async () => {
    expect((await readBootFrame(pipe(frame({ record: aRecord() })))).events).toEqual([]);
  });

  it('constructs a runtime that begins its first turn', async () => {
    const runtime = new Runtime({ record: aRecord(), events: [], client: scripted([says('Hello.')]) });
    await expect(runtime.turn('Begin.')).resolves.toBe('Hello.');
  });
});

describe('a malformed frame fails before any model call is made', () => {
  // The model client is a scripted one that would record having been asked. Nothing here
  // gets far enough to ask it, and that is the assertion.
  const client = scripted([says('should never be reached')]);

  const broken: [string, string, RegExp][] = [
    ['a line that is not JSON', 'not json at all\n', /not valid JSON/],
    ['a frame that is not an object', '"a string"\n', /not an object/],
    ['a frame with no record', frame({ events: [] }), /record is not an object/],
    ['a record missing a field', frame({ record: { ...aRecord(), charter: undefined } }), /record\.charter is missing/],
    [
      'a log with an event of no known type',
      frame({ record: aRecord(), events: [{ type: 'invented', at: '2026-01-01T00:00:00.000Z' }] }),
      /events\[0\]\.type is "invented"/,
    ],
    [
      'a log whose event has no timestamp',
      frame({ record: aRecord(), events: [{ type: 'charter', content: 'x' }] }),
      /events\[0\]\.at is missing/,
    ],
    [
      // The flag is written only as `true`; anything else is a log this runtime did not
      // write, and reading it as truthy would replay an ordinary message as a refusal.
      'a message flagged as a refusal with anything but true',
      frame({
        record: aRecord(),
        events: [{ type: 'message', at: '2026-01-01T00:00:00.000Z', from: 'self', content: 'x', refusal: 'yes' }],
      }),
      /events\[0\]\.refusal is present and is not true/,
    ],
  ];

  for (const [description, text, message] of broken) {
    it(`refuses ${description}, naming what it could not read`, async () => {
      await expect(readBootFrame(pipe(text))).rejects.toThrow(message);
      expect(client.taken).toBe(0);
    });
  }

  // The realistic failure: something upstream consumed part of the line, or the channel
  // ended early. Both have to say so rather than reporting a record the supervisor never
  // wrote.
  it('refuses a frame whose line never ended', async () => {
    await expect(readBootFrame(pipe('{"record":'))).rejects.toThrow(BootError);
    await expect(readBootFrame(pipe('{"record":'))).rejects.toThrow(/incomplete.*no line ending/);
  });

  it('refuses a channel that carried nothing at all', async () => {
    await expect(readBootFrame(pipe())).rejects.toThrow(/missing.*ended before anything arrived/);
  });
});

describe('the entry point takes nothing from the command line', () => {
  const SOURCE = readFileSync(join(import.meta.dirname, 'main.ts'), 'utf8');
  const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  it('never reads argv', () => {
    expect(CODE).not.toMatch(/process\.argv|parseArgs|minimist|commander|yargs/);
  });

  it('reads the frame from standard input', () => {
    expect(CODE).toContain('readBootFrame(process.stdin)');
  });
});
