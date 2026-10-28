// The agent's entrypoint in its container: one message per run.
// docker run … jen "hello" prints the reply and exits.

import { runTurn } from "./agent/loop.ts";
import { openStore, type Store } from "./agent/store.ts";
import { OpenAIResponsesModel } from "./model/openai-responses.ts";
import type { Model } from "./model/port.ts";

// Runs one turn on the stored conversation, saves it once it completes, and
// returns the text of the assistant messages that end it. A failed turn
// throws and saves nothing.
export async function respond(store: Store, model: Model, text: string): Promise<string> {
  const turn = await runTurn(model, [], store.load(), text);
  store.append(turn);
  const replies: string[] = [];
  for (const item of turn.toReversed()) {
    if (item.type !== "message" || item.role !== "assistant") break;
    replies.unshift(item.text);
  }
  return replies.join("\n\n");
}

if (import.meta.main) {
  // Node is PID 1 in the container, which gets no default signal handling.
  // Exiting mid-turn saves nothing.
  process.on("SIGINT", () => process.exit(130));
  process.on("SIGTERM", () => process.exit(143));

  for (const name of ["JEN_MODEL", "JEN_API_KEY"]) {
    if (!process.env[name]) fail(`${name} is not set`);
  }
  const text = process.argv.slice(2).join(" ");
  if (text === "") fail("no message: pass it as arguments");

  const model = new OpenAIResponsesModel({
    model: process.env.JEN_MODEL!,
    apiKey: process.env.JEN_API_KEY!,
    baseURL: process.env.JEN_BASE_URL || undefined,
  });
  const store = openStore("/state/agent.db");
  try {
    process.stdout.write(`${await respond(store, model, text)}\n`);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  } finally {
    store.close();
  }
}

function fail(message: string): never {
  process.stderr.write(`jen: ${message}\n`);
  process.exit(1);
}
