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
  // Every one of these dispatches tool calls and takes the next step on its own. `stream`
  // is deliberately absent from the list: it accumulates chunks into one completion — which
  // is the part worth not owning, since tool-call `arguments` arrive split at arbitrary
  // byte boundaries — and it dispatches nothing.
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
    // One `stream(` and one `finalChatCompletion(` — a second of either would be a loop
    // spelled out by hand, which is the same delegation wearing different clothes.
    expect(CODE.match(/\.stream\(/g)).toHaveLength(1);
    expect(CODE.match(/finalChatCompletion\(/g)).toHaveLength(1);
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

  /** One streamed completion carrying `reply`, in the chunk-and-`[DONE]` shape the wire uses. */
  function streamed(): string {
    const head = { id: 'c-1', object: 'chat.completion.chunk', created: 1, model: 'stub-model' };
    return [
      `data: ${JSON.stringify({ ...head, choices: [{ index: 0, delta: reply, finish_reason: null }] })}`,
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
      request.on('data', () => {});
      request.on('end', () => {
        response.writeHead(200, { 'content-type': 'text/event-stream' });
        response.end(streamed());
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
    ]) {
      const { content, reasoning } = await step(message);
      const [projected] = project([
        ...(reasoning === null ? [] : [{ type: 'reasoning' as const, at: 'T', ...reasoning }]),
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
