import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * The staging script imports the payload declaration from `dist/`, so the tests that
 * exercise it need a build first — the same ordering `prepack` enforces.
 *
 * Staging runs too: the tests that spawn the built binary exercise the same payload
 * resolution an installed package uses, which needs `dist/templates/` to exist.
 */
export default function setup(): void {
  const cwd = fileURLToPath(new URL('..', import.meta.url));
  execFileSync('npm', ['run', 'build'], { cwd, stdio: 'inherit' });
  execFileSync('node', ['scripts/stage-payload.js'], { cwd, stdio: 'inherit' });
}
