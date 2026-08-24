/**
 * The binary as an adopter actually runs it: a real process, against the payload staged
 * inside `dist/`, with nothing on standard input.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { SKILLS } from '../cli/payload.js';
import { project } from './fixture.js';
import { readRepoFile, repoRoot } from './helpers.js';

const entry = join(repoRoot, 'dist/index.js');

/** Runs the built CLI with standard input closed — nothing here may wait on a person. */
function jen(
  args: string[],
  env: Record<string, string> = {},
): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [entry, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 60_000,
    env: { ...process.env, ...env },
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe('the built binary', () => {
  it('prints usage describing commands that exist', () => {
    const result = jen(['--help']);

    expect(result.status).toBe(0);
    for (const command of ['init', 'update', 'run', 'watch']) {
      expect(result.stdout).toMatch(new RegExp(`^ {2}${command} {2,}\\S`, 'm'));
    }
    expect(result.stdout).not.toContain('not implemented');
    expect(result.stdout).not.toContain('payload declaration');
  });

  // The loop is a real process an operator starts and stops, so the one thing worth
  // spawning for is that it starts at all — with standard input closed, like everything
  // else here, and refusing rather than idling when it has nothing to poll.
  it('refuses to start the local runner against a project it cannot resolve', () => {
    const root = project({}, 'spawned-watch');
    // Every credential blanked deliberately. This spawns a real process, and a contributor
    // with a working key exported would otherwise have this test start a live pipeline
    // against a real tracker and sit in its loop until the timeout.
    const result = jen(['watch', root], { LINEAR_API_KEY: '', JEN_TEAM: '', JEN_PROJECT: '' });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('LINEAR_API_KEY is not set');
    expect(result.stderr).toContain('the loop was not started');
  });

  it('prints the installed version', () => {
    const { version } = JSON.parse(readRepoFile('package.json')) as { version: string };
    expect(jen(['--version']).stdout.trim()).toBe(version);
  });

  it('rejects an unknown command', () => {
    const result = jen(['frobnicate']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Unknown command');
  });

  it('adopts a project with standard input closed, resolving its own staged payload', () => {
    const root = project({}, 'spawned-init');
    const result = jen(['init', root]);

    expect(result.status, result.stderr).toBe(0);
    for (const name of SKILLS) {
      expect(existsSync(join(root, '.claude/skills', name, 'SKILL.md')), name).toBe(true);
    }
    expect(existsSync(join(root, 'openspec/config.yaml'))).toBe(true);
  });

  it('updates a project with standard input closed', () => {
    const root = project({}, 'spawned-update');
    const result = jen(['update', root]);

    expect(result.status, result.stderr).toBe(0);
    expect(existsSync(join(root, 'AGENTS.md'))).toBe(true);
  });

  it('refuses adoption non-zero, reporting the reason on stderr', () => {
    const root = project({ 'AGENTS.md': "The project's own.\n" }, 'spawned-refuse');
    const result = jen(['init', root]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('AGENTS.md');
    expect(existsSync(join(root, '.claude'))).toBe(false);
    expect(existsSync(join(root, 'openspec'))).toBe(false);
  });
});
