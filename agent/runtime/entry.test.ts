/**
 * The program, end to end: a frame in on standard input, a turn taken against a real
 * OpenAI-compatible endpoint, a line out.
 *
 * Everything else here runs the loop against a scripted client, which is right for the
 * properties those tests are about. It leaves one seam untested — the client itself, and
 * what it carries out of a completion — and that seam is the one place a mistake would be
 * invisible to every other test in this directory. So this runs the real entry point as a
 * real subprocess against a local server speaking the provider's wire format.
 *
 * A local server rather than a live model: the wire format is what is under test, and a
 * live model would make it non-deterministic for reasons unrelated to any of it. It is also
 * the acceptance case the task names — a runtime that runs its loop to completion with an
 * empty capability set, an agent that thinks and does nothing else.
 */
import { execFile } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { aRecord } from '../fixture.ts';

import type { AddressInfo } from 'node:net';

const ENTRY = join(import.meta.dirname, 'main.ts');

/** Every request body the stub received, in order. */
let received: Record<string, unknown>[] = [];
let server: Server;
let baseURL = '';

/**
 * What the stub replies with. An ordinary message unless a test says otherwise.
 *
 * `refusal` and `annotations` are here because OpenAI puts them on an ordinary reply, and a
 * stub tidier than the thing it stands for is a stub that cannot fail. This one omitted
 * them, and the rule that mistook every unprojected field for the provider's reasoning
 * passed this suite all the way to review while writing phantom reasoning events and
 * echoing `annotations` back at whatever gateway `baseURL` named.
 */
const ORDINARY = {
  role: 'assistant',
  content: 'There is nothing here but thought.',
  refusal: null,
  annotations: [],
};

let reply: Record<string, unknown> = ORDINARY;

/** One completion carrying `reply` whole, as a gateway answers a request that did not stream. */
function completion(): string {
  return JSON.stringify({
    id: 'c-1',
    object: 'chat.completion',
    created: 1,
    model: 'stub-model',
    choices: [{ index: 0, message: reply, finish_reason: 'stop' }],
    usage: { prompt_tokens: 31, completion_tokens: 7, total_tokens: 38 },
  });
}

/**
 * The same reply streamed, one delta per field, ending the way a gateway ends.
 *
 * The runtime does not ask for this and the reason it does not is in `model.ts`: the SDK's
 * accumulator overwrites every field outside the standard set with each successive delta, so
 * a streamed extension arrives as its last piece. Serving it keeps the stub honest — a
 * process that starts streaming again meets what the wire really does, here as well as in
 * `model.test.ts`, rather than a stub tidy enough to pass either way.
 */
function streamed(): string {
  const head = { id: 'c-1', object: 'chat.completion.chunk', created: 1, model: 'stub-model' };
  const standard = new Set(['role', 'content', 'refusal', 'function_call', 'tool_calls', 'audio']);
  const first: Record<string, unknown> = {};
  const rest: Record<string, unknown>[] = [];

  for (const [key, value] of Object.entries(reply)) {
    if (standard.has(key)) first[key] = value;
    else if (typeof value === 'string') {
      for (const character of value) rest.push({ [key]: character });
      rest.push({ [key]: null });
    } else rest.push({ [key]: value });
  }

  return [
    ...[first, ...rest].map(
      (delta) => `data: ${JSON.stringify({ ...head, choices: [{ index: 0, delta, finish_reason: null }] })}`,
    ),
    `data: ${JSON.stringify({
      ...head,
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      usage: { prompt_tokens: 31, completion_tokens: 7, total_tokens: 38 },
    })}`,
    'data: [DONE]',
    '',
    '',
  ].join('\n\n');
}

