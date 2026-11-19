// jen @<name> <query>: sends the query to a root and follows its work on the
// root's event stream until the reply. Everything the stream sends before its
// first synced is history, and isn't shown. Progress goes to stderr, one line
// for each tool call, each message from a sub-agent and each error, and the
// reply to stdout: the text of the first model response after the query's
// own message with no tool call, read once a synced says every item saved
// with it has arrived.

import { Api, ApiError, Unanswered, type Agent, type Item, type StreamEvent } from "./api.ts";
import { READY_MS } from "./runtime.ts";
import { Refusal } from "./settings.ts";

export interface FollowOptions {
  api: Api;
  root: Agent & { name: string };
  query: string;
  // Writes a line to stderr.
  say: (line: string) => void;
  // Writes the reply to stdout.
  write: (text: string) => void;
  // The terminal's width, which progress lines are cut to.
  columns: number;
  // Ctrl-C.
  interrupt: AbortSignal;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

const RETRY_MS = 250;

// The exit code: 0 with the reply, 1 when the root stopped first, 130 on Ctrl-C.
export async function follow(o: FollowOptions): Promise<number> {
  const { api, root, query } = o;
  if (root.state === "stopped") await api.start(root.id);

  // Where the stream has been read to, to resume after.
  let last: number | undefined;
  let history = true;
  let found = false;
  // The model response arriving: its text, and whether it called a tool.
  let response = { open: false, text: "", called: false };
  let reply: string | undefined;

  const end = () => {
    if (found && response.open && !response.called && response.text.trim() !== "") reply = response.text.trim();
    response = { open: false, text: "", called: false };
  };
  const line = (text: string) => o.say(cut(text, o.columns));
  const onItem = (item: Item) => {
    if (!found) {
      found = item.type === "message" && item.role === "user" && item.from === "owner" && item.text === query;
      return;
    }
    if (item.type === "message" && item.role === "assistant") {
      response.open = true;
      response.text += item.text;
    } else if (item.type === "tool_call") {
      response.open = true;
      response.called = true;
      line(`→ ${item.name} ${summary(item.input)}`);
    } else {
      end();
      if (item.type === "message" && item.role === "user" && item.from !== "owner" && item.from !== "runtime" && item.from !== "") line(`← ${item.from}: ${item.text}`);
    }
  };
  const onEvent = (event: StreamEvent) => {
    if (event.type === "item") {
      last = event.seq;
      if (!history) onItem(event.item);
    } else if (event.type === "synced") {
      last = event.seq;
      if (!history) end();
    } else if (event.type === "error" && !history) line(`! ${event.message}`);
  };

  for (;;) {
    const stream = await open(o, last);
    if (stream === "interrupted") return interrupted(o);
    if (stream === "stopped") {
      o.say(`@${root.name} stopped before it replied. Its conversation is kept: send it another query to start it again.`);
      return 1;
    }
    for await (const event of stream) {
      onEvent(event);
      if (event.type === "synced" && history) {
        history = false;
        await api.post(root.id, query);
      }
      if (reply !== undefined) {
        o.write(`${reply}\n`);
        return 0;
      }
    }
    if (o.interrupt.aborted) return interrupted(o);
  }
}

function interrupted(o: FollowOptions): number {
  o.say(`@${o.root.name} is still working. To see it, run: jen @${o.root.name} open`);
  return 130;
}

// Opens the root's stream after last, waiting for the runtime for as long as
// a start may take, since it may be being replaced, and for a root that's
// restarting. A root that's stopped is "stopped".
async function open(o: FollowOptions, last: number | undefined): Promise<AsyncIterable<StreamEvent> | "stopped" | "interrupted"> {
  const deadline = o.now() + READY_MS;
  for (;;) {
    if (o.interrupt.aborted) return "interrupted";
    try {
      return await o.api.events(o.root.id, { lastEventId: last, signal: o.interrupt });
    } catch (error) {
      if (o.interrupt.aborted) return "interrupted";
      if (!(error instanceof Unanswered || (error instanceof ApiError && (error.status === 409 || error.status >= 500)))) throw error;
      try {
        if ((await o.api.get(o.root.id)).state === "stopped") return "stopped";
      } catch (error) {
        if (!(error instanceof Unanswered || (error instanceof ApiError && error.status >= 500))) throw error;
      }
    }
    if (o.now() >= deadline) throw new Refusal(`The runtime stopped answering while @${o.root.name} worked. Its work goes on; try jen @${o.root.name} open.`);
    await o.sleep(RETRY_MS);
  }
}

// A tool call's input in a few words: its values, or its JSON.
export function summary(input: unknown): string {
  if (typeof input === "string") return input;
  if (typeof input === "object" && input !== null && !Array.isArray(input)) {
    const values = Object.values(input).filter((v) => typeof v === "string" || typeof v === "number" || typeof v === "boolean");
    if (values.length > 0) return values.join(" ");
    if (Object.keys(input).length === 0) return "";
  }
  return JSON.stringify(input);
}

// One line of at most columns characters.
export function cut(text: string, columns: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const chars = [...flat];
  return chars.length <= columns ? flat : `${chars.slice(0, Math.max(columns - 1, 1)).join("")}…`;
}
