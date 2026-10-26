import type { Item, Model, ToolSpec } from "./port.ts";

// A model that plays back fixed turns and records what it was sent.
export class ScriptedModel implements Model {
  readonly calls: { items: Item[]; tools: ToolSpec[] }[] = [];
  readonly #turns: Item[][];

  constructor(turns: Item[][]) {
    this.#turns = structuredClone(turns);
  }

  async next(items: readonly Item[], tools: readonly ToolSpec[]): Promise<Item[]> {
    this.calls.push(structuredClone({ items: [...items], tools: [...tools] }));
    const turn = this.#turns[this.calls.length - 1];
    if (turn === undefined) {
      throw new Error(`ScriptedModel: script exhausted after ${this.#turns.length} turns`);
    }
    return structuredClone(turn);
  }
}
