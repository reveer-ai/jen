/**
 * The transcript: an ordered log of what happened, not the message array sent to a
 * provider.
 *
 * **Why events rather than the wire shapes.** Timestamps, token counts, how long each
 * capability invocation took and whether it succeeded are what make a transcript a
 * *verification* surface rather than merely a resumable one — a parent that cannot
 * reconstruct what a child did from it has no way to catch a confident lie, and a claim an
 * agent writes about itself is exactly as forgeable as the prose beside it. The provider's
 * message array cannot carry any of that. Storing events also keeps the record off the
 * provider's side of a seam the substrate expects to move.
 *
 * Everything here is plain data. The log is written as JSON, read back as JSON, and the
 * only thing that turns it into a conversation is `projection.ts`.
 */

/** Every event carries when it happened. Nothing in the projection reads it. */
interface Occurrence {
  at: string;
}

/** What the agent is for. First in the log, once, and never again. */
export interface CharterEvent extends Occurrence {
  type: 'charter';
  content: string;
}

/**
 * A message between the agent and its parent.
 *
 * `self` is what the agent said. It is the *only* completion signal there is: a turn ends
 * when the model produces content with nothing outstanding, and that content is the
 * message. There is no status field and no separate channel — see `loop.ts`.
 */
export interface MessageEvent extends Occurrence {
  type: 'message';
  from: 'parent' | 'self';
  content: string;
}

/** The model asked for a capability. `arguments` is the provider's JSON string, unparsed. */
export interface ToolCallEvent extends Occurrence {
  type: 'tool_call';
  id: string;
  name: string;
  arguments: string;
}

/**
 * What came back.
 *
 * `ok` and `ms` are here for the parent reading the transcript rather than for the model,
 * which sees only `content`. A capability that failed is still a result; see `loop.ts`.
 */
export interface ToolResultEvent extends Occurrence {
  type: 'tool_result';
  id: string;
  content: string;
  ok: boolean;
  ms: number;
}

/**
 * Reasoning the provider returned in a representation of its own.
 *
 * Two fields doing two different jobs, and conflating them is the mistake to avoid.
 * `content` is the readable text, kept for whoever reads the transcript. `opaque` is
 * whatever the provider handed back for replaying it, and the projection puts it onto the
 * assistant message **verbatim, without looking inside it**. Nothing here invents a wire
 * field: a provider that supplies no representation of its own gets none replayed, and the
 * text stays transcript-only.
 *
 * Exactly one provider is exercised today, so this is a shape that anticipates the problem
 * rather than a solution to it. The second provider is what will actually test it.
 */
export interface ReasoningEvent extends Occurrence {
  type: 'reasoning';
  content: string;
  opaque?: Record<string, unknown>;
}

/** What a step cost. Never projected — it is a fact about the exchange, not part of it. */
export interface UsageEvent extends Occurrence {
  type: 'usage';
  in: number;
  out: number;
  model: string;
}

export type Event =
  | CharterEvent
  | MessageEvent
  | ToolCallEvent
  | ToolResultEvent
  | ReasoningEvent
  | UsageEvent;

/** What a log that cannot be read is reported as. */
export class EventLogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EventLogError';
  }
}

function at(source: Record<string, unknown>, index: number): string {
  if (typeof source.at !== 'string') throw new EventLogError(`events[${index}].at is missing or is not a string`);
  return source.at;
}

function text(source: Record<string, unknown>, key: string, index: number): string {
  const value = source[key];
  if (typeof value !== 'string') throw new EventLogError(`events[${index}].${key} is missing or is not a string`);
  return value;
}

function count(source: Record<string, unknown>, key: string, index: number): number {
  const value = source[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new EventLogError(`events[${index}].${key} is missing or is not a number`);
  }
  return value;
}

