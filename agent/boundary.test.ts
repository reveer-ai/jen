/**
 * The two bodies of code do not reach each other.
 *
 * `cli/` holds jen's CLI; `agent/` holds the substrate. The separation is physical rather
 * than a matter of discipline, and this is what makes it checkable. It has a consequence
 * the substrate's entry point depends on: a `jen` subcommand that launched the runtime
 * would have to import it, so the runtime takes an entry point of the substrate's own.
 *
 * Two readings, because they catch different mistakes. The walk follows what the CLI
 * actually reaches from its entry, which is the graph the requirement names. The sweep
 * reads every file in both directories, which catches an import in a module nothing
 * imports yet — the state a boundary is usually broken in first.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..');

/** Every `from '…'` and `import('…')` specifier in a source file. */
function specifiers(source: string): string[] {
  return [
    ...[...source.matchAll(/\bfrom\s+'([^']+)'/g)].map((match) => match[1] ?? ''),
    ...[...source.matchAll(/\bimport\s*\(\s*'([^']+)'\s*\)/g)].map((match) => match[1] ?? ''),
  ];
}

/** Where a relative specifier lands, undone from the `.js` the sources are written with. */
function target(from: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null;
  return resolve(dirname(from), specifier.replace(/\.js$/, '.ts'));
}

function sources(directory: string): string[] {
  return readdirSync(join(ROOT, directory), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
    .map((entry) => join(entry.parentPath, entry.name))
    .filter((path) => !path.includes(`${join('node_modules')}`));
}

describe('the CLI’s import graph never reaches the substrate', () => {
  it('reaches nothing under agent/ from its entry point', () => {
    const seen = new Set<string>();
    const queue = [join(ROOT, 'cli', 'index.ts')];

    while (queue.length > 0) {
      const file = queue.pop()!;
      if (seen.has(file)) continue;
      seen.add(file);

      for (const specifier of specifiers(readFileSync(file, 'utf8'))) {
        const next = target(file, specifier);
        if (next === null) continue;
        expect(
          relative(ROOT, next).startsWith('agent'),
          `${relative(ROOT, file)} reaches ${relative(ROOT, next)}`,
        ).toBe(false);
        queue.push(next);
      }
    }

    // A walk that followed nothing would pass this vacuously.
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe('neither directory names the other at all', () => {
  for (const [here, there] of [
    ['cli', 'agent'],
    ['agent', 'cli'],
  ] as const) {
    it(`no module under ${here}/ imports one under ${there}/`, () => {
      for (const file of sources(here)) {
        for (const specifier of specifiers(readFileSync(file, 'utf8'))) {
          const next = target(file, specifier);
          const crosses = next !== null && relative(ROOT, next).startsWith(there);
          expect(crosses, `${relative(ROOT, file)} imports ${specifier}`).toBe(false);
        }
      }
    });
  }
});
