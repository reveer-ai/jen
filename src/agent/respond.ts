import type { Model } from "./model/port.ts";
import { runTurn } from "./loop.ts";
import type { Store } from "./store.ts";

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
