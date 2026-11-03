// The OpenAI Responses adapter: the only module that imports the openai SDK.
// It reaches OpenAI, or a compatible endpoint such as OpenRouter by base URL.

import OpenAI from "openai";
import type {
  Response as OpenAIResponse,
  ResponseInputItem,
  ResponseOutputItem,
  Tool as FunctionTool,
} from "openai/resources/responses/responses";
import type { Item, Json, Model, ToolSpec } from "./port.ts";

export interface OpenAIResponsesOptions {
  model: string;
  apiKey: string;
  baseURL?: string;
  // Replaces the SDK's fetch. Tests use it to stub the network.
  fetch?: typeof globalThis.fetch;
}

export class OpenAIResponsesModel implements Model {
  readonly #model: string;
  readonly #client: OpenAI;

  constructor({ model, apiKey, baseURL, fetch }: OpenAIResponsesOptions) {
    this.#model = model;
    this.#client = new OpenAI({ apiKey, baseURL, fetch });
  }

  async next(items: readonly Item[], tools: readonly ToolSpec[]): Promise<Item[]> {
    let response: OpenAIResponse;
    try {
      response = await this.#client.responses.create({
        model: this.#model,
        input: items.map(toInput),
        tools: tools.map(toFunctionTool),
        store: false,
      });
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : String(error), { cause: error });
    }
    // A generation can fail inside a successful HTTP response.
    if (response.status === "failed" || response.error) {
      const message = response.error?.message ?? "generation failed";
      throw new Error(`OpenAIResponsesModel: ${message}`, { cause: response.error });
    }
    return response.output.flatMap(fromOutput);
  }
}

function toInput(item: Item): ResponseInputItem {
  switch (item.type) {
    case "message":
      return { role: item.role, content: item.text };
    case "tool_call":
      return { type: "function_call", call_id: item.id, name: item.name, arguments: JSON.stringify(item.input) };
    case "tool_result":
      return { type: "function_call_output", call_id: item.callId, output: item.output };
  }
}

function toFunctionTool(tool: ToolSpec): FunctionTool {
  return {
    type: "function",
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema as Record<string, Json>,
    strict: false,
  };
}

function fromOutput(item: ResponseOutputItem): Item[] {
  switch (item.type) {
    case "message": {
      // A refusal's explanation is the reply, so it's kept as text.
      const text = item.content.map((part) => (part.type === "output_text" ? part.text : part.refusal)).join("");
      return [{ type: "message", role: "assistant", text }];
    }
    case "function_call": {
      let input: Json;
      try {
        input = JSON.parse(item.arguments);
      } catch (error) {
        throw new Error(`OpenAIResponsesModel: tool call "${item.name}" has arguments that aren't valid JSON`, { cause: error });
      }
      return [{ type: "tool_call", id: item.call_id, name: item.name, input }];
    }
    case "reasoning":
      return [];
    default:
      throw new Error(`OpenAIResponsesModel: unmapped output item type "${item.type}"`);
  }
}
