/**
 * Adopter projects to run the commands against.
 *
 * jen never consumes its own package — `prepack` stages from the working copies — so its
 * own repository is permanently on the easy path and proves nothing about reconciliation.
 * The divergence a real project accumulates has to be supplied here instead.
 */
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';

import { STAMP_FRONTMATTER } from '../cli/payload.js';

/** A `SKILL.md` carrying jen's stamp — what a managed skill looks like on disk. */
export function stamped(name: string, body = 'What this stage does.\n'): string {
  return `---\nname: ${name}\ndescription: ${name} does something.\n${STAMP_FRONTMATTER}---\n\n${body}`;
}

/** A `SKILL.md` the project wrote itself. */
export function unstamped(name: string, body = 'What this skill does.\n'): string {
  return `---\nname: ${name}\ndescription: ${name} does something.\n---\n\n${body}`;
}

export function writeProject(root: string, files: Record<string, string>): string {
  for (const [path, content] of Object.entries(files)) {
    const absolute = join(root, path);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, content);
  }
  return root;
}

export function project(files: Record<string, string> = {}, label = 'project'): string {
  return writeProject(mkdtempSync(join(tmpdir(), `jen-${label}-`)), files);
}

/**
 * A project with a sibling directory it can reach out into.
 *
 * The escapes worth testing all need somewhere to escape *to*, and a single-root fixture
 * has nowhere: a link pointing at the temp directory's own parent would put the tests in
 * each other's way. The pair keeps every case's blast radius inside one fixture.
 */
export function neighbours(
  label: string,
  files: Record<string, string> = {},
  outsideFiles: Record<string, string> = {},
): { root: string; outside: string } {
  const base = mkdtempSync(join(tmpdir(), `jen-${label}-`));
  mkdirSync(join(base, 'project'));
  mkdirSync(join(base, 'outside'));
  return {
    root: writeProject(join(base, 'project'), files),
    outside: writeProject(join(base, 'outside'), outsideFiles),
  };
}

/** A symlink at a project-relative path, pointing wherever `to` says. */
export function link(root: string, at: string, to: string): void {
  const path = join(root, at);
  mkdirSync(dirname(path), { recursive: true });
  symlinkSync(to, path);
}

/**
 * A project that has diverged in every direction reconciliation has to survive: a skill
 * of its own beside the managed ones, a managed one it edited, one jen used to ship and
 * no longer does, a copy it claimed by deleting the stamp, stamped files above and below
 * the depth the set writes, a filled-in scaffold, and an `AGENTS.md` of its own.
 */
export function messyProject(staged: string): string {
  const shipped = readFileSync(join(staged, 'skills/design-task/SKILL.md'), 'utf8');

  return project(
    {
      'AGENTS.md': '# How we work here\n\nThe project wrote this before it ever heard of jen.\n',

      // the project's own, never jen's
      '.claude/skills/deploy-service/SKILL.md': unstamped('deploy-service'),
      // jen's, edited by hand
      '.claude/skills/design-task/SKILL.md': `${shipped}\nA local edit nobody upstreamed.\n`,
      // jen's, from a version that shipped it
      '.claude/skills/legacy-stage/SKILL.md': stamped('legacy-stage'),
      // copied from jen's and claimed by deleting the stamp
      '.claude/skills/design-task-copy/SKILL.md': shipped.replace(STAMP_FRONTMATTER, ''),
      // a directory in the target dir that holds no member
      '.claude/skills/notes/README.md': 'Scratch notes, not a skill.\n',
      // stamped, but deeper than the set writes
      '.claude/skills/team/nested/SKILL.md': stamped('nested'),
      // stamped, but outside any declared target directory
      'docs/SKILL.md': stamped('docs'),

      // scaffold the project has filled in
      'registry.yaml': 'resources:\n  - name: acme-web\n    kind: repository\n',
      '.claude/settings.json': '{\n  "permissions": {\n    "allow": ["Bash(make:*)"]\n  }\n}\n',

      // already adopted OpenSpec, so nothing needs spawning
      'openspec/config.yaml': 'schema: spec-driven\n',

      // and the project itself
      'package.json': '{\n  "name": "adopter",\n  "version": "1.0.0"\n}\n',
      'src/app.ts': 'export const app = 1;\n',
      'src/api/AGENTS.md': "# API notes\n\nThe project's own, below src/.\n",
      '.gitignore': 'node_modules/\n',
    },
    'messy',
  );
}

export interface Entry {
  content: string;
  mtimeMs: number;
}

/** Every file in the tree, by project-relative path. */
export function snapshot(root: string): Map<string, Entry> {
  const found = new Map<string, Entry>();

  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) {
        found.set(relative(root, path).split(sep).join('/'), {
          content: readFileSync(path, 'utf8'),
          mtimeMs: statSync(path).mtimeMs,
        });
      }
    }
  };

  walk(root);
  return found;
}

/** Paths whose content differs between two snapshots, in either direction. */
export function changed(before: Map<string, Entry>, after: Map<string, Entry>): string[] {
  const paths = new Set([...before.keys(), ...after.keys()]);
  return [...paths].filter((path) => before.get(path)?.content !== after.get(path)?.content).sort();
}

/** Paths whose content or modification time differs — idempotency's stricter form. */
export function touched(before: Map<string, Entry>, after: Map<string, Entry>): string[] {
  const paths = new Set([...before.keys(), ...after.keys()]);
  return [...paths]
    .filter((path) => {
      const one = before.get(path);
      const two = after.get(path);
      return one?.content !== two?.content || one?.mtimeMs !== two?.mtimeMs;
    })
    .sort();
}
