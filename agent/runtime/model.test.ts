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
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { aRecord } from '../fixture.js';
import { ModelError, openAIClient } from './model.js';

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
