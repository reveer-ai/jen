import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { payloadFiles, STAGE_SKILLS } from '../cli/payload.js';
import { frontmatterKeys, frontmatterOf, readRepoFile, repoRoot, run, trackedFiles } from './helpers.js';

const tracked = trackedFiles();

function isIgnored(path: string): boolean {
  try {
    run('git', ['check-ignore', '-q', '--no-index', path]);
    return true;
  } catch {
    return false;
  }
}

describe('the repository layout', () => {
  it('keeps jen\'s own source at cli/, never under src/', () => {
    expect(tracked.some((path) => path.startsWith('cli/'))).toBe(true);
    expect(tracked.filter((path) => path.startsWith('src/'))).toEqual([]);
  });

  it('tracks no build output', () => {
    expect(tracked.filter((path) => path.startsWith('dist/'))).toEqual([]);
    expect(tracked.filter((path) => path.startsWith('node_modules/'))).toEqual([]);
  });

  it('has no vendored OpenSpec artifacts', () => {
    expect(tracked.filter((path) => path.startsWith('.claude/skills/openspec-'))).toEqual([]);
    expect(tracked.filter((path) => path.startsWith('.claude/commands/opsx/'))).toEqual([]);
  });

  it('keeps a local `openspec init` from re-vendoring them', () => {
    expect(isIgnored('.claude/skills/openspec-explore/SKILL.md')).toBe(true);
    expect(isIgnored('.claude/commands/opsx/apply.md')).toBe(true);
  });

  it('tracks the OpenSpec config that `openspec init` writes', () => {
    // `prepare` rewrites this on every install, so asserting it is merely un-ignored
    // passes while the file sits outside git — which leaves every clone permanently dirty.
    expect(tracked).toContain('openspec/config.yaml');
  });
});

describe('.gitignore', () => {
  const rules = readRepoFile('.gitignore')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));

  it('is a conventional ignore file, not a default-deny allowlist', () => {
    expect(rules).not.toContain('*');
    expect(rules.filter((rule) => rule.startsWith('!'))).toEqual([]);
  });

  it('admits a new source file with no allowlist edit', () => {
    expect(isIgnored('cli/whatever.ts')).toBe(false);
    expect(isIgnored('openspec/changes/some-change/proposal.md')).toBe(false);
  });

  it('ignores build output, dependencies, and local agent scratch', () => {
    expect(isIgnored('dist/index.js')).toBe(true);
    expect(isIgnored('node_modules/anything/index.js')).toBe(true);
    expect(isIgnored('src/anything.ts')).toBe(true);
    expect(isIgnored('.claude/worktrees/some-tree/.git/config')).toBe(true);
    expect(isIgnored('.claude/settings.local.json')).toBe(true);
  });

  it('keeps every managed path trackable', () => {
    for (const { file } of payloadFiles()) {
      expect(isIgnored(file.source), `${file.source} is a managed path and must be trackable`).toBe(false);
    }
  });
});

describe('a fresh clone', () => {
  it('has all six stage skills present, tracked, and valid', () => {
    for (const name of STAGE_SKILLS) {
      const path = `.claude/skills/${name}/SKILL.md`;
      expect(existsSync(join(repoRoot, path)), `${path} is missing`).toBe(true);
      expect(tracked, `${path} is untracked`).toContain(path);

      const frontmatter = frontmatterOf(readRepoFile(path));
      expect(frontmatter, `${path} has no frontmatter`).not.toBeNull();

      const keys = frontmatterKeys(frontmatter!);
      expect(keys.name).toBe(name);
      expect(keys.description).toBeTruthy();
    }
  });

  it('holds unstamped working copies — jen is not a managed install', () => {
    for (const { file } of payloadFiles()) {
      expect(readRepoFile(file.source), `${file.source} must not carry the stamp`).not.toContain('jen: true');
    }
    expect(existsSync(join(repoRoot, '.jen'))).toBe(false);
  });

  it('ships an AGENTS.md with no marker syntax', () => {
    expect(readRepoFile('AGENTS.md')).not.toMatch(/JEN:(START|END)/);
  });
});
