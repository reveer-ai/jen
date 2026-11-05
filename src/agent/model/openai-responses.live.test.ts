// Runs the loop against a real model. Set JEN_LIVE_API_KEY and JEN_LIVE_MODEL,
// plus JEN_LIVE_BASE_URL for an endpoint other than OpenAI's (for example
// https://openrouter.ai/api/v1). Skipped when the key or model is missing.

import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { Agent, type Tool } from "../loop.ts";
import { openStore } from "../store.ts";
import { OpenAIResponsesModel } from "./openai-responses.ts";

const apiKey = process.env.JEN_LIVE_API_KEY;
const model = process.env.JEN_LIVE_MODEL;
const baseURL = process.env.JEN_LIVE_BASE_URL;

test.skipIf(!apiKey || !model)("a turn completes a tool exchange with a real model", { timeout: 120_000 }, async () => {
  const secret = `jen-${randomBytes(4).toString("hex")}`;
  const tool: Tool = {
    name: "get_secret_word",
    description: "Returns today's secret word.",
    inputSchema: { type: "object", properties: {} },
    run: async () => secret,
  };
  const dir = mkdtempSync(join(tmpdir(), "jen-live-"));
  const store = openStore(join(dir, "agent.db"));
  try {
    const agent = new Agent({ store, model: new OpenAIResponsesModel({ model: model!, apiKey: apiKey!, baseURL }), tools: [tool], instructions: "" });
    const failures: string[] = [];
    agent.on("failure", (message: string) => failures.push(message));
    agent.start();
    agent.accept({ from: "owner", text: "What is today's secret word? Use the tool, then reply with the word.", urgent: false });
    await agent.idle();

    expect(failures).toEqual([]);
    const items = store.load();
    const call = items.find((item) => item.type === "tool_call");
    expect(call).toBeDefined();
    expect(items).toContainEqual({ type: "tool_result", callId: call!.id, output: secret });
    const last = items.at(-1)!;
    expect(last.type === "message" && last.role === "assistant" && last.text).toContain(secret);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