beforeAll(async () => {
  server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => (body += String(chunk)));
    request.on('end', () => {
      const sent = JSON.parse(body) as { stream?: boolean };
      received.push({ path: request.url, authorization: request.headers.authorization, body: sent });

      if (sent.stream === true) {
        response.writeHead(200, { 'content-type': 'text/event-stream' });
        response.end(streamed());
      } else {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(completion());
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  received = [];
  reply = ORDINARY;
});

function run(frame: string, environment: NodeJS.ProcessEnv = {}) {
  return new Promise<{ stdout: string; stderr: string; code: number }>((resolve) => {
    const child = execFile(
      process.execPath,
      [ENTRY],
      { env: { ...process.env, ...environment } },
      (error, stdout, stderr) => {
        resolve({ stdout, stderr, code: (error as { code?: number } | null)?.code ?? 0 });
      },
    );
    child.stdin?.end(frame);
  });
}

function frameFor(overrides: Parameters<typeof aRecord>[0] = {}, events: unknown[] = []): string {
  const record = aRecord({ model: { ...aRecord().model, baseURL, model: 'stub-model' }, ...overrides });
  return `${JSON.stringify({ record, events })}\n`;
}

describe('an agent that thinks and does nothing else', () => {
  it('boots from a frame, takes a turn, and writes its message out', async () => {
    const result = await run(frameFor(), { MODEL_API_KEY: 'sk-stub' });

    expect(result.stderr).toBe('');
    expect(result.code).toBe(0);

    const out = JSON.parse(result.stdout) as { message: string; events: { type: string }[] };
    expect(out.message).toBe('There is nothing here but thought.');
    expect(out.events.map((event) => event.type)).toEqual(['charter', 'message', 'usage']);
  });

  it('sends the charter and offers no tools, because its record names none', async () => {
    await run(frameFor(), { MODEL_API_KEY: 'sk-stub' });

    const sent = received[0]?.body as { messages: { role: string; content: string }[]; tools?: unknown };
    expect(sent.messages).toEqual([{ role: 'system', content: aRecord().charter }]);
    expect(sent.tools).toBeUndefined();
  });

  it('authenticates with the credential the record named, taken from the environment', async () => {
    await run(frameFor(), { MODEL_API_KEY: 'sk-stub' });
    expect(received[0]?.authorization).toBe('Bearer sk-stub');
  });

  /**
   * The whole completion, not a stream of it — asserted where the real process sends it.
   *
   * `model.test.ts` guards this over the source; this is the same rule seen from the other
   * end of the wire, on the request a subprocess actually put on it. The pair is worth having
   * because the defect underneath was found only on a live gateway: streamed, an extension
   * field arrives in pieces the SDK's accumulator overwrites rather than joins.
   */
  it('asks the provider for the whole completion rather than a stream of it', async () => {
    await run(frameFor(), { MODEL_API_KEY: 'sk-stub' });
    expect((received[0]?.body as { stream?: boolean }).stream).toBeUndefined();
  });

  it('carries a provider’s reasoning into the log entire, not its last fragment', async () => {
    reply = { ...ORDINARY, reasoning: 'weighing it up, '.repeat(500) };
    const result = await run(frameFor(), { MODEL_API_KEY: 'sk-stub' });

    const out = JSON.parse(result.stdout) as { events: Record<string, unknown>[] };
    const reasoning = out.events.find((event) => event.type === 'reasoning');
    expect(reasoning?.content).toBe(reply.reasoning);
    expect((reasoning?.opaque as Record<string, unknown> | undefined)?.reasoning).toBe(reply.reasoning);
  });

  it('records what the step cost, from what the provider reported', async () => {
    const result = await run(frameFor(), { MODEL_API_KEY: 'sk-stub' });
    const out = JSON.parse(result.stdout) as { events: Record<string, unknown>[] };
    expect(out.events.at(-1)).toMatchObject({ type: 'usage', in: 31, out: 7, model: 'stub-model' });
  });

  // The log it emits is what a supervisor would hand back on a resume, so it has to be
  // enough on its own to continue from.
  it('continues from the log it emitted last time', async () => {
    const first = JSON.parse((await run(frameFor(), { MODEL_API_KEY: 'sk-stub' })).stdout) as { events: unknown[] };
    const second = await run(frameFor({}, first.events), { MODEL_API_KEY: 'sk-stub' });

    expect(second.code).toBe(0);
    const sent = received[1]?.body as { messages: Record<string, unknown>[] };
    expect(sent.messages.map((message) => message.role)).toEqual(['system', 'assistant']);

    // What goes back out is the whole point: the assistant message the runtime replays
    // carries the two fields the projection produces and not one field more. A response
    // field that rode along here would be going to a real gateway against a request schema
    // that does not define it, and every other test in this directory would stay green.
    expect(Object.keys(sent.messages[1] ?? {})).toEqual(['role', 'content']);
  });
});

/**
 * The model declining, all the way through: the real client, the real entry point, the log
 * it emits, and what that log sends back.
 *
 * Every `refusal` in this directory was `null` until this test, which is how a fix that
 * dropped a non-null one reached review with the suite green. It is the case the scripted
 * client cannot stand in for, because the question is what the wire format does with it.
 */
describe('a model that declines is still an agent that answered', () => {
  const DECLINED = { role: 'assistant', content: null, refusal: 'I will not do that.', annotations: [] };

  it('writes the refusal out as its message rather than an empty string', async () => {
    reply = DECLINED;
    const result = await run(frameFor(), { MODEL_API_KEY: 'sk-stub' });

    expect(result.stderr).toBe('');
    const out = JSON.parse(result.stdout) as { message: string; events: Record<string, unknown>[] };
    expect(out.message).toBe('I will not do that.');
    expect(out.events).toMatchObject([
      { type: 'charter' },
      { type: 'message', from: 'self', content: 'I will not do that.', refusal: true },
      { type: 'usage' },
    ]);
  });

  it('replays it from that log in the field it arrived in, and in no other', async () => {
    reply = DECLINED;
    const first = JSON.parse((await run(frameFor(), { MODEL_API_KEY: 'sk-stub' })).stdout) as { events: unknown[] };
    const second = await run(frameFor({}, first.events), { MODEL_API_KEY: 'sk-stub' });

    expect(second.code).toBe(0);
    const sent = received[1]?.body as { messages: Record<string, unknown>[] };
    expect(sent.messages[1]).toEqual({ role: 'assistant', content: null, refusal: 'I will not do that.' });
  });
});

describe('a failure at the entry point says what it was, and not in a stack trace', () => {
  it('reports a credential that was not delivered', async () => {
    const result = await run(frameFor(), { MODEL_API_KEY: '' });
    expect(result.code).toBe(1);
    expect(result.stderr.trim()).toMatch(/^the credential `MODEL_API_KEY` was not delivered/);
    expect(result.stderr).not.toContain('    at ');
  });

  it('reports a record it could not read, naming the field', async () => {
    const incomplete = { ...aRecord({ model: { ...aRecord().model, baseURL, model: 'stub-model' } }), name: undefined };
    const result = await run(`${JSON.stringify({ record: incomplete })}\n`, { MODEL_API_KEY: 'sk-stub' });
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/record\.name is missing/);
  });

  it('reports a capability its record names that it cannot resolve', async () => {
    const result = await run(frameFor({ tools: ['fs'] }), { MODEL_API_KEY: 'sk-stub' });
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/"fs"/);
  });
});
