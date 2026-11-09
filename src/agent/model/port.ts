// The model port: what jen needs from any model, in jen's own terms.
// No SDK type crosses it, and everything in it is plain JSON data.

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

// A user message is one the agent received, and from is its sender: an agent's
// ID, "owner" or "runtime", or empty for the agent's parent as its model sees
// it. An assistant message is the agent's own.
export type Item =
  | { type: "message"; role: "user"; from: string; text: string }
  | { type: "message"; role: "assistant"; text: string }
  | { type: "tool_call"; id: string; name: string; input: Json }
  | { type: "tool_result"; callId: string; output: string };

export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: Json;
}

export interface Model {
  // Takes the whole conversation, the tools and the system instructions, and
  // returns only the model's new items. Once signal fires, it fails promptly
  // with the signal's reason and returns nothing.
  next(items: readonly Item[], tools: readonly ToolSpec[], instructions: string, signal?: AbortSignal): Promise<Item[]>;
}
