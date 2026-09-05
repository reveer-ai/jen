/**
 * The project's registry, read for the tracker the runner polls.
 *
 * The registry is the project's own file — written once by `init` and never touched
 * again — and this is the only place jen reads it back. `jen watch` reads it as it
 * starts, so a runner pointed at a checkout polls whatever that checkout says it is
 * bound to, without either file editing the other.
 *
 * **Nothing here throws.** A registry that is absent, unparseable, or says nothing about a
 * tracker resolves to no values and a reason, because the caller's job is to say what it
 * could not find out — not to fail on a file it does not own. Every failure therefore
 * comes back as a `why` a person can act on, and the runner's refusal is built out of them.
 *
 * The parse goes through `yaml` rather than a line reader. The file is hand-authored by
 * adopters, and a narrow parser's failure mode is a confidently wrong value — a runner
 * polling a project nobody named — where a reported absence fails visibly.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parse } from 'yaml';

/**
 * Every value the registry can answer for, and the whole of what a caller may ask it.
 *
 * A closed set, declared here as data: there is no way for a caller to reach a name the
 * registry has not listed, and no conditional, loop, or expression anywhere in the form.
 * What jen is allowed to read out of a project's own file is a decision that belongs in
 * this list, not at the call site.
 */
export const REGISTRY_VALUES = ['team', 'project'] as const;

export type RegistryValueName = (typeof REGISTRY_VALUES)[number];

/** The project-relative path of the registry. Fixed: `init` writes it, and nothing moves it. */
export const REGISTRY_FILE = 'registry.yaml';

/** The one resource kind that names a tracker team and project. */
export const TRACKER_KIND = 'project-management';

/** A value that could not be resolved, and what a person would have to change. */
export interface Unresolved {
  name: string;
  why: string;
}

/** What the registry supplied, and why it supplied nothing where it did not. */
export interface Resolution {
  values: Partial<Record<RegistryValueName, string>>;
  unresolved: Unresolved[];
}

type Resource = Record<string, unknown>;

function detail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** A non-empty scalar, or nothing. A key present but blank is the same as an absent one. */
function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

function isTracker(resource: unknown): resource is Resource {
  return typeof resource === 'object' && resource !== null && (resource as Resource).kind === TRACKER_KIND;
}

/**
 * The single `project-management` resource, or why there is not one.
 *
 * Zero and several are both "no answer" rather than a best guess: a tick takes one team and
 * one project, so choosing between two would be inventing a binding the project never wrote.
 */
function tracker(projectRoot: string): { resource: Resource } | { why: string } {
  let source: string;
  try {
    source = readFileSync(join(projectRoot, REGISTRY_FILE), 'utf8');
  } catch {
    return { why: `the project has no ${REGISTRY_FILE}` };
  }

  let parsed: unknown;
  try {
    parsed = parse(source);
  } catch (error) {
    return { why: `${REGISTRY_FILE} could not be parsed: ${detail(error)}` };
  }

  const resources = typeof parsed === 'object' && parsed !== null ? (parsed as Resource).resources : undefined;
  if (!Array.isArray(resources)) return { why: `${REGISTRY_FILE} declares no \`resources\` list` };

  const found = resources.filter(isTracker);
  if (found.length === 0) return { why: `${REGISTRY_FILE} names no \`kind: ${TRACKER_KIND}\` resource` };
  if (found.length > 1) {
    return {
      why: `${REGISTRY_FILE} names ${found.length} \`kind: ${TRACKER_KIND}\` resources, and a runner polls one`,
    };
  }

  return { resource: found[0]! };
}

/**
 * Every value the registry supplies, and a reason for each one it does not.
 *
 * The names jen asks for and the fields the tracker resource carries are deliberately the
 * same words — `team` and `project` — so the registry reads as the answer to the runner's
 * question rather than as a second vocabulary mapped onto it.
 */
export function resolveFromRegistry(projectRoot: string): Resolution {
  const reading = tracker(projectRoot);
  if ('why' in reading) {
    return { values: {}, unresolved: REGISTRY_VALUES.map((name) => ({ name, why: reading.why })) };
  }

  const values: Partial<Record<RegistryValueName, string>> = {};
  const unresolved: Unresolved[] = [];

  for (const name of REGISTRY_VALUES) {
    const value = text(reading.resource[name]);
    if (value === undefined) {
      unresolved.push({ name, why: `the \`${TRACKER_KIND}\` resource in ${REGISTRY_FILE} names no \`${name}\`` });
    } else {
      values[name] = value;
    }
  }

  return { values, unresolved };
}
