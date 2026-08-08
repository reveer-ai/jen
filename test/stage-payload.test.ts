import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

import { payloadFiles, STAMP_FRONTMATTER } from '../cli/payload.js';
import { frontmatterKeys, frontmatterOf, readRepoFile, repoRoot, stageInto } from './helpers.js';

function filesUnder(dir: string): string[] {
  const found: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current).sort()) {
      const path = join(current, entry);
      if (statSync(path).isDirectory()) walk(path);
      else found.push(relative(dir, path).split(sep).join('/'));
    }
  };
  walk(dir);
  return found;
}

let staged: string;

beforeAll(() => {
  staged = stageInto('stage');
});

describe('staging', () => {
  it('produces exactly the declared payload', () => {
    expect(filesUnder(staged)).toEqual(payloadFiles().map((entry) => entry.file.staged).sort());
  });

  it('writes each staged skill as its source plus the stamp, byte for byte', () => {
    for (const { file, stamped } of payloadFiles()) {
      if (!stamped) continue;
      const source = readRepoFile(file.source);
      const output = readFileSync(join(staged, file.staged), 'utf8');

      expect(output.split(STAMP_FRONTMATTER)).toHaveLength(2);
      expect(output.replace(STAMP_FRONTMATTER, '')).toBe(source);

      // and the stamp sits inside the frontmatter, not somewhere in the body
      expect(frontmatterOf(output)).toContain(STAMP_FRONTMATTER);
    }
  });

  it('writes each fixed path unchanged and unstamped', () => {
    for (const { file, stamped } of payloadFiles()) {
      if (stamped) continue;
      const output = readFileSync(join(staged, file.staged), 'utf8');
      expect(output).toBe(readRepoFile(file.source));
      expect(output).not.toContain('jen: true');
    }
  });

  it('leaves a stamped skill parseable as an Agent Skill', () => {
    for (const { file, stamped } of payloadFiles()) {
      if (!stamped) continue;
      const frontmatter = frontmatterOf(readFileSync(join(staged, file.staged), 'utf8'));
      expect(frontmatter, `${file.staged} must still have frontmatter`).not.toBeNull();

      const keys = frontmatterKeys(frontmatter!);
      expect(keys.name).toBeTruthy();
      expect(keys.description).toBeTruthy();
      expect(keys.name).toBe(frontmatterKeys(frontmatterOf(readRepoFile(file.source))!).name);
      expect(frontmatter).toContain('metadata:\n  jen: true\n');
    }
  });

  it('names no assistant anywhere in the staged tree', () => {
    const assistantDirs = ['.claude', '.github', '.codex', '.opencode', '.cursor', '.agents'];
    for (const path of filesUnder(staged)) {
      for (const segment of path.split('/')) {
        expect(assistantDirs, `${path} names an assistant`).not.toContain(segment);
      }
    }
  });

  it('is byte-identical across consecutive runs', () => {
    const second = stageInto('stage-again');
    expect(filesUnder(second)).toEqual(filesUnder(staged));
    for (const path of filesUnder(staged)) {
      expect(readFileSync(join(second, path))).toEqual(readFileSync(join(staged, path)));
    }
  });

  it('produces identical bytes at a different package version', () => {
    const manifestPath = join(repoRoot, 'package.json');
    const original = readFileSync(manifestPath, 'utf8');
    let bumped: string;
    try {
      writeFileSync(manifestPath, original.replace(/"version": "[^"]+"/, '"version": "99.99.99"'));
      bumped = stageInto('stage-bumped');
    } finally {
      writeFileSync(manifestPath, original);
    }

    for (const path of filesUnder(staged)) {
      expect(readFileSync(join(bumped, path)), `${path} changed with the version`).toEqual(
        readFileSync(join(staged, path)),
      );
    }
  });

  it('fails loudly rather than staging a partial payload when dist/ is missing', () => {
    // The script resolves its root from its own location, so a copy in an empty tree has
    // no `dist/` to import — exactly the standalone-before-a-build case.
    const stub = mkdtempSync(join(tmpdir(), 'jen-nodist-'));
    mkdirSync(join(stub, 'scripts'));
    copyFileSync(join(repoRoot, 'scripts/stage-payload.js'), join(stub, 'scripts/stage-payload.js'));

    const out = join(stub, 'out');
    const result = spawnSync('node', ['scripts/stage-payload.js', '--out', out], {
      cwd: stub,
      encoding: 'utf8',
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('npm run build');
    expect(existsSync(out)).toBe(false);
  });
});
