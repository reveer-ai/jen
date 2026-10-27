// The model port: what jen needs from any model, in jen's own terms.
// No SDK type crosses it, and everything in it is plain JSON data.

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export type Item =
  | { type: "message"; role: "user" | "assistant"; text: string }
  | { type: "tool_call"; id: string; name: string; input: Json }
  | { type: "tool_result"; callId: string; output: string };

export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: Json;
}

export interface Model {
  // Takes the whole conversation and returns only the model's new items.
  next(items: readonly Item[], tools: readonly ToolSpec[]): Promise<Item[]>;
}
