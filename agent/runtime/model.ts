/**
 * The model, behind a seam narrow enough to substitute.
 *
 * One operation: a step in, an assistant's answer out. **This is not an abstraction layer
 * over providers** — the OpenAI-compatible surface at a configurable `baseURL` is already
 * that, and wrapping it again would buy agnosticism twice while absorbing a breaking major
 * roughly every seven months in the component that must not wobble. The seam exists so the
 * loop and the resume tests can run against a scripted double, because the property those
 * tests are about is *what we send*, and a live model makes that comparison
 * non-deterministic for reasons that have nothing to do with what is being tested.
 *
 * **The client's own loop-running facilities are not used and must not be.** `runTools` and
 * the runner helpers will dispatch tool calls and take the next step on your behalf, and
 * the result looks like working code — which is exactly why a source-level test guards
 * their absence. Delegating that loop would hand the substrate's central decision to a
 * library: the agent's loop is the agent's, not the coding assistant's and not a vendor's.
 * `stream()` is used and is not one of them; it accumulates chunks into one completion and
 * dispatches nothing. Tool-call deltas arrive as index-keyed fragments whose `arguments`
 * split at arbitrary byte boundaries, and reassembling those is the one part of this
 * surface genuinely worth not owning.
 */
import OpenAI from 'openai';

import type { AgentRecord } from '../record.ts';
import type { Call, ToolDeclaration } from './capability.ts';
import type { Message } from './projection.ts';

/**
 * One request, as it goes out.
 *
 * This is the thing resume has to reproduce byte for byte, so nothing that is not part of
 * the conversation belongs in it — no timestamps, no attempt counters, no request ids.
 */
export interface ModelRequest {
  model: string;
  messages: Message[];
  tools?: ToolDeclaration[];
}

/** What the model produced, with the provider's own shapes kept whole. */
export interface ModelStep {
  content: string;
  /**
   * What the model declined to do, in its own words, or `null`.
   *
   * Separate from `content` because the provider keeps it separate, and because a refusal
   * replayed as content would tell the model on its next step that it said something it did
   * not say. It is still the agent's message to its parent — see `index.ts`.
   */
  refusal: string | null;
  calls: Call[];
  reasoning: { content: string; opaque?: Record<string, unknown> } | null;
  usage: { in: number; out: number; model: string };
}

export interface ModelClient {
  step(request: ModelRequest, signal: AbortSignal): Promise<ModelStep>;
}

/** What a step that could not be taken is reported as. */
export class ModelError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ModelError';
  }
}

/**
 * The fields the standard itself defines on a response message.
 *
 * **`opaque` carries a provider's *extensions*, and this is how they are recognised.** The
 * earlier rule — everything the projection does not produce — was wrong in a way nothing in
 * this directory could see. `annotations` and `refusal` are ordinary OpenAI response fields
 * that a real gateway sets on an ordinary reply, so a message with no reasoning anywhere in
 * it produced a `reasoning` event with empty content, and `annotations` was then replayed
 * onto the assistant message of every later request. `ChatCompletionAssistantMessageParam`
 * does not define `annotations` at all — so that was a field the request schema rejects,
 * going out on the live wire, while the resume comparison stayed green because both of its
 * paths were wrong identically.
 *
 * The rule still names no reasoning field, which is the property worth keeping: a provider
 * that invents one tomorrow is carried without a change here. What it names instead is the
 * standard — knowable, finite, and versioned alongside the SDK that states it.
 *
 * A standard field is therefore either carried deliberately or not sent back at all, and
 * dropping one is silent — so the set is worth reading as a list of decisions. `refusal` is
 * carried: it arrives on `ModelStep` below, the loop records it as the agent's own message,
 * and the projection replays it into the field it came from. The rest are dropped, `audio`
 * being the one a provider could actually set: a text agent has nothing to do with it, and
 * a reply carrying audio with null content would lose everything it said. That is the
 * general rule and not a gap around one field — a standard field nothing here picks up
 * reaches neither the transcript nor the next request.
 */
const STANDARD = new Set(['role', 'content', 'refusal', 'annotations', 'audio', 'function_call', 'tool_calls']);

/**
 * Where a provider states its reasoning as text a person can read, most specific first.
 *
 * This decides what the *transcript* shows and nothing else. A field read for its text is
 * still carried in `opaque` and still replayed, so the same text can appear in both — which
 * looks like duplication and is two jobs: `agent-runtime` requires provider reasoning to be
 * replayed *without being interpreted*, and holding a field back because we found it
 * readable would be exactly that interpretation. Only a string is read; a provider spelling
 * `reasoning` as a structure means it for replay, and gets no transcript text from it.
 */
const READABLE = ['reasoning_content', 'reasoning'];

/**
 * Build the client from the record, and read the secret from the environment.
 *
 * The record names which credential to authenticate with; the *value* arrives in the
 * process environment, delivered by the sandbox at the moment this process started. The two
 * never meet on disk, and the record stays inert — see `record.ts`.
 */
export function openAIClient(record: AgentRecord, environment: NodeJS.ProcessEnv = process.env): ModelClient {
  const apiKey = environment[record.model.credential];
  if (apiKey === undefined || apiKey === '') {
    // Names the variable and never a value. This is the one place a secret escapes into a
    // log without anyone meaning it to.
    throw new ModelError(
      `the credential \`${record.model.credential}\` was not delivered to this process, so the model cannot be reached.`,
    );
  }

  const client = new OpenAI({ baseURL: record.model.baseURL, apiKey });

  return {
    async step(request, signal) {
      const stream = client.chat.completions.stream(
        {
          model: request.model,
          messages: request.messages as never,
          ...(request.tools === undefined ? {} : { tools: request.tools as never }),
        },
        { signal },
      );

      const completion = await stream.finalChatCompletion();
      const choice = completion.choices[0];
      if (choice === undefined) throw new ModelError('the provider returned a completion with no choices.');

      const message = choice.message as unknown as Record<string, unknown>;

      const calls = (choice.message.tool_calls ?? []).flatMap((call): Call[] =>
        call.type === 'function' ? [{ id: call.id, name: call.function.name, arguments: call.function.arguments }] : [],
      );

      const readable =
        READABLE.map((key) => message[key]).find(
          (value): value is string => typeof value === 'string' && value !== '',
        ) ?? '';

      const opaque = Object.fromEntries(
        Object.entries(message).filter(
          ([key, value]) => !STANDARD.has(key) && value !== null && value !== undefined,
        ),
      );

      return {
        content: choice.message.content ?? '',
        // An empty string is not a refusal. Treating one as such would mark an ordinary
        // message as declined and give a parent nothing to read for the reason.
        refusal: typeof message.refusal === 'string' && message.refusal !== '' ? message.refusal : null,
        calls,
        reasoning:
          readable === '' && Object.keys(opaque).length === 0
            ? null
            : { content: readable, ...(Object.keys(opaque).length === 0 ? {} : { opaque }) },
        usage: {
          in: completion.usage?.prompt_tokens ?? 0,
          out: completion.usage?.completion_tokens ?? 0,
          model: completion.model,
        },
      };
    },
  };
}
