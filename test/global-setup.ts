import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * The staging script imports the payload declaration from `dist/`, so the tests that
 * exercise it need a build first — the same ordering `prepack` enforces.
 */
export default function setup(): void {
  execFileSync('npm', ['run', 'build'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    stdio: 'inherit',
  });
}
