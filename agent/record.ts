/**
 * The one agent record: what constitutes an agent, declared once.
 *
 * This module belongs to neither the sandbox nor the runtime, which is why it sits above
 * both rather than inside either. The sandbox needs some of these fields to provision; the
 * runtime needs all of them to think. If either owned the declaration the other would have
 * to import it, and the two would be coupled through a type neither of them is about.
 *
 * **There is exactly one record type, and that is the whole point.** The record used to
 * construct the agent nobody spawned is the same type an agent supplies when it spawns
 * another. A second type for the root — or a superset, or a variant with one extra field —
 * would make the epic's homogeneity constraint something asserted in prose rather than
 * something the compiler holds. Two shapes that agree today are a divergence waiting to
 * happen, and the divergence would not be visible at the point it was introduced.
 *
 * **The record is inert.** It carries credentials as references to be resolved, never as
 * values, so it is safe to persist beside the project, to write into a log, and to hand to
 * a parent that asks what its child is. Nothing here has to be guarded, and that is a
 * property of the type rather than of the care taken by each place that handles one.
 */

/**
 * Where a secret is to be found, never the secret itself.
 *
 * `name` is the variable the resolved value is delivered under; `ref` says where to
 * resolve it from, in a form the resolver understands.
 */
export interface CredentialReference {
  name: string;
  ref: string;
}

/**
 * Which model an agent reasons with, and where to reach it.
 *
 * `baseURL` is the seam. Anything speaking the OpenAI-compatible chat-completions surface
 * is reachable by configuration rather than by code, so the provider is a value in a record
 * and not a commitment in the runtime.
 *
 * `credential` **names one of the record's own {@link AgentRecord.credentials}**; it does
 * not restate the reference. Two references to one secret would be two places to get it
 * wrong, and they would disagree silently — the model client would authenticate with one
 * and everything else with the other.
 */
export interface ModelConfiguration {
  /** Informational: who is behind `baseURL`. Nothing branches on it. */
  provider: string;
  /** The root of an OpenAI-compatible API. */
  baseURL: string;
  /** The model identifier, as that provider spells it. */
  model: string;
  /** The name of the credential — among {@link AgentRecord.credentials} — to authenticate with. */
  credential: string;
}

/**
 * An agent, entire.
 *
 * `parent` is the one field that says where an agent sits, and it is the one field the
 * sandbox is never shown — see the derived form in `sandbox/index.ts`. `null` denotes the
 * agent nobody spawned. It is not a flag for "the root": a runtime never branches on it,
 * and nothing about the agent's construction differs because of it.
 */
export interface AgentRecord {
  /** Identifies the agent. Its workspace is keyed by this, and outlives any one sandbox. */
  id: string;
  /** What this agent is called, for a parent reading a transcript. */
  name: string;
  /** What this agent is for. Becomes the first event in its log and never changes after. */
  charter: string;
  /** Which model it reasons with. */
  model: ModelConfiguration;
  /** Where inside the sandbox the agent's workspace is rooted. */
  workspace: string;
  /**
   * The environment the agent's sandbox is built from, in whatever form the substrate's
   * driver understands. The substrate supplies no default and builds nothing: a default
   * here would quietly become the thing everyone used, and defining the toolchain is the
   * project's job.
   */
  environment: string;
  /**
   * The capabilities this agent may reach, by name.
   *
   * This is where unequal authority lives. Two agents run byte-identical runtimes and can
   * do different things because their records name different capabilities — never because
   * one runtime holds something the other does not.
   */
  tools: string[];
  /** Resolved at sandbox creation and delivered into the agent's environment. */
  credentials: CredentialReference[];
  /** The agent that spawned this one, or `null` for the agent nobody spawned. */
  parent: string | null;
}

/** What a record that cannot be read is reported as. */
export class RecordError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RecordError';
  }
}

function object(value: unknown, at: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new RecordError(`${at} is not an object`);
  }
  return value as Record<string, unknown>;
}

function string(source: Record<string, unknown>, key: string, at: string): string {
  const value = source[key];
  if (typeof value !== 'string') throw new RecordError(`${at}.${key} is missing or is not a string`);
  return value;
}

function strings(source: Record<string, unknown>, key: string, at: string): string[] {
  const value = source[key];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new RecordError(`${at}.${key} is missing or is not an array of strings`);
  }
  return value as string[];
}

/**
 * Reads a record from whatever arrived, or says what it could not read.
 *
 * Every failure names the field, because the thing this guards against in practice is not
 * a malformed document — it is a *truncated* one. The boot frame shares a pipe with the
 * sandbox's credential delivery, so a prologue that consumed one byte too many arrives
 * here as a record missing its first field rather than as a pipe error. An error saying
 * `record.id is missing` is what makes that diagnosable; `invalid record` is not.
 */
export function parseRecord(value: unknown, at = 'record'): AgentRecord {
  const source = object(value, at);
  const model = object(source.model, `${at}.model`);
  const credentials = source.credentials;
  if (!Array.isArray(credentials)) {
    throw new RecordError(`${at}.credentials is missing or is not an array`);
  }

  const parent = source.parent;
  if (parent !== null && typeof parent !== 'string') {
    throw new RecordError(`${at}.parent is missing or is neither a string nor null`);
  }

  const record: AgentRecord = {
    id: string(source, 'id', at),
    name: string(source, 'name', at),
    charter: string(source, 'charter', at),
    model: {
      provider: string(model, 'provider', `${at}.model`),
      baseURL: string(model, 'baseURL', `${at}.model`),
      model: string(model, 'model', `${at}.model`),
      credential: string(model, 'credential', `${at}.model`),
    },
    workspace: string(source, 'workspace', at),
    environment: string(source, 'environment', at),
    tools: strings(source, 'tools', at),
    credentials: credentials.map((entry, index) => {
      const reference = object(entry, `${at}.credentials[${index}]`);
      return {
        name: string(reference, 'name', `${at}.credentials[${index}]`),
        ref: string(reference, 'ref', `${at}.credentials[${index}]`),
      };
    }),
    parent,
  };

  // The one cross-field rule, and the reason it is checked here rather than left to the
  // model client: a `model.credential` naming nothing is a record that provisions a sandbox
  // successfully and then fails to authenticate on its first step, after the agent has been
  // told it is running. Caught at the record, it is a record problem, which is what it is.
  if (!record.credentials.some((reference) => reference.name === record.model.credential)) {
    throw new RecordError(
      `${at}.model.credential names "${record.model.credential}", which is not among ${at}.credentials`,
    );
  }

  return record;
}
