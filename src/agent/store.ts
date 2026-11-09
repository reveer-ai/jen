import { DatabaseSync } from "node:sqlite";
import type { Item } from "./model/port.ts";

// A message accepted into the inbox and not yet delivered.
export interface Inbound {
  from: string;
  text: string;
  urgent: boolean;
}

// An entry in the outbox: a reply waiting to be posted to the parent.
export interface Outgoing {
  seq: number;
  text: string;
}

// The conversation, kept in SQLite as one JSON row per item, beside the inbox
// of messages waiting to join it, the outbox of replies waiting to reach the
// parent, and the sub-agents that owe the agent a reply.
export interface Store {
  load(): Item[];
  // Returns the items saved after position seq, in order, each with its
  // position, and at most limit of them when it's given. Positions only grow
  // and never change, so after(0) is everything.
  after(seq: number, limit?: number): { seq: number; item: Item }[];
  // Saves one step's items, such as a model response or a tool result, whole
  // or not at all.
  save(items: readonly Item[]): void;
  // Saves a response with no tool calls, which ends the turn, in one
  // transaction with what ending a turn changes: the owed reply is cleared,
  // empty messages are dropped, and reply goes into the outbox unless it's
  // empty and no reply was owed. A root has no outbox and gives no reply.
  endTurn(items: readonly Item[], reply?: string): void;
  // Saves a message to the inbox, and with it wake, the ID of the hold it
  // ends, and clears its sender's debt. A discarded message clears the debt
  // and saves the wake ID, but isn't saved itself.
  accept(message: Inbound, wake?: string, discard?: boolean): void;
  // The inbox, in arrival order.
  inbox(): Inbound[];
  // Moves every non-empty inbox message into the conversation, in arrival
  // order, in one transaction, and returns how many it moved. Empty messages
  // stay until a wait shows them or they're dropped. A message from parent
  // records a reply owed, in the same transaction.
  deliver(parent?: string): number;
  // Saves the result of the wait call callId, rendered from every inbox
  // message, and clears the inbox, in one transaction. A message from parent
  // records a reply owed, in the same transaction.
  answerWait(callId: string, parent: string | undefined, render: (messages: Inbound[]) => string): void;
  // Removes every empty message from the inbox.
  dropEmpty(): void;
  // Whether a non-empty message from the parent was delivered since the last
  // response with no tool calls.
  replyOwed(): boolean;
  // Puts text in the outbox, as it is.
  queue(text: string): void;
  // The outbox, in the order saved.
  outbox(): Outgoing[];
  // Deletes an outbox entry once the parent has it, or can never have it.
  sent(seq: number): void;
  // Records that sub-agent id owes a reply, and returns false if it already did.
  owe(id: string): boolean;
  // Records that sub-agent id owes no reply.
  clear(id: string): void;
  // The sub-agents that owe a reply, in the order they came to owe it.
  owed(): string[];
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
    CREATE TABLE IF NOT EXISTS outbox (seq INTEGER PRIMARY KEY, text TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS owed (seq INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE);
    CREATE TABLE IF NOT EXISTS reply_owed (one INTEGER PRIMARY KEY CHECK (one = 1));
  `);
  const select = db.prepare("SELECT item FROM items ORDER BY seq");
  const selectAfter = db.prepare("SELECT seq, item FROM items WHERE seq > ? ORDER BY seq LIMIT ?");
  const insert = db.prepare("INSERT INTO items (item) VALUES (?)");
  const selectInbox = db.prepare("SELECT sender, text, urgent FROM inbox ORDER BY seq");
  const insertInbox = db.prepare("INSERT INTO inbox (sender, text, urgent) VALUES (?, ?, ?)");
  const clearInbox = db.prepare("DELETE FROM inbox");
  const clearFull = db.prepare("DELETE FROM inbox WHERE text != ''");
  const clearEmpty = db.prepare("DELETE FROM inbox WHERE text = ''");
  const selectOutbox = db.prepare("SELECT seq, text FROM outbox ORDER BY seq");
  const insertOutbox = db.prepare("INSERT INTO outbox (text) VALUES (?)");
  const deleteOutbox = db.prepare("DELETE FROM outbox WHERE seq = ?");
  const insertOwed = db.prepare("INSERT OR IGNORE INTO owed (id) VALUES (?)");
  const deleteOwed = db.prepare("DELETE FROM owed WHERE id = ?");
  const selectOwed = db.prepare("SELECT id FROM owed ORDER BY seq");
  const setReplyOwed = db.prepare("INSERT OR IGNORE INTO reply_owed (one) VALUES (1)");
  const clearReplyOwed = db.prepare("DELETE FROM reply_owed");
  const selectReplyOwed = db.prepare("SELECT 1 FROM reply_owed");
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
  // Records a reply owed when messages hold a non-empty one from the parent.
  const owing = (messages: Inbound[], parent: string | undefined) => {
    if (parent !== undefined && messages.some((m) => m.from === parent && m.text !== "")) setReplyOwed.run();
  };

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
    endTurn(items, reply) {
      transaction(() => {
        for (const item of items) insert.run(JSON.stringify(item));
        if (reply !== undefined && (reply !== "" || selectReplyOwed.get() !== undefined)) insertOutbox.run(reply);
        clearReplyOwed.run();
        clearEmpty.run();
      });
    },
    accept({ from, text, urgent }, wake, discard = false) {
      transaction(() => {
        if (!discard) insertInbox.run(from, text, urgent ? 1 : 0);
        if (wake !== undefined) insertWake.run(wake);
        deleteOwed.run(from);
      });
    },
    inbox,
    deliver(parent) {
      return transaction(() => {
        const messages = inbox().filter((m) => m.text !== "");
        for (const { from, text } of messages) insert.run(JSON.stringify({ type: "message", role: "user", from, text } satisfies Item));
        owing(messages, parent);
        clearFull.run();
        return messages.length;
      });
    },
    answerWait(callId, parent, render) {
      transaction(() => {
        const messages = inbox();
        insert.run(JSON.stringify({ type: "tool_result", callId, output: render(messages) } satisfies Item));
        owing(messages, parent);
        clearInbox.run();
      });
    },
    dropEmpty: () => void clearEmpty.run(),
    replyOwed: () => selectReplyOwed.get() !== undefined,
    queue: (text) => void insertOutbox.run(text),
    outbox: () => selectOutbox.all().map((row) => ({ seq: row.seq as number, text: row.text as string })),
    sent: (seq) => void deleteOutbox.run(seq),
    owe: (id) => insertOwed.run(id).changes > 0,
    clear: (id) => void deleteOwed.run(id),
    owed: () => selectOwed.all().map((row) => row.id as string),
    woken: (wake) => selectWake.get(wake) !== undefined,
    close: () => db.close(),
  };
}
