import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

import { payloadFiles } from '../cli/payload.js';
import { frontmatterOf, hasStamp } from '../cli/stamp.js';
import { stageInto } from './helpers.js';
import { stamped, unstamped } from './fixture.js';

let staged: string;

beforeAll(() => {
  staged = stageInto('stamp');
});

describe('reading the stamp back', () => {
  it('recognises a skill jen staged', () => {
    for (const { file, stamped: isStamped } of payloadFiles()) {
      if (!isStamped) continue;
      expect(hasStamp(readFileSync(join(staged, file.staged), 'utf8')), `${file.staged}`).toBe(true);
    }
  });

  it('leaves the fixed path unrecognised — it carries no stamp', () => {
    for (const { file, stamped: isStamped } of payloadFiles()) {
      if (isStamped) continue;
      expect(hasStamp(readFileSync(join(staged, file.staged), 'utf8'))).toBe(false);
    }
  });

  it('recognises the stamp wherever it sits in the frontmatter', () => {
    expect(hasStamp(stamped('design-task'))).toBe(true);
    expect(hasStamp('---\nmetadata:\n  jen: true\nname: x\n---\nbody\n')).toBe(true);
    expect(hasStamp('---\nname: x\nmetadata:\n  other: 1\n  jen: true\n---\nbody\n')).toBe(true);
    expect(hasStamp('---\nname: x\nmetadata:\n  jen:   true\n---\nbody\n')).toBe(true);
  });

  it('does not recognise a file the project owns', () => {
    expect(hasStamp(unstamped('deploy-service'))).toBe(false);
    expect(hasStamp('no frontmatter at all\n')).toBe(false);
    expect(hasStamp('')).toBe(false);
    expect(hasStamp('---\nname: x\ndescription: y\n')).toBe(false); // never closed
    expect(hasStamp('---\nname: x\nmetadata:\n  author: someone\n---\nbody\n')).toBe(false);
    expect(hasStamp('---\nname: x\nmetadata:\n  jen: false\n---\nbody\n')).toBe(false);
  });

  it('does not read the stamp out of the body', () => {
    expect(hasStamp('---\nname: x\n---\n\nmetadata:\n  jen: true\n')).toBe(false);
  });

  it('does not recognise flow style, and errs toward leaving the file alone', () => {
    // Nothing jen writes looks like this, and the consequence of not recognising it is
    // that the file survives — the direction to fail in.
    expect(hasStamp('---\nname: x\nmetadata: {jen: true}\n---\nbody\n')).toBe(false);
  });

  it('does not mistake a nested key for the stamp', () => {
    expect(hasStamp('---\nname: x\nmetadata:\n  origin:\n    jen: true\n---\nbody\n')).toBe(false);
  });
});

describe('frontmatter scanning', () => {
  it('returns the block for a file that has one, and null otherwise', () => {
    expect(frontmatterOf('---\nname: x\n---\nbody\n')).toBe('name: x\n');
    expect(frontmatterOf('body only\n')).toBeNull();
    expect(frontmatterOf('---\nname: x\n')).toBeNull();
  });
});
