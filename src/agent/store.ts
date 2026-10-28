import { DatabaseSync } from "node:sqlite";
import type { Item } from "../model/port.ts";

// The conversation, kept in SQLite as one JSON row per item.
export interface Store {
  load(): Item[];
  // Saves a turn's items whole, or none of them.
  append(items: readonly Item[]): void;
  close(): void;
}

// Opens the store at path, creating the file and its table when they don't exist.
export function openStore(path: string): Store {
  const db = new DatabaseSync(path);
  db.exec("CREATE TABLE IF NOT EXISTS items (seq INTEGER PRIMARY KEY, item TEXT NOT NULL)");
  const select = db.prepare("SELECT item FROM items ORDER BY seq");
  const insert = db.prepare("INSERT INTO items (item) VALUES (?)");

  return {
    load: () => select.all().map((row) => JSON.parse(row.item as string) as Item),
    append(items) {
      db.exec("BEGIN");
      try {
        for (const item of items) insert.run(JSON.stringify(item));
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    close: () => db.close(),
  };
}
