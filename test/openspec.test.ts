import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { INIT_ARGS, initialize, isInitialized, openspecBin, resolvesFromProject } from '../cli/openspec.js';
import { project } from './fixture.js';
import { repoRoot } from './helpers.js';

describe('locating OpenSpec', () => {
  it('resolves the binary through the bare specifier, past an exports map that hides package.json', () => {
    // `@fission-ai/openspec/package.json` is not exported and throws; the resolver has to
    // go through `.` and walk up. That this returns a real path is the whole assertion.
    const bin = openspecBin();
    expect(existsSync(bin), bin).toBe(true);
    expect(bin.endsWith('openspec.js')).toBe(true);
  });

  it('runs it with the flags that keep it non-interactive', () => {
    expect([...INIT_ARGS]).toEqual(['init', '--tools', 'claude', '--no-animation', '--force']);
  });

  it('reports whether a project is already initialized', () => {
    expect(isInitialized(project({ 'openspec/config.yaml': 'schema: spec-driven\n' }, 'has-openspec'))).toBe(true);
    expect(isInitialized(project({}, 'no-openspec'))).toBe(false);
  });
});

describe('when OpenSpec cannot run', () => {
  it('fails naming the command', () => {
    expect(() => initialize(join(project({}, 'gone'), 'not-a-directory'))).toThrow(
      /openspec init --tools claude --no-animation --force/,
    );
  });
});

describe('reaching OpenSpec after adoption', () => {
  it('is true where the project has it installed, false where it does not', () => {
    expect(resolvesFromProject(repoRoot)).toBe(true);
    expect(resolvesFromProject(project({}, 'no-deps'))).toBe(false);
  });
});
