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

import type { AgentRecord } from '../record.js';
import type { Call, ToolDeclaration } from './capability.js';
import type { Message } from './projection.js';

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
 * The keys the projection produces itself.
 *
 * Everything else on an assistant message is the provider's own, and is carried back as
 * `opaque` for replay without being read. Reasoning is the field this exists for, and the
 * representation differs by provider — so the rule is stated by exclusion rather than by a
 * list of the reasoning fields we happen to know about today.
 */
const PROJECTED = new Set(['role', 'content', 'tool_calls', 'tool_call_id']);

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

      const opaque = Object.fromEntries(
        Object.entries(message).filter(([key, value]) => !PROJECTED.has(key) && value !== null && value !== undefined),
      );
      const readable = typeof message.reasoning_content === 'string'
        ? message.reasoning_content
        : typeof message.reasoning === 'string'
          ? message.reasoning
          : '';

      return {
        content: choice.message.content ?? '',
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
