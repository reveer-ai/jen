/**
 * The supervisor's source, read rather than run.
 *
 * Two prohibitions here are behavioural in a way no behavioural test can hold. A default
 * residency added to this file would make every test in this directory pass — the tests
 * name their own numbers, so a supplied one would only ever apply where a test did not
 * look. And a sweep that released workspaces would pass every assertion about ending
 * bodies. Both fail by destroying something, and both are exactly the "just add a small
 * rule" that will keep looking reasonable. So they are read, the way `docker.test.ts` reads
 * for `node:fs`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SOURCE = readFileSync(join(import.meta.dirname, 'index.ts'), 'utf8');

/**
 * The file with its prose removed.
 *
 * The prose has to stay free to say what is absent and why — a file that could not explain
 * its own omissions loses the reasoning that keeps them from being re-added, which is the
 * lesson `model.ts` learned about its unused loop helpers.
 */
const DECLARATIONS = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('the supervisor holds no period of its own', () => {
  /**
   * `weights decide, code constrains`. Only the agent can know whether it is about to be
   * woken in seconds or in a day, because it has just decided what it dispatched — and a
   * constant here deciding it would be policy in code, where no charter can reach it.
   */
  it('names no binding that could be a duration', () => {
    // Bindings rather than every identifier: `ms` on a capability result is the event's own
    // field, recording how long an invocation took, and it is neither a period this file
    // chose nor one it applies to anything.
    const bound = [
      ...[...DECLARATIONS.matchAll(/\b(?:const|let|var|readonly)\s+(#?[A-Za-z_][A-Za-z0-9_]*)/g)],
      ...[...DECLARATIONS.matchAll(/^\s*(#[A-Za-z_][A-Za-z0-9_]*)\s*[:=(]/gm)],
    ].map((match) => match[1] ?? '');

    expect(bound.length, 'the reading found no bindings at all').toBeGreaterThan(5);
    for (const name of bound) {
      expect(name, `\`${name}\` reads as a period the supervisor holds`).not.toMatch(
        /(ms|millis|seconds|timeout|interval|delay|grace|idle|backoff|linger|keepalive)$/i,
      );
    }
  });

  it('writes no number that could be one either', () => {
    // Anything with a digit separator, anything multiplied out, and anything long enough to
    // be a count of milliseconds. `ms: 0` and a bound of `0` survive, which is the point:
    // zero is the absence of a request rather than a period.
    expect(DECLARATIONS).not.toMatch(/\b\d+_\d+/);
    expect(DECLARATIONS).not.toMatch(/\b\d+\s*\*\s*\d+/);
    expect(DECLARATIONS).not.toMatch(/\b\d{3,}\b/);
  });

  it('arms exactly one timer, and never on a number of its own', () => {
    const armed = DECLARATIONS.split('\n').filter((line) => line.includes('setTimeout('));
    expect(armed, 'the supervisor arms one timer, from the residency on the frame').toHaveLength(1);
    // The delay is the last argument, and it has to be the name the frame arrived under
    // rather than anything this file decided.
    expect(armed[0]?.trim()).toMatch(/setTimeout\(.*,\s*keep\);?$/);
    expect(DECLARATIONS).not.toMatch(/setInterval/);
  });

  it('takes the period from the frame and applies nothing to it', () => {
    // No clamp, no floor, no ceiling, no scaling. `keep <= 0` is a question about whether
    // the agent asked for anything at all, which is the one reading of the number allowed.
    const uses = DECLARATIONS.split('\n').filter((line) => /\bkeep\b/.test(line));
    expect(uses.length).toBeGreaterThan(0);
    for (const use of uses) {
      expect(use, `\`${use.trim()}\` adjusts what the agent asked for`).not.toMatch(
        /Math\.(min|max|round|floor|ceil)|keep\s*[*+\-/]|[*+\-/]\s*keep/,
      );
    }
  });
});

describe('nothing in the supervisor releases a workspace', () => {
  /**
   * The sweep runs after a failure, which is precisely when every agent's work is sitting in
   * a workspace waiting to be resumed from. `releaseWorkspace` is on the interface the
   * supervisor already holds, one line away from the sweep that ends bodies — and taking it
   * would destroy a day of every agent's work through a call that reads as tidying up.
   *
   * Dismissal is the one place releasing could ever be right, and it is deliberately not
   * done there either: keeping the workspace is reversible and releasing it is not.
   */
  it('never calls it', () => {
    expect(DECLARATIONS).not.toMatch(/releaseWorkspace/);
  });

  it('says why, so the absence is not mistaken for an oversight', () => {
    expect(SOURCE).toMatch(/workspace is kept/i);
  });
});
