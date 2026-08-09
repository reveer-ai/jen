/**
 * Asking git whether a managed path is ignored.
 *
 * Advisory only: jen reports an ignored managed path and never acts on it, because a
 * managed file inside an ignored path is missing from a fresh clone and invisible to
 * review. The project's `.gitignore` is the project's, and jen does not write it.
 *
 * Delegated rather than reimplemented — ignore semantics are nested files, negations,
 * `core.excludesFile` and `.git/info/exclude`, and a hand-rolled approximation would be
 * a lot of subtly wrong code in service of a warning.
 */
import { spawnSync } from 'node:child_process';

/**
 * Which of `paths` the project's ignore rules exclude. Empty when git is unavailable or
 * the project is not a repository — there are no ignore rules to violate.
 *
 * `--no-index` asks the rules directly, so a path already tracked in spite of them is
 * still reported.
 */
export function ignoredPaths(projectRoot: string, paths: string[]): string[] {
  if (paths.length === 0) return [];

  const result = spawnSync('git', ['check-ignore', '--no-index', '--stdin'], {
    cwd: projectRoot,
    input: paths.join('\n'),
    encoding: 'utf8',
  });

  // 0 = some path is ignored, 1 = none is. Anything else — no git, no repository — is a
  // check that could not run, which is not a finding.
  if (result.error || result.status !== 0) return [];

  return result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}
