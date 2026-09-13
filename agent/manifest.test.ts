/**
 * The substrate's manifest, and the boundary it exists to keep real.
 *
 * The substrate is excluded from the repository's published package, and that exclusion is
 * only worth anything if it extends to what the substrate *depends on*. A dependency of
 * the substrate's declared at the repository root would be installed by everyone who
 * installs the CLI, to support code the package does not contain.
 *
 * Nothing here needs a network or a container runtime. It reads two manifests and asks npm
 * what it would pack.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..');

interface Manifest {
  files?: string[];
  bin?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

function manifest(path: string): Manifest {
  return JSON.parse(readFileSync(join(ROOT, path), 'utf8')) as Manifest;
}

const substrate = manifest('agent/package.json');
const repository = manifest('package.json');

describe('the substrate declares its own dependencies', () => {
  it('declares at least one, which is what warrants a manifest at all', () => {
    expect(Object.keys(substrate.dependencies ?? {}).length).toBeGreaterThan(0);
  });

  // Nothing automated runs the substrate's tests, so a range would be widened by an
  // install nobody watched and caught by nobody either. An exact version is the only
  // pinning that does not depend on a check that is not running.
  it('pins every one of them exactly', () => {
    for (const [name, version] of Object.entries(substrate.dependencies ?? {})) {
      expect(version, `${name} is not pinned to an exact version`).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });

  // The tooling is deliberately not redeclared: the repository already carries the compiler
  // and the test runner, and a second copy at a second version is two things to keep in
  // step for no gain. Only what the substrate's *code* imports belongs here.
  it('redeclares none of the tooling the repository already carries', () => {
    const declared = Object.keys({ ...substrate.dependencies, ...substrate.devDependencies });
    expect(declared).not.toContain('typescript');
    expect(declared).not.toContain('vitest');
    expect(declared).not.toContain('@types/node');
  });
});

describe('nothing the substrate needs reaches the repository', () => {
  it('leaves the repository’s dependency sets free of them', () => {
    const carried = Object.keys({ ...repository.dependencies, ...repository.devDependencies });
    for (const name of Object.keys(substrate.dependencies ?? {})) {
      expect(carried, `${name} reached the repository's manifest`).not.toContain(name);
    }
  });

  it('leaves the repository shipping dist and nothing else', () => {
    expect(repository.files).toEqual(['dist']);
  });
});

describe('the published package carries no path under the substrate', () => {
  // `--ignore-scripts` so this does not run the repository's `prepack`, which builds and
  // stages into `dist/`. What is under test is which paths npm *selects*, and that is
  // decided by `files` rather than by what happens to be built — the contents of `dist/`
  // are the repository's own suite's business.
  const packed = JSON.parse(
    execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }),
  ) as [{ files: { path: string }[] }];

  const paths = (packed[0]?.files ?? []).map((file) => file.path);

  it('selects something, so the absence below is not vacuous', () => {
    expect(paths).toContain('package.json');
  });

  it('selects nothing under agent/', () => {
    expect(paths.filter((path) => path === 'agent' || path.startsWith('agent/'))).toEqual([]);
  });

  it('selects no manifest but the repository’s own', () => {
    expect(paths.filter((path) => path.endsWith('package.json'))).toEqual(['package.json']);
  });
});

describe('the substrate declares its own entry point', () => {
  it('names an executable of its own', () => {
    expect(Object.keys(substrate.bin ?? {})).toEqual(['jen-agent']);
  });

  it('does not declare it as a subcommand of the repository’s CLI', () => {
    expect(Object.keys(repository.bin ?? {})).toEqual(['jen']);
  });
});
