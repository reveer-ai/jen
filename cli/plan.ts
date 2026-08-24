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
  substitute,
  type ManagedFile,
  type PayloadGroup,
  type VariableSet,
} from './payload.js';
import { resolveFromRegistry, type Resolution, type Unresolved } from './registry.js';
import { hasStamp } from './stamp.js';

/** One file to put on disk, with the bytes already read out of the staged payload. */
export interface PlannedWrite {
  /** Path in the project, relative to its root. */
  target: string;
  contents: Buffer;
  /** Whether something already occupies the path. */
  replaces: boolean;
  /**
   * Whether that something is a symlink, to be replaced rather than written through. The
   * link may point anywhere at all, so following it is how a write leaves the project.
   */
  symlink: boolean;
}

/** A managed path jen cannot reach without leaving the project on the way. */
export interface Obstruction {
  /** The managed path. */
  target: string;
  /** The project-relative directory between the root and it that is a symlink. */
  ancestor: string;
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
  /**
   * Substituted values a managed file referenced and the registry did not supply, each
   * with why. The file was still written — with the value empty — so this is a report
   * rather than a failure.
   */
  unresolved: Unresolved[];
  /**
   * Managed paths that lie behind a symlinked directory. Not a conflict — no amount of
   * forcing makes writing outside the project the right answer — so the caller's only
   * move is to refuse the run.
   */
  obstructions: Obstruction[];
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

/** What occupies a path, as the path itself reports it — a symlink is never its target. */
type EntryKind = 'absent' | 'file' | 'directory' | 'symlink' | 'other';

/**
 * Classifies a path without following it.
 *
 * Every check of a path in the project goes through here rather than `existsSync`, which
 * follows links: a dangling symlink at a managed path answers "absent" to `existsSync`,
 * and a write onto it then creates the file wherever the link pointed — outside the
 * project, silently, and without ever registering as a conflict.
 */
function entryKind(path: string): EntryKind {
  let stats;
  try {
    stats = lstatSync(path);
  } catch {
    return 'absent';
  }
  if (stats.isSymbolicLink()) return 'symlink';
  if (stats.isFile()) return 'file';
  if (stats.isDirectory()) return 'directory';
  return 'other';
}

function isRegularFile(path: string): boolean {
  return entryKind(path) === 'file';
}

/**
 * The first segment of a project-relative directory path that is a symlink, walking down
 * from the root — or undefined when every one of them is a real directory.
 */
function symlinkedSegment(projectRoot: string, path: string): string | undefined {
  let walked = '';
  for (const segment of path.split('/')) {
    walked = walked === '' ? segment : `${walked}/${segment}`;
    if (entryKind(join(projectRoot, walked)) === 'symlink') return walked;
  }
  return undefined;
}

/**
 * The symlinked directory standing between the project root and `target`, if there is one.
 *
 * The leaf is deliberately excluded: jen owns the managed path itself, so a link sitting
 * *at* one is something to replace. A link on the way *to* one is different — every
 * segment below it belongs to wherever the link points, and jen has no claim there.
 */
export function symlinkedAncestor(projectRoot: string, target: string): string | undefined {
  const segments = target.split('/');
  segments.pop();
  return segments.length === 0 ? undefined : symlinkedSegment(projectRoot, segments.join('/'));
}

/**
 * Resolves a project-relative path for writing, refusing anything that escapes the
 * project root — lexically, or by way of a symlinked directory on the way to it.
 *
 * {@link resolveInProject} compares resolved strings, which says nothing about what those
 * components are on disk. The executor re-checks both here, so a plan that went stale
 * between the two halves still cannot write outside.
 */
export function containedPath(projectRoot: string, target: string): string {
  const path = resolveInProject(projectRoot, target);
  const ancestor = symlinkedAncestor(projectRoot, target);
  if (ancestor !== undefined) {
    throw new Error(`refusing to touch ${target}: ${ancestor} is a symlink, and writing through it would leave the project`);
  }
  return path;
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

  // The same call as for a symlinked slot, one level up: `readdirSync` follows a link on
  // the target directory itself before any of the per-entry checks below apply, so
  // without this a deletion candidate could be a file outside the project entirely.
  if (symlinkedSegment(projectRoot, set.targetDir) !== undefined) return [];

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
 * A managed file's bytes as they will be written, recording anything that did not resolve.
 *
 * Rendering happens here, in the half that only reads, so the executor writes bytes the
 * plan already settled and `jen init`'s refusal path is untouched: a refused plan is still
 * never written, whatever it rendered.
 *
 * A name the file references that jen does not declare is reported like any other
 * unresolved value rather than passed through — the placeholder must not survive into the
 * output on any path, and an authoring mistake should be visible in the run's report.
 */
function render(plan: Plan, substitution: Resolution | undefined, file: ManagedFile, staged: Buffer): Buffer {
  if (!file.substituted || !substitution) return staged;

  const { contents, referenced } = substitute(staged, substitution.values);

  for (const name of referenced) {
    if (name in substitution.values) continue;
    if (plan.unresolved.some((entry) => entry.name === name)) continue;
    plan.unresolved.push({
      name,
      why:
        substitution.unresolved.find((entry) => entry.name === name)?.why ??
        `jen declares no value named \`${name}\``,
    });
  }

  return contents;
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
    unresolved: [],
    obstructions: [],
  };

  // Read once, and only where something is actually substituted, so a payload that carries
  // no values never opens the project's registry at all.
  const substitution = payloadFiles().some(({ file }) => file.substituted)
    ? resolveFromRegistry(projectRoot)
    : undefined;

  for (const { file } of payloadFiles()) {
    const contents = render(plan, substitution, file, stagedContents(templates, file));
    const path = resolveInProject(projectRoot, file.target);

    const ancestor = symlinkedAncestor(projectRoot, file.target);
    if (ancestor !== undefined) {
      plan.obstructions.push({ target: file.target, ancestor });
      continue;
    }

    const kind = entryKind(path);
    if (kind === 'file' && readFileSync(path).equals(contents)) {
      plan.current.push(file.target);
      continue;
    }

    plan.writes.push({
      target: file.target,
      contents,
      replaces: kind !== 'absent',
      symlink: kind === 'symlink',
    });
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
      const ancestor = symlinkedAncestor(projectRoot, file.target);
      if (ancestor !== undefined) {
        plan.obstructions.push({ target: file.target, ancestor });
        continue;
      }
      // Anything at all occupying the path means the project has one: a scaffold file is
      // written once and never again, and a symlink the project put there is its answer.
      if (entryKind(resolveInProject(projectRoot, file.target)) !== 'absent') continue;
      plan.scaffold.push({
        target: file.target,
        contents: stagedContents(templates, file),
        replaces: false,
        symlink: false,
      });
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
