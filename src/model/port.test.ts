import { expect, test } from "vitest";
import type { Item, ToolSpec } from "./port.ts";

test("items and tool descriptions survive a JSON round trip", () => {
  const items: Item[] = [
    { type: "message", role: "user", text: "what is a?" },
    { type: "tool_call", id: "c1", name: "lookup", input: { key: "a", depth: 2, deep: [true, null] } },
    { type: "tool_result", callId: "c1", output: "42" },
    { type: "message", role: "assistant", text: "a is 42" },
  ];
  const tool: ToolSpec = {
    name: "lookup",
    description: "Look up a key.",
    inputSchema: { type: "object", properties: { key: { type: "string" } }, required: ["key"] },
  };

  expect(JSON.parse(JSON.stringify(items))).toEqual(items);
  expect(JSON.parse(JSON.stringify(tool))).toEqual(tool);
});
