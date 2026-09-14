/**
 * The model seam: where the credential comes from, and what the client is not allowed to do
 * for us.
 *
 * The second half is a source-level guard rather than a behavioural test, for the same
 * reason the sandbox guards its own absence of `node:fs`: if the loop were handed to the
 * client's runner, everything would still work. The tests would pass, the agent would
 * answer, and the substrate's central decision — that the agent's loop is the agent's —
 * would have been given away invisibly. Nothing behavioural can see that.
 */
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';
import OpenAI from 'openai';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { aRecord } from '../fixture.ts';
import { ModelError, openAIClient, type ModelStep } from './model.ts';
import { project } from './projection.ts';

import type { AddressInfo } from 'node:net';

const SOURCE = readFileSync(join(import.meta.dirname, 'model.ts'), 'utf8');

/**
 * The file with its prose removed.
 *
 * The prose has to be free to name the facilities it is explaining the absence of — a
 * module that could not say why it avoids `runTools` would lose the reason, and the reason
 * is the only thing keeping it avoided.
 */
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('the client’s loop-running facilities are not used', () => {
  // Every one of these dispatches tool calls and takes the next step on its own.
  for (const facility of [
    'runTools',
    'runFunctions',
    'ChatCompletionRunner',
    'ChatCompletionStreamingRunner',
    'AbstractChatCompletionRunner',
    'RunnableFunction',
    'maxChatCompletions',
    'afterCompletion',
  ]) {
    it(`never reaches for ${facility}`, () => {
      expect(CODE).not.toContain(facility);
    });
  }

  it('takes exactly one step per call and returns it', () => {
    // One `create(` — a second would be a loop spelled out by hand, which is the same
    // delegation wearing different clothes.
    expect(CODE.match(/\.create\(/g)).toHaveLength(1);
  });

  /**
   * And it does not stream, which is a correctness rule rather than a preference.
   *
   * The SDK's accumulator overwrites every field outside the standard set with each
   * successive delta, and that set is exactly what `opaque` is built from — see the block at
   * the bottom of this file, which demonstrates it against the same server. A step that
   * streams replays a fraction of a provider's reasoning and nothing says so.
   */
  it('never asks for a streamed completion', () => {
    expect(CODE).not.toContain('.stream(');
    expect(CODE).not.toContain('stream:');
  });

  /**
   * And having stopped streaming, it states its own deadline instead of inheriting one.
   *
   * Source-level for the same reason as everything above it: nothing behavioural can see
   * this. Not streaming is what makes the body read raced at all, so deleting either option
   * restores the SDK's ten minutes and, with it, a long generation produced and billed three
   * times before the caller hears anything — with every test in this suite still green,
   * because no test here runs long enough to reach any deadline, inherited or chosen.
   */
  it('states the step deadline and the retry count rather than inheriting them', () => {
    expect(CODE).toContain('timeout: STEP_DEADLINE_MS');
    expect(CODE).toMatch(/maxRetries:\s*\d/);
  });
});

describe('the credential is read from the environment, never from the record', () => {
  it('builds a client when the named credential was delivered', () => {
    const record = aRecord();
    expect(openAIClient(record, { MODEL_API_KEY: 'sk-test' })).toBeDefined();
  });

  it('fails when it was not, naming the variable and not a value', () => {
    const record = aRecord();
    expect(() => openAIClient(record, {})).toThrow(ModelError);
    expect(() => openAIClient(record, {})).toThrow(/MODEL_API_KEY/);
  });

  it('reads nothing resembling a secret out of the record itself', () => {
    // The record names the credential; it does not carry it. Were that ever to change, the
    // record would stop being safe to persist beside the project.
    const record = aRecord();
    expect(JSON.stringify(record)).not.toContain('sk-');
    expect(() => openAIClient(record, {})).toThrow();
  });
});

/**
 * What a real gateway hands back, and what is carried out of it.
 *
 * **This block exists because a scripted double could not see the bug it is about.** An
 * ordinary OpenAI reply carries `refusal` and `annotations` whether or not anything used
 * them, and a rule that treated every unprojected field as the provider's reasoning read
 * them as reasoning — writing a `reasoning` event for a reply containing none, and echoing
 * `annotations` onto the assistant message of every later request. The resume comparison
 * stayed green throughout, because its live and resumed paths were wrong identically; that
 * is the blind spot byte-identity has by construction. So these run the real client against
 * a local server speaking the wire format, with messages shaped the way a gateway shapes
 * them.
 */
describe('what is carried back from a completion', () => {
  let server: Server;
  let baseURL = '';
  let reply: Record<string, unknown> = {};

  /** One completion carrying `reply` whole, as a gateway answers a request that did not stream. */
  function unstreamed(): string {
    return JSON.stringify({
      id: 'c-1',
      object: 'chat.completion',
      created: 1,
      model: 'stub-model',
      choices: [{ index: 0, message: reply, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
    });
  }

  /**
   * The fields `ChatCompletionStream` accumulates by name.
   *
   * `content` and `refusal` are concatenated, `tool_calls` and `audio` have accumulators of
   * their own, and everything else goes through `Object.assign` — so the set below is the
   * one a delta can safely carry a piece of, and every other field is last-wins. It is the
   * SDK's set rather than `model.ts`'s: `annotations` is standard on a response and is still
   * overwritten, because the accumulator has never heard of it.
   */
  const ACCUMULATED = new Set(['role', 'content', 'refusal', 'function_call', 'tool_calls', 'audio']);

  /**
   * The same reply as the wire delivers it when streaming, which is not tidily.
   *
   * A gateway sends an extension field **a piece at a time across hundreds of deltas**, and
   * `reasoning` ends on a `null`. A stub that puts the whole field in one delta cannot tell
   * last-wins from accumulate-properly apart — which is how 8,106 characters of reasoning
   * reached the log as 2 with every test in this directory green. Nothing in the substrate
   * asks for this any more; it is served so that anything which starts asking again meets
   * the wire's real behaviour rather than a stub's.
   */
  function streamed(): string {
    const head = { id: 'c-1', object: 'chat.completion.chunk', created: 1, model: 'stub-model' };
    const first: Record<string, unknown> = {};
    const rest: Record<string, unknown>[] = [];

    for (const [key, value] of Object.entries(reply)) {
      if (ACCUMULATED.has(key)) {
        first[key] = value;
      } else if (typeof value === 'string') {
        // One character per delta, the way tokens arrive, and the `null` a gateway ends on.
        for (const character of value) rest.push({ [key]: character });
        rest.push({ [key]: null });
      } else if (Array.isArray(value)) {
        // The parts of an array extension arrive keyed by `index`, one part per delta.
        value.forEach((part, index) => rest.push({ [key]: [{ index, ...(part as object) }] }));
      } else {
        rest.push({ [key]: value });
      }
    }

    return [
      ...[first, ...rest].map(
        (delta) => `data: ${JSON.stringify({ ...head, choices: [{ index: 0, delta, finish_reason: null }] })}`,
      ),
      `data: ${JSON.stringify({
        ...head,
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
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
        // The reply's shape follows the request's, as a gateway's does. Nothing here decides
        // for the client which one it gets.
        if ((JSON.parse(body) as { stream?: boolean }).stream === true) {
          response.writeHead(200, { 'content-type': 'text/event-stream' });
          response.end(streamed());
        } else {
          response.writeHead(200, { 'content-type': 'application/json' });
          response.end(unstreamed());
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  function step(message: Record<string, unknown>): Promise<ModelStep> {
    reply = message;
    const record = aRecord({ model: { ...aRecord().model, baseURL, model: 'stub-model' } });
    return openAIClient(record, { MODEL_API_KEY: 'sk-stub' }).step(
      { model: 'stub-model', messages: [] },
      new AbortController().signal,
    );
  }

  /** An ordinary reply, as OpenAI itself sends one. Both extra fields are the standard's. */
  const ORDINARY = { role: 'assistant', content: 'There is nothing here but thought.', refusal: null, annotations: [] };

  it('writes no reasoning for a reply that contains none', async () => {
    // Not merely empty: absent. A transcript is the substrate's verification surface, and
    // one showing a reasoning step that never happened is worse than one showing nothing.
    expect((await step(ORDINARY)).reasoning).toBeNull();
    expect((await step({ role: 'assistant', content: 'hi', refusal: null, reasoning: null })).reasoning).toBeNull();
  });

  /**
   * A refusal is the one standard field this reads, and it has to survive.
   *
   * The rule above excludes it from `opaque` because it is the standard's field rather than
   * a provider's extension — correct, and it left the text with nowhere to go until it was
   * carried here. A refusal that vanishes gives the parent an empty answer and takes the
   * turn out of the model's own history on the next step, which is the least diagnosable
   * failure either of them could be handed.
   */
  it('carries a refusal as what the model said, nowhere near the reasoning', async () => {
    const declined = { ...ORDINARY, content: null, refusal: 'I will not do that.' };
    const carried = await step(declined);

    expect(carried.refusal).toBe('I will not do that.');
    expect(carried.content).toBe('');
    expect(carried.reasoning).toBeNull();
  });

  it('marks nothing else as a refusal, an empty one included', async () => {
    expect((await step(ORDINARY)).refusal).toBeNull();
    // A gateway that spells "did not refuse" as an empty string rather than as null would
    // otherwise produce a refusal with nothing in it — an answer flagged as declined that
    // says why in no words at all.
    expect((await step({ ...ORDINARY, refusal: '' })).refusal).toBeNull();
  });

  it('carries a searching gateway’s citations nowhere near the reasoning', async () => {
    const annotated = {
      ...ORDINARY,
      annotations: [
        { type: 'url_citation', url_citation: { url: 'https://example.test', title: 't', start_index: 0, end_index: 1 } },
      ],
    };
    expect((await step(annotated)).reasoning).toBeNull();
  });

  it('keeps every field of the provider’s own reasoning, and reads the text out of it', async () => {
    const thinking = {
      ...ORDINARY,
      reasoning: 'weighing it up',
      reasoning_details: [{ type: 'reasoning.encrypted', data: 'AAAA' }],
    };
    const { reasoning } = await step(thinking);

    expect(reasoning?.content).toBe('weighing it up');
    // Both fields, `reasoning` included, even though its text is also the readable content.
    // That is not an oversight: `agent-runtime` requires provider reasoning to be replayed
    // *without being interpreted*, and withholding a field because we found it readable is
    // an interpretation — one that would silently drop the only reasoning representation a
    // provider offering nothing but the text has.
    expect(reasoning?.opaque).toEqual({
      reasoning: thinking.reasoning,
      reasoning_details: thinking.reasoning_details,
    });
  });

  /**
   * The defect a live gateway found, and the only shape that can show it.
   *
   * OpenRouter sent 8,106 characters of `reasoning` across 1,200 deltas and 2 of them
   * reached the log, with `reasoning_details` arriving as its last fragment alone. Every
   * stub in this directory delivered an extension in one delta, where last-wins and
   * accumulate-properly are indistinguishable — so nothing could fail. The stub above now
   * splits one the way the wire does, which makes this test red for any step that goes back
   * to streaming without owning the merge itself.
   */
  it('keeps an extension whole, however many pieces the wire sends it in', async () => {
    const thinking = {
      ...ORDINARY,
      reasoning: 'weighing it up, '.repeat(500),
      reasoning_details: [
        { type: 'reasoning.text', text: 'the readable part' },
        { type: 'reasoning.encrypted', data: 'AAAA' },
      ],
    };
    const { reasoning } = await step(thinking);

    expect(reasoning?.content).toBe(thinking.reasoning);
    expect(reasoning?.opaque).toEqual({
      reasoning: thinking.reasoning,
      reasoning_details: thinking.reasoning_details,
    });
  });

  /**
   * What streaming would cost, kept executable rather than only written down.
   *
   * This asserts a property of the pinned SDK, not of our code: `ChatCompletionStream`
   * accumulates the standard fields by name and `Object.assign`s the rest, so an extension
   * ends up as whatever its final delta said — `null`, here, because that is what a gateway
   * ends on. It is the whole reason `model.ts` does not stream. Should it ever go red, the
   * accumulator has learned to merge extensions and the trade-off is worth re-opening.
   */
  it('loses all but the last delta of an extension when the same reply is streamed', async () => {
    reply = {
      ...ORDINARY,
      reasoning: 'weighing it up at length',
      reasoning_details: [{ type: 'reasoning.text', text: 'the readable part' }, { type: 'reasoning.encrypted' }],
    };

    const accumulated = await new OpenAI({ baseURL, apiKey: 'sk-stub' }).chat.completions
      .stream({ model: 'stub-model', messages: [] })
      .finalChatCompletion();
    const message = accumulated.choices[0]?.message as unknown as Record<string, unknown>;

    expect(message.reasoning).toBeNull();
    expect(message.reasoning_details).toEqual([{ index: 1, type: 'reasoning.encrypted' }]);
  });

  it('carries a reasoning field the provider spells as a structure', async () => {
    // Not readable text, so it is an extension like any other and is replayed whole. The
    // rule tests the value rather than only the key for exactly this case.
    const structured = { ...ORDINARY, reasoning: { summary: 'weighing it up', signature: 'zzz' } };
    const { reasoning } = await step(structured);

    expect(reasoning?.content).toBe('');
    expect(reasoning?.opaque).toEqual({ reasoning: structured.reasoning });
  });

  it('prefers reasoning_content over reasoning for the readable text', async () => {
    const both = { ...ORDINARY, reasoning_content: 'the considered one', reasoning: 'the other one' };
    expect((await step(both)).reasoning?.content).toBe('the considered one');
  });

  /**
   * The fields `ChatCompletionAssistantMessageParam` defines.
   *
   * The request schema and the response schema are not the same schema, which is the whole
   * of the bug: `annotations` exists on a response message and does not exist on this one.
   */
  const ACCEPTED = new Set(['role', 'audio', 'content', 'function_call', 'name', 'refusal', 'tool_calls']);

  it('replays nothing the request schema does not define', async () => {
    for (const message of [
      ORDINARY,
      { ...ORDINARY, annotations: [{ type: 'url_citation' }] },
      { ...ORDINARY, reasoning: 'weighing it up', reasoning_details: [{ type: 'reasoning.encrypted', data: 'AAAA' }] },
      { ...ORDINARY, audio: { id: 'a-1' } },
      { ...ORDINARY, content: null, refusal: 'I will not do that.' },
    ]) {
      const { content, refusal, reasoning } = await step(message);
      const [projected] = project([
        ...(reasoning === null ? [] : [{ type: 'reasoning' as const, at: 'T', ...reasoning }]),
        ...(refusal === null
          ? []
          : [{ type: 'message' as const, at: 'T', from: 'self' as const, content: refusal, refusal: true as const }]),
        { type: 'message' as const, at: 'T', from: 'self' as const, content },
      ]);

      // A provider extension may appear here — that is what `opaque` is for, and it is how
      // a reasoning block gets back. What may not appear is a *standard* field the request
      // does not accept, which is the only kind this rule can be wrong about.
      const standard = Object.keys(projected ?? {}).filter((key) => !key.startsWith('reasoning'));
      expect(standard.filter((key) => !ACCEPTED.has(key))).toEqual([]);
    }
  });
});