function one(value: unknown, index: number): Event {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new EventLogError(`events[${index}] is not an object`);
  }
  const source = value as Record<string, unknown>;
  const when = at(source, index);

  switch (source.type) {
    case 'charter':
      return { type: 'charter', at: when, content: text(source, 'content', index) };
    case 'message': {
      const from = source.from;
      if (from !== 'parent' && from !== 'self') {
        throw new EventLogError(`events[${index}].from is neither "parent" nor "self"`);
      }
      return { type: 'message', at: when, from, content: text(source, 'content', index) };
    }
    case 'tool_call':
      return {
        type: 'tool_call',
        at: when,
        id: text(source, 'id', index),
        name: text(source, 'name', index),
        arguments: text(source, 'arguments', index),
      };
    case 'tool_result': {
      if (typeof source.ok !== 'boolean') throw new EventLogError(`events[${index}].ok is missing or is not a boolean`);
      return {
        type: 'tool_result',
        at: when,
        id: text(source, 'id', index),
        content: text(source, 'content', index),
        ok: source.ok,
        ms: count(source, 'ms', index),
      };
    }
    case 'reasoning': {
      const event: ReasoningEvent = { type: 'reasoning', at: when, content: text(source, 'content', index) };
      if (source.opaque !== undefined) {
        if (typeof source.opaque !== 'object' || source.opaque === null || Array.isArray(source.opaque)) {
          throw new EventLogError(`events[${index}].opaque is not an object`);
        }
        event.opaque = source.opaque as Record<string, unknown>;
      }
      return event;
    }
    case 'usage':
      return {
        type: 'usage',
        at: when,
        in: count(source, 'in', index),
        out: count(source, 'out', index),
        model: text(source, 'model', index),
      };
    default:
      throw new EventLogError(`events[${index}].type is "${String(source.type)}", which is not an event type`);
  }
}

/**
 * Reads a log, or says which event it could not read and why.
 *
 * An empty log is valid and denotes an agent that has not yet run. That is not a special
 * case handled anywhere — it is simply a log with nothing in it, which the projection
 * turns into an empty conversation and the loop starts from.
 */
export function parseEvents(value: unknown, at = 'events'): Event[] {
  if (!Array.isArray(value)) throw new EventLogError(`${at} is missing or is not an array`);
  return value.map(one);
}

/** What the synthesized answer says. Addressed to the model, which is who has to act on it. */
export const INTERRUPTED =
  'This call was interrupted by a restart before its result was recorded. Whether it took effect is unknown; it was not retried.';

/**
 * Answer every capability call the log left unanswered.
 *
 * A log ending in a `tool_call` with no `tool_result` is what an interruption looks like:
 * the model decided to call something, the call went out, and the process died before the
 * answer was written down. A provider rejects that outright — every call must be answered,
 * immediately — so **doing nothing is not an available behaviour**; the agent would simply
 * fail to boot.
 *
 * What it is not: the call is **not re-executed**, because nothing recorded whether it took
 * effect before the interruption, and a `spawn` or a push that happened twice is worse than
 * an admission of ignorance. And the model's decision is **not rewound**, because that
 * erases something the agent really did and hides an effect that may really have landed.
 *
 * The synthesized answer is appended **as a real event**, which is what makes it stable: a
 * parent reading the transcript sees that it happened, and a later resume projects it like
 * any other event rather than deriving a second one.
 */
export function answerInterrupted(events: readonly Event[], now: () => string): Event[] {
  const answered = new Set(events.filter((event) => event.type === 'tool_result').map((event) => event.id));
  const unanswered = events.filter(
    (event): event is ToolCallEvent => event.type === 'tool_call' && !answered.has(event.id),
  );
  if (unanswered.length === 0) return [...events];

  return [
    ...events,
    ...unanswered.map((call): ToolResultEvent => ({
      type: 'tool_result',
      at: now(),
      id: call.id,
      content: INTERRUPTED,
      ok: false,
      ms: 0,
    })),
  ];
}
