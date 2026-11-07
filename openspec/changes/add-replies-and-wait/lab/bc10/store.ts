import { DatabaseSync } from "node:sqlite";
import type { Item } from "./model/port.ts";

// A message accepted into the inbox and not yet delivered.
export interface Inbound {
  from: string;
  text: string;
  urgent: boolean;
}

// The conversation, kept in SQLite as one JSON row per item, beside the inbox
// of messages waiting to join it.
export interface Store {
  load(): Item[];
  // Returns the items saved after position seq, in order, each with its
  // position, and at most limit of them when it's given. Positions only grow
  // and never change, so after(0) is everything.
  after(seq: number, limit?: number): { seq: number; item: Item }[];
  // Saves one step's items, such as a model response or a tool result, whole
  // or not at all.
  save(items: readonly Item[]): void;
  // Saves a message to the inbox, and with it wake, the ID of the hold it ends.
  accept(message: Inbound, wake?: string): void;
  // The inbox, in arrival order.
  inbox(): Inbound[];
  // Moves every inbox message into the conversation, in arrival order, in one
  // transaction, and returns how many it moved.
  deliver(): number;
  // Moves every inbox message into the result of the wait call callId, in one
  // transaction, and returns how many it moved.
  answerWait(callId: string, status: (froms: string[]) => string, label?: (from: string) => string): number;
  // Whether a message was saved with this wake ID.
  woken(wake: string): boolean;
  close(): void;
}

// Opens the store at path, creating the file and its tables when they don't exist.
export function openStore(path: string): Store {
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE IF NOT EXISTS items (seq INTEGER PRIMARY KEY, item TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS inbox (seq INTEGER PRIMARY KEY, sender TEXT NOT NULL, text TEXT NOT NULL, urgent INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS wakes (id TEXT PRIMARY KEY);
  `);
  const select = db.prepare("SELECT item FROM items ORDER BY seq");
  const selectAfter = db.prepare("SELECT seq, item FROM items WHERE seq > ? ORDER BY seq LIMIT ?");
  const insert = db.prepare("INSERT INTO items (item) VALUES (?)");
  const selectInbox = db.prepare("SELECT sender, text, urgent FROM inbox ORDER BY seq");
  const insertInbox = db.prepare("INSERT INTO inbox (sender, text, urgent) VALUES (?, ?, ?)");
  const clearInbox = db.prepare("DELETE FROM inbox");
  const insertWake = db.prepare("INSERT OR IGNORE INTO wakes (id) VALUES (?)");
  const selectWake = db.prepare("SELECT 1 FROM wakes WHERE id = ?");

  function transaction<T>(body: () => T): T {
    db.exec("BEGIN");
    try {
      const result = body();
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  const inbox = () =>
    selectInbox.all().map((row) => ({ from: row.sender as string, text: row.text as string, urgent: row.urgent === 1 }));

  return {
    load: () => select.all().map((row) => JSON.parse(row.item as string) as Item),
    // LIMIT -1 is no limit in SQLite.
    after: (seq, limit = -1) =>
      selectAfter.all(seq, limit).map((row) => ({ seq: row.seq as number, item: JSON.parse(row.item as string) as Item })),
    save(items) {
      transaction(() => {
        for (const item of items) insert.run(JSON.stringify(item));
      });
    },
    accept({ from, text, urgent }, wake) {
      transaction(() => {
        insertInbox.run(from, text, urgent ? 1 : 0);
        if (wake !== undefined) insertWake.run(wake);
      });
    },
    inbox,
    deliver() {
      return transaction(() => {
        const messages = inbox();
        for (const { from, text } of messages) insert.run(JSON.stringify({ type: "message", role: "user", from, text } satisfies Item));
        clearInbox.run();
        return messages.length;
      });
    },
    answerWait(callId, status, label = (f: string) => f) {
      return transaction(() => {
        const messages = inbox();
        if (messages.length === 0) return 0;
        const output = messages.map(({ from, text }) => (label(from) === "" ? text : `From: ${label(from)}\n\n${text}`)).join("\n\n---\n\n") + "\n\n---\n\n" + status(messages.map((m) => m.from));
        insert.run(JSON.stringify({ type: "tool_result", callId, output } satisfies Item));
        clearInbox.run();
        return messages.length;
      });
    },
    woken: (wake) => selectWake.get(wake) !== undefined,
    close: () => db.close(),
  };
}
