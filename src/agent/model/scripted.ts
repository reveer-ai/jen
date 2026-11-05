import type { Item, Model, ToolSpec } from "./port.ts";

// A model that plays back fixed turns and records what it was sent. A call
// whose signal has already fired fails with its reason, and uses no turn.
export class ScriptedModel implements Model {
  readonly calls: { items: Item[]; tools: ToolSpec[]; instructions: string }[] = [];
  readonly #turns: Item[][];

  constructor(turns: Item[][]) {
    this.#turns = structuredClone(turns);
  }

  async next(items: readonly Item[], tools: readonly ToolSpec[], instructions: string, signal?: AbortSignal): Promise<Item[]> {
    signal?.throwIfAborted();
    this.calls.push(structuredClone({ items: [...items], tools: [...tools], instructions }));
    const turn = this.#turns[this.calls.length - 1];
    if (turn === undefined) {
      throw new Error(`ScriptedModel: script exhausted after ${this.#turns.length} turns`);
    }
    return structuredClone(turn);
  }
}
