/**
 * Delegating to OpenSpec rather than reproducing it.
 *
 * jen depends on OpenSpec and spawns its CLI; it never learns OpenSpec's file list, so
 * OpenSpec's version can move without touching jen's payload. A subprocess couples to
 * documented flags; importing the package would couple to its library API instead.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE = '@fission-ai/openspec';

/** The flags `jen init` runs OpenSpec with. Fixed at `claude`, matching jen's own payload. */
export const INIT_ARGS = ['init', '--tools', 'claude', '--no-animation', '--force'] as const;

/**
 * The path to OpenSpec's `openspec` binary inside jen's own dependency tree.
 *
 * OpenSpec's `exports` map declares only `"."`, so resolving
 * `@fission-ai/openspec/package.json` throws `ERR_PACKAGE_PATH_NOT_EXPORTED`. Resolution
 * therefore goes through the bare specifier and walks up to the package root. Resolving
 * through jen's module graph also works under a global or `npx` install, where
 * `node_modules/.bin/openspec` is not in the project's tree at all.
 */
export function openspecBin(): string {
  const entry = fileURLToPath(import.meta.resolve(PACKAGE));

  for (let dir = dirname(entry); ; ) {
    const manifestPath = join(dir, 'package.json');
    if (existsSync(manifestPath)) {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
        bin?: string | Record<string, string>;
      };
      const bin = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.openspec;
      if (!bin) throw new Error(`${PACKAGE} declares no \`openspec\` binary in ${manifestPath}`);
      return join(dir, bin);
    }

    const parent = dirname(dir);
    if (parent === dir) throw new Error(`could not find the package root for ${PACKAGE} above ${entry}`);
    dir = parent;
  }
}

/** Whether the project is already OpenSpec-initialized — the signal OpenSpec's own tooling uses. */
export function isInitialized(projectRoot: string): boolean {
  return existsSync(join(projectRoot, 'openspec'));
}

/** Runs `openspec init` in the project. Throws, naming the command, when it fails. */
export function initialize(projectRoot: string): void {
  const args = [...INIT_ARGS];
  const command = `openspec ${args.join(' ')}`;

  const result = spawnSync(process.execPath, [openspecBin(), ...args], {
    cwd: projectRoot,
    // stdin closed: nothing jen runs may wait on a person.
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
  });

  if (result.error) throw new Error(`could not run \`${command}\`: ${result.error.message}`);
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').trim();
    throw new Error(
      `\`${command}\` failed (${result.status === null ? `signal ${result.signal}` : `exit ${result.status}`})` +
        (detail ? `:\n${detail}` : ''),
    );
  }
}

/**
 * Whether OpenSpec would resolve from the project itself, rather than only from jen's
 * install. Every stage of the workflow runs `openspec` for the life of the project, so
 * reaching it at init time is not the same as reaching it afterward.
 *
 * A directory check rather than a resolution attempt: OpenSpec is ESM-only, so a
 * `require`-based resolve fails on an install that is perfectly fine.
 */
export function resolvesFromProject(projectRoot: string): boolean {
  for (let dir = resolve(projectRoot); ; ) {
    if (existsSync(join(dir, 'node_modules', ...PACKAGE.split('/')))) return true;
    const parent = dirname(dir);
    if (parent === dir) return false;
    dir = parent;
  }
}
