import type { Item, Json, Model, ToolSpec } from "./model/port.ts";

export interface Tool extends ToolSpec {
  run(input: Json): Promise<string>;
}

// Runs one turn over a conversation the caller owns, and returns the turn's
// new items in order. The caller appends them. A model failure throws, and
// no items are returned for the turn.
export async function runTurn(
  model: Model,
  tools: readonly Tool[],
  conversation: readonly Item[],
  text: string,
): Promise<Item[]> {
  const specs: ToolSpec[] = tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
  const turn: Item[] = [{ type: "message", role: "user", text }];

  while (true) {
    const response = await model.next([...conversation, ...turn], specs);
    turn.push(...response);
    const calls = response.filter((item) => item.type === "tool_call");
    if (calls.length === 0) return turn;
    for (const call of calls) {
      turn.push({ type: "tool_result", callId: call.id, output: await runTool(tools, call.name, call.input) });
    }
  }
}

async function runTool(tools: readonly Tool[], name: string, input: Json): Promise<string> {
  const tool = tools.find((t) => t.name === name);
  if (tool === undefined) return `Error: unknown tool "${name}"`;
  try {
    return await tool.run(input);
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}
