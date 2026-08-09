/**
 * Reading a project and deciding what would change — and nothing else.
 *
 * The planner performs no write of any kind. Every guarantee that matters here is a
 * negative one ("a refused adoption leaves no trace", "an unstamped file is never
 * deleted"), and negatives are not checkable when the deciding and the writing are
 * interleaved. Splitting them makes refusal a property of the structure — the executor
 * is simply never called — rather than of the order of statements.
 */
import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  memberShape,
  PAYLOAD,
  payloadFiles,
  SCAFFOLD,
  type ManagedFile,
  type PayloadGroup,
  type VariableSet,
} from './payload.js';
import { hasStamp } from './stamp.js';

/** One file to put on disk, with the bytes already read out of the staged payload. */
export interface PlannedWrite {
  /** Path in the project, relative to its root. */
  target: string;
  contents: Buffer;
  /** Whether something already occupies the path. */
  replaces: boolean;
}

export interface Plan {
  projectRoot: string;
  /** Managed files whose content on disk is not what this version ships. */
  writes: PlannedWrite[];
  /** Managed paths already byte-identical to what this version ships. */
  current: string[];
  /** Stamped paths this version no longer ships, inside a declared target directory. */
  deletions: string[];
  /** Scaffold files the project does not have yet. Empty unless asked for. */
  scaffold: PlannedWrite[];
  /**
   * Fixed paths that exist and differ from what is shipped. A fixed path carries no
   * stamp, so on first contact jen cannot tell its own file from the project's; the
   * caller decides whether that is a refusal or an overwrite.
   */
  conflicts: string[];
}

export interface PlanOptions {
  /** Whether to plan the once-only scaffold. `jen init` does; `jen update` never does. */
  scaffold: boolean;
  /** Where the staged payload lives. Defaults to the one inside this installation. */
  templates?: string;
}

/**
 * The staged payload inside this installation of the package.
 *
 * Resolved against the module rather than the working directory, so it is correct under
 * every install shape — global, `npx`, project devDependency. The target project is a
 * separate argument, so the two can never be confused for one another.
 */
export function stagedPayloadDir(): string {
  const dir = fileURLToPath(new URL('./templates/', import.meta.url));
  if (!existsSync(dir)) {
    throw new Error(
      `this installation carries no staged payload (looked in ${dir}).\n` +
        'The payload is staged by `prepack`, which npm does not run for an install straight from a git URL. ' +
        'Install @reveer/jen from the registry.',
    );
  }
  return dir;
}

/** Resolves a project-relative path, refusing anything that escapes the project root. */
export function resolveInProject(projectRoot: string, target: string): string {
  const root = resolve(projectRoot);
  const path = resolve(root, target);
  if (path === root || !path.startsWith(`${root}${sep}`)) {
    throw new Error(`refusing to touch ${target}: it resolves outside ${root}`);
  }
  return path;
}

function isRegularFile(path: string): boolean {
  try {
    return lstatSync(path).isFile();
  } catch {
    return false;
  }
}

/**
 * The paths a variable set could have written into a project, derived from the set's own
 * declared shape.
 *
 * One level of the target directory and no deeper: the set writes `<targetDir>/<slot>/
 * <shape>`, so anything below that is not a location the set can reach and is therefore
 * not jen's to remove. Symlinked slots are skipped — following one would put a deletion
 * outside the boundary the spec draws.
 */
export function reconcileCandidates(projectRoot: string, set: VariableSet): string[] {
  const shape = memberShape(set);

  let entries;
  try {
    entries = readdirSync(join(projectRoot, set.targetDir), { withFileTypes: true });
  } catch {
    return [];
  }

  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => `${set.targetDir}/${entry.name}/${shape}`)
    .filter((candidate) => isRegularFile(join(projectRoot, candidate)))
    .sort();
}

function stampedOnDisk(path: string): boolean {
  try {
    return hasStamp(readFileSync(path, 'utf8'));
  } catch {
    // Unreadable is not stamped: the file stays.
    return false;
  }
}

function stagedContents(templates: string, file: ManagedFile): Buffer {
  try {
    return readFileSync(join(templates, file.staged));
  } catch (error) {
    throw new Error(
      `${file.staged} is declared in the payload but missing from the staged tree at ${templates}: ` +
        `${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function isVariableSet(group: PayloadGroup): group is VariableSet {
  return group.kind === 'variable-set';
}

/**
 * Reads the project and the staged payload and returns what would change. Touches
 * nothing.
 */
export function planInstall(projectRoot: string, options: PlanOptions): Plan {
  const templates = options.templates ?? stagedPayloadDir();
  const plan: Plan = {
    projectRoot,
    writes: [],
    current: [],
    deletions: [],
    scaffold: [],
    conflicts: [],
  };

  for (const { file } of payloadFiles()) {
    const contents = stagedContents(templates, file);
    const path = resolveInProject(projectRoot, file.target);
    const present = existsSync(path);

    if (present && isRegularFile(path) && readFileSync(path).equals(contents)) {
      plan.current.push(file.target);
      continue;
    }

    plan.writes.push({ target: file.target, contents, replaces: present });
  }

  const shipped = new Set(payloadFiles().map(({ file }) => file.target));

  for (const set of PAYLOAD.filter(isVariableSet)) {
    for (const candidate of reconcileCandidates(projectRoot, set)) {
      if (shipped.has(candidate)) continue;
      if (stampedOnDisk(join(projectRoot, candidate))) plan.deletions.push(candidate);
    }
  }

  // A fixed path is always written and can never be orphaned, so it is never a deletion
  // candidate — and by the same token never stamped, which is why an existing one has to
  // be surfaced rather than assumed to be jen's.
  for (const group of PAYLOAD) {
    if (group.kind !== 'fixed') continue;
    const planned = plan.writes.find((write) => write.target === group.file.target);
    if (planned?.replaces) plan.conflicts.push(group.file.target);
  }

  if (options.scaffold) {
    for (const file of SCAFFOLD) {
      if (existsSync(resolveInProject(projectRoot, file.target))) continue;
      plan.scaffold.push({ target: file.target, contents: stagedContents(templates, file), replaces: false });
    }
  }

  return plan;
}

/** Whether the plan would change anything on disk. */
export function isEmpty(plan: Plan): boolean {
  return plan.writes.length === 0 && plan.deletions.length === 0 && plan.scaffold.length === 0;
}

/** Every project path the plan would create, replace, or remove. */
export function touchedPaths(plan: Plan): string[] {
  return [
    ...plan.writes.map((write) => write.target),
    ...plan.scaffold.map((write) => write.target),
    ...plan.deletions,
  ];
}
