import type { Item } from "./port.ts";

// What an agent replied to its parent, read from its saved items, for the
// live checks: the joined, trimmed text of each model response with no tool
// call. A response is a run of assistant messages and tool calls, ended by
// any other item. Its text may come before, between or after its calls, and
// any call means none of its text is a reply.
//
// The last response may still be arriving, since a stream can split one
// response's items across reads. A caller that needs a final answer reads it
// only once the stream has been quiet for a moment.
export function replies(items: readonly Item[]): string[] {
  const found: string[] = [];
  let text = "";
  let called = false;
  const end = () => {
    if (!called && text.trim() !== "") found.push(text.trim());
    text = "";
    called = false;
  };
  for (const item of items) {
    if (item.type === "message" && item.role === "assistant") text += item.text;
    else if (item.type === "tool_call") called = true;
    else end();
  }
  end();
  return found;
}
