/**
 * The one projection: an event log in, the provider's message array out.
 *
 * **This is the only implementation, and it serves both paths.** The runtime uses it while
 * working and uses it again when it boots from a prior log. That is the whole mechanism
 * behind "a resumed agent is indistinguishable to the model": if the supervisor projected
 * for resume while the runtime projected while live, the guarantee would rest on two
 * implementations staying in agreement, and nothing on either side alone could catch them
 * drifting. One implementation makes it structural instead.
 *
 * **It is deterministic, and that is not a nicety.** Providers key prompt caches on prefix
 * content, so a projection that varied by one whitespace character would miss cache on
 * every resume — silently, and expensively. Nothing here reads a clock, a random source, or
 * anything outside the log it was handed; `at` is deliberately not projected, because the
 * message array has nowhere to put it and a resumed run would spell it differently.
 */
import type { Event } from './events.js';

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

/**
 * A message as the provider takes it.
 *
 * The index signature is what lets a provider's own reasoning representation be replayed
 * onto an assistant message without this module knowing a single thing about its shape.
 */
export type Message = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
} & Record<string, unknown>;

/**
 * Fold a log into a conversation.
 *
 * The only structural work is grouping: a run of `reasoning`, self `message` and
 * `tool_call` events is one assistant turn and has to become **one** message, because a
 * provider requires each assistant message's tool calls to be answered by the results that
 * immediately follow it. The run ends where an answer or the other side's turn begins.
 *
 * Key insertion order is fixed by this function and by nothing else, which is what makes
 * the serialized bytes stable across runs.
 */
export function project(events: readonly Event[]): Message[] {
  const messages: Message[] = [];

  let content: string | null = null;
  let calls: ToolCall[] = [];
  let replayed: Record<string, unknown> = {};
  let pending = false;

  function flush(): void {
    if (!pending) return;
    const message: Message = { role: 'assistant', content };
    if (calls.length > 0) message.tool_calls = calls;
    // Last, and verbatim: whatever the provider gave back for its own reasoning goes on
    // exactly as it came, and this module never looks inside it. Applied after the known
    // fields so the key order does not depend on what a provider happened to send.
    for (const [key, value] of Object.entries(replayed)) message[key] = value;
    messages.push(message);
    content = null;
    calls = [];
    replayed = {};
    pending = false;
  }

  for (const event of events) {
    switch (event.type) {
      case 'charter':
        flush();
        messages.push({ role: 'system', content: event.content });
        break;

      case 'message':
        if (event.from === 'parent') {
          flush();
          messages.push({ role: 'user', content: event.content });
          break;
        }
        // The agent's own words. They belong to the assistant turn being accumulated —
        // whether they end it, or whether the model said something alongside the
        // capabilities it called.
        content = content === null ? event.content : `${content}${event.content}`;
        pending = true;
        break;

      case 'reasoning':
        if (event.opaque !== undefined) replayed = { ...replayed, ...event.opaque };
        pending = true;
        break;

      case 'tool_call':
        calls.push({ id: event.id, type: 'function', function: { name: event.name, arguments: event.arguments } });
        pending = true;
        break;

      case 'tool_result':
        // The answer closes the assistant message that asked, so that the calls and their
        // results end up adjacent in the order the provider requires.
        flush();
        messages.push({ role: 'tool', content: event.content, tool_call_id: event.id });
        break;

      case 'usage':
        // Never projected. It is a fact about the exchange rather than part of it, and a
        // message array has nowhere to put it.
        break;
    }
  }

  flush();
  return messages;
}
