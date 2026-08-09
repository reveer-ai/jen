/**
 * Performing a plan, and nothing beyond it.
 *
 * The executor makes no decisions: every path it touches came from the plan, and it
 * re-checks that each one resolves inside the project before writing. There is no
 * rollback — a run that fails partway reports what it completed and exits non-zero, and
 * the next run converges because the planner sees whatever already landed.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { resolveInProject, type Plan } from './plan.js';

export interface Applied {
  /** Project-relative paths written, in the order they were written. */
  written: string[];
  /** Project-relative paths removed. */
  removed: string[];
}

/** A run that failed partway, carrying what had already landed when it did. */
export class ApplyFailure extends Error {
  constructor(
    readonly path: string,
    readonly completed: Applied,
    override readonly cause: unknown,
  ) {
    super(`failed at ${path}: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = 'ApplyFailure';
  }
}

export function apply(plan: Plan): Applied {
  const completed: Applied = { written: [], removed: [] };
  let at = '';

  try {
    for (const write of [...plan.writes, ...plan.scaffold]) {
      at = write.target;
      const path = resolveInProject(plan.projectRoot, write.target);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, write.contents);
      completed.written.push(write.target);
    }

    for (const target of plan.deletions) {
      at = target;
      // The file, never the directory holding it: an emptied slot may still hold files
      // the project authored, and an empty directory is not jen's to remove.
      rmSync(resolveInProject(plan.projectRoot, target));
      completed.removed.push(target);
    }
  } catch (error) {
    throw new ApplyFailure(at, completed, error);
  }

  return completed;
}
