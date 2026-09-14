/**
 * The record: what it may carry, and what it may not.
 *
 * Two properties are worth a test here and the rest are the compiler's. The first is that
 * a record is inert — nothing in a serialized one is a secret, so persisting one beside
 * the project needs no care from whoever persists it. The second is the one cross-field
 * rule: a credential named for a use names one the record already carries, rather than
 * restating the reference and giving two places to disagree.
 */
import { describe, expect, it } from 'vitest';

import { aRecord } from './fixture.ts';
import { parseRecord, RecordError } from './record.ts';

describe('a record is inert', () => {
  it('carries every credential as a reference and no value', () => {
    const record = aRecord({
      credentials: [
        { name: 'MODEL_API_KEY', ref: 'env:JEN_MODEL_API_KEY' },
        { name: 'GIT_TOKEN', ref: 'env:JEN_GIT_TOKEN' },
      ],
    });

    const serialized = JSON.parse(JSON.stringify(record)) as { credentials: unknown[] };

    // Structural rather than a search for secret-looking strings: every entry has exactly
    // the two fields of a reference, so there is nowhere for a value to be.
    for (const credential of serialized.credentials) {
      expect(Object.keys(credential as object).sort()).toEqual(['name', 'ref']);
    }
  });

  it('survives a round trip through serialization unchanged', () => {
    const record = aRecord({ tools: ['fs', 'exec'], parent: 'agent-0' });
    expect(parseRecord(JSON.parse(JSON.stringify(record)))).toEqual(record);
  });
});

describe('a credential named for a use names one the record carries', () => {
  it('accepts a model credential that is among them', () => {
    const record = aRecord({
      model: { ...aRecord().model, credential: 'GIT_TOKEN' },
      credentials: [{ name: 'GIT_TOKEN', ref: 'env:JEN_GIT_TOKEN' }],
    });
    expect(parseRecord(record).model.credential).toBe('GIT_TOKEN');
  });

  it('refuses one that is not, naming what it named', () => {
    const record = aRecord({ model: { ...aRecord().model, credential: 'ABSENT_KEY' } });
    expect(() => parseRecord(record)).toThrow(RecordError);
    expect(() => parseRecord(record)).toThrow(/ABSENT_KEY/);
  });

  // The reference is not restated inside the model block, so there is no second place for
  // it to be written and no way for the two to disagree.
  it('does not restate the reference', () => {
    expect(Object.keys(aRecord().model).sort()).toEqual(['baseURL', 'credential', 'model', 'provider']);
  });
});

describe('reading a record says what could not be read', () => {
  // Named fields rather than "invalid record", because the failure this sees in practice
  // is a truncated boot frame, and a field name is what distinguishes that from a record
  // the supervisor built wrong.
  const broken: [string, unknown, RegExp][] = [
    ['not an object', 'a string', /record is not an object/],
    ['a missing id', { ...aRecord(), id: undefined }, /record\.id is missing/],
    ['a missing charter', { ...aRecord(), charter: undefined }, /record\.charter is missing/],
    ['a missing model block', { ...aRecord(), model: undefined }, /record\.model is not an object/],
    ['a model with no baseURL', { ...aRecord(), model: { ...aRecord().model, baseURL: 42 } }, /record\.model\.baseURL/],
    ['tools that are not strings', { ...aRecord(), tools: [1] }, /record\.tools/],
    ['a credential with no ref', { ...aRecord(), credentials: [{ name: 'MODEL_API_KEY' }] }, /record\.credentials\[0\]\.ref/],
    ['an absent parent field', { ...aRecord(), parent: undefined }, /record\.parent/],
  ];

  for (const [description, value, message] of broken) {
    it(`refuses ${description}`, () => {
      expect(() => parseRecord(value)).toThrow(message);
    });
  }

  it('accepts a null parent, which is the agent nobody spawned', () => {
    expect(parseRecord(aRecord({ parent: null })).parent).toBeNull();
  });
});
