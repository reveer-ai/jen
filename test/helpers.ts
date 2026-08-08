import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = fileURLToPath(new URL('..', import.meta.url));

export function run(command: string, args: string[]): string {
  return execFileSync(command, args, { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

/** Stages the payload into a fresh temporary directory and returns its path. */
export function stageInto(label: string): string {
  const out = join(mkdtempSync(join(tmpdir(), `jen-${label}-`)), 'templates');
  run('node', ['scripts/stage-payload.js', '--out', out]);
  return out;
}

export function readRepoFile(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), 'utf8');
}

export function trackedFiles(): string[] {
  return run('git', ['ls-files']).split('\n').filter(Boolean);
}

/**
 * The raw YAML frontmatter block, or `null` when the file has none. Deliberately a scan
 * rather than a parser — the same thing a skill loader does to find `name`.
 */
export function frontmatterOf(content: string): string | null {
  if (!content.startsWith('---\n')) return null;
  const close = content.indexOf('\n---\n', 3);
  return close === -1 ? null : content.slice(4, close + 1);
}

/** Top-level scalar keys of a frontmatter block, e.g. `name`, mapped to their values. */
export function frontmatterKeys(frontmatter: string): Record<string, string> {
  const keys: Record<string, string> = {};
  for (const line of frontmatter.split('\n')) {
    const match = /^([A-Za-z0-9_-]+):[ \t]*(.*)$/.exec(line);
    if (match) keys[match[1]!] = match[2]!.trim();
  }
  return keys;
}
