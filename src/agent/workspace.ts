// The tools an agent with the workspace grant works in its workspace with:
// run_command, and read_file, write_file and edit_file. Each acts in the
// agent's own workspace, a container beside its own, through the runtime's
// API with the agent's own token. The runtime holds the workspace's boundary
// and its limits; the tools refuse what the runtime would before sending
// anything, so the model hears why at once. The file tools follow the shape
// established file tools share: numbered lines, a whole-file write, and an
// exact string replace.

import type { Tool } from "./loop.ts";
import type { Json } from "./model/port.ts";
import { RuntimeRefusal, type Identity, type RuntimeClient } from "./delegation.ts";

// The runtime's bounds: the longest timeout, in seconds, and the largest
// request body, in bytes, as sent.
export const MAX_TIMEOUT = 600;
export const MAX_COMMAND_BODY = 64 * 1024;
// The largest file the runtime reads or writes, in bytes.
export const MAX_FILE = 16 * 2 ** 20;
// What one read_file call returns at most: lines, bytes of the result, and
// characters of one line, past which the line is cut.
export const MAX_LINES = 2000;
export const MAX_READ = 32 * 1024;
export const MAX_LINE = 2000;
// The lines an edit's result shows either side of the edited ones, and the
// most it shows in all.
const CONTEXT = 4;
const MAX_SNIPPET = 40;

// The tools the agent's grant allows: the workspace tools with workspace, and
// none without it.
export function workspaceTools(identity: Identity, runtime: RuntimeClient): Tool[] {
  if (!identity.grant.workspace) return [];
  return [runCommand(runtime), readFile(runtime), writeFile(runtime), editFile(runtime)];
}

function runCommand(runtime: RuntimeClient): Tool {
  return {
    name: "run_command",
    description:
      "Run a bash command in your workspace and get its exit code and output, stdout and stderr together. " +
      "Each command starts in your home directory, /home/agent, which keeps its files for as long as you exist; a cd doesn't carry over to the next command. " +
      "The workspace has Node, git, python3, curl, ripgrep (rg) and jq, no network beyond its own localhost, and no way to install anything. " +
      "A command times out after 2 minutes unless you set timeout, up to 10 minutes, and a timeout kills it. " +
      "The call returns when the command's shell exits, so run anything that keeps running, such as a server, in the background with its output redirected, such as `npm run dev > dev.log 2>&1 &`. " +
      "Output is capped at about 8 KB: past that you get only its first 2 KB and last 6 KB, and the whole output is saved to a file the result names. " +
      "So when output may be large, send it to a file and search it with grep or tail rather than printing it. " +
      "A command may be at most 64 KB as sent, where escaped newlines and quotes count, so write files with write_file, not in a command.",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string", description: "The bash command to run." },
        timeout: { type: "number", description: `Seconds before the command is killed: 120 unless set, at most ${MAX_TIMEOUT}.` },
      },
      required: ["command"],
    },
    async run(input, signal) {
      const command = field(input, "command");
      if (typeof command !== "string" || command === "") throw new Error("command must be a non-empty string");
      const timeout = field(input, "timeout");
      if (timeout !== undefined && (typeof timeout !== "number" || !(timeout >= 1 && timeout <= MAX_TIMEOUT))) {
        throw new Error(`timeout must be a number of seconds from 1 to ${MAX_TIMEOUT}`);
      }
      const body: Json = timeout === undefined ? { command } : { command, timeout };
      // Measured as sent, the UTF-8 JSON with its escaping, which the runtime bounds.
      const size = Buffer.byteLength(JSON.stringify(body));
      if (size > MAX_COMMAND_BODY) {
        throw new Error(`the command is ${size} bytes as sent, over the 64 KB limit. Write files with write_file, not in a command.`);
      }
      return format(await runtime.request("POST", "/workspace/commands", body, signal));
    },
  };
}

function readFile(runtime: RuntimeClient): Tool {
  return {
    name: "read_file",
    description:
      "Read a text file in your workspace. Each line comes back prefixed with its number and a tab. " +
      "A relative path is relative to your home directory, /home/agent. " +
      `A call returns at most ${MAX_LINES} lines and 32 KB, starting at offset (the first line, from 1) and taking at most limit lines; ` +
      "when that isn't the whole file, the result ends with a note saying how many lines the file has and the offset to read on from. " +
      `A line longer than ${MAX_LINE} characters is cut there and marked cut. ` +
      "A file that isn't text, or is over 16 MB, isn't printed: inspect or search it with run_command.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "The file's path." },
        offset: { type: "number", description: "The first line to read, from 1. 1 unless set." },
        limit: { type: "number", description: `How many lines to read, at most ${MAX_LINES}.` },
      },
      required: ["path"],
    },
    async run(input, signal) {
      const path = pathOf(input);
      const offset = lineCount(input, "offset") ?? 1;
      const limit = Math.min(lineCount(input, "limit") ?? MAX_LINES, MAX_LINES);
      const lines = splitLines(await readText(runtime, path, signal));
      if (lines.length === 0) return `${path} is empty.`;
      if (offset > lines.length) throw new Error(`${path} has ${lines.length} lines, so offset ${offset} is past its end`);
      const shown: string[] = [];
      let size = 0;
      for (let n = offset; n < offset + limit && n <= lines.length; n++) {
        const line = numbered(n, lines[n - 1]!);
        size += Buffer.byteLength(line) + 1;
        // One line always fits: a cut line is far under the cap.
        if (size > MAX_READ && shown.length > 0) break;
        shown.push(line);
      }
      const last = offset + shown.length - 1;
      if (offset === 1 && last === lines.length) return shown.join("\n");
      const readOn = last < lines.length ? ` Read on with offset ${last + 1}.` : "";
      return `${shown.join("\n")}\n[Lines ${offset} to ${last} of the file's ${lines.length} lines.${readOn}]`;
    },
  };
}

function writeFile(runtime: RuntimeClient): Tool {
  return {
    name: "write_file",
    description:
      "Write a whole file in your workspace, replacing the file if it exists and creating its folders. " +
      "A relative path is relative to your home directory, /home/agent. " +
      "The content is written exactly as given, as UTF-8, so nothing in it needs escaping. " +
      "A file may be at most 16 MB. To change part of a file, use edit_file.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "The file's path." },
        content: { type: "string", description: "The file's whole content." },
      },
      required: ["path", "content"],
    },
    async run(input, signal) {
      const path = pathOf(input);
      const content = field(input, "content");
      if (typeof content !== "string") throw new Error("content must be a string");
      const bytes = Buffer.from(content, "utf8");
      if (bytes.length > MAX_FILE) throw new Error(`the content is ${bytes.length} bytes, over the 16 MB limit`);
      await runtime.writeFile(path, bytes, signal);
      return `Wrote ${bytes.length} bytes to ${path}.`;
    },
  };
}

function editFile(runtime: RuntimeClient): Tool {
  return {
    name: "edit_file",
    description:
      "Change part of a text file in your workspace by replacing an exact string. " +
      "A relative path is relative to your home directory, /home/agent. " +
      "old_string must match the file exactly, whitespace and indentation included, and without read_file's line numbers. " +
      "It must match only once, so include enough of the surrounding text to make it unique, unless replace_all is set to replace every match. " +
      "Otherwise the edit fails, says why, and leaves the file unchanged. new_string is inserted exactly as given. " +
      "The result shows the edited lines.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "The file's path." },
        old_string: { type: "string", description: "The exact text to replace." },
        new_string: { type: "string", description: "The text to replace it with." },
        replace_all: { type: "boolean", description: "Replace every match, not just one." },
      },
      required: ["path", "old_string", "new_string"],
    },
    async run(input, signal) {
      const path = pathOf(input);
      const oldString = field(input, "old_string");
      const newString = field(input, "new_string");
      const replaceAll = field(input, "replace_all") ?? false;
      if (typeof oldString !== "string" || typeof newString !== "string") throw new Error("old_string and new_string must be strings");
      if (typeof replaceAll !== "boolean") throw new Error("replace_all must be a boolean");
      if (oldString === "") throw new Error("old_string is empty. To create a file, or to replace all of one, use write_file.");
      if (oldString === newString) throw new Error("new_string is the same as old_string, so there's nothing to change");
      const text = await readText(runtime, path, signal, " To create it, use write_file.");
      // Split and joined, so nothing in new_string is read as a pattern.
      const parts = text.split(oldString);
      const matches = parts.length - 1;
      if (matches === 0) {
        throw new Error(`old_string isn't in ${path}. It must match the file exactly, whitespace and indentation included, and without read_file's line numbers.`);
      }
      if (matches > 1 && !replaceAll) {
        throw new Error(`old_string matches ${matches} times in ${path}. Include more of the surrounding text to make it match once, or set replace_all to replace every match.`);
      }
      const edited = parts.join(newString);
      const bytes = Buffer.from(edited, "utf8");
      if (bytes.length > MAX_FILE) throw new Error(`the edited file would be ${bytes.length} bytes, over the 16 MB limit`);
      await runtime.writeFile(path, bytes, signal);
      if (replaceAll) return `Replaced ${matches} ${matches === 1 ? "match" : "matches"} in ${path}.`;
      // The edited lines, from the line the match started on to the last
      // line new_string reaches, with context either side.
      const first = parts[0]!.split("\n").length;
      // A final newline in new_string ends its last line, not starts another.
      const span = newString.split("\n").length - (newString.endsWith("\n") ? 1 : 0);
      const lastEdited = first + Math.max(span, 1) - 1;
      const lines = splitLines(edited);
      const from = Math.max(1, first - CONTEXT);
      const to = Math.min(Math.max(lines.length, 1), lastEdited + CONTEXT, from + MAX_SNIPPET - 1);
      const snippet: string[] = [];
      for (let n = from; n <= to; n++) snippet.push(numbered(n, lines[n - 1] ?? ""));
      return `Edited ${path}:\n${snippet.join("\n")}`;
    },
  };
}

// The file's text, or an error the model can act on: a missing file, one
// over the runtime's bound, and one that isn't text. missing is added to the
// missing file's error.
async function readText(runtime: RuntimeClient, path: string, signal: AbortSignal, missing = ""): Promise<string> {
  let bytes: Buffer;
  try {
    bytes = await runtime.readFile(path, signal);
  } catch (error) {
    if (error instanceof RuntimeRefusal && error.status === 404) throw new Error(`there's no file at ${path}.${missing}`);
    if (error instanceof RuntimeRefusal && error.status === 413) {
      throw new Error(`${path} is over the 16 MB limit, so it can't be read whole. Search it with run_command, such as with rg or sed -n.`);
    }
    throw error;
  }
  const notText = `${path} isn't text: it's ${bytes.length} bytes`;
  if (bytes.includes(0)) throw new Error(`${notText} and holds a NUL byte. Inspect it with run_command, such as with file or xxd.`);
  try {
    // The BOM is kept, so an edit writes it back.
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new Error(`${notText} that aren't valid UTF-8. Inspect it with run_command, such as with file or xxd.`);
  }
}

// A file's lines. A final newline ends the last line rather than starting
// another, and an empty file has none.
function splitLines(text: string): string[] {
  if (text === "") return [];
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

// A line as read_file shows it: its number, right-aligned as cat -n does, a
// tab, and the line, cut past MAX_LINE characters.
function numbered(n: number, line: string): string {
  let shown = line;
  if (line.length > MAX_LINE) {
    // A character outside the BMP isn't split in two.
    const end = /[\ud800-\udbff]/.test(line[MAX_LINE - 1]!) ? MAX_LINE - 1 : MAX_LINE;
    shown = `${line.slice(0, end)} [line cut: it has ${line.length} characters]`;
  }
  return `${String(n).padStart(6)}\t${shown}`;
}

function pathOf(input: Json): string {
  const path = field(input, "path");
  if (typeof path !== "string" || path === "") throw new Error("path must be a non-empty string");
  return path;
}

// A line number or count of lines, from 1, when set.
function lineCount(input: Json, name: string): number | undefined {
  const value = field(input, name);
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) throw new Error(`${name} must be a whole number from 1`);
  return value;
}

// The runtime's answer for the model: how the command ended, its output, and
// where the whole of a cut output is.
function format(answer: Json | undefined): string {
  const exitCode = field(answer ?? null, "exitCode");
  const output = field(answer ?? null, "output");
  const cut = field(answer ?? null, "cut");
  const lines = [field(answer ?? null, "timedOut") === true ? "The command was killed by its timeout." : `Exit code ${exitCode}.`];
  if (typeof output === "string" && output !== "") lines.push(output);
  else lines.push("(no output)");
  if (cut !== undefined) {
    const bytes = field(cut, "bytes");
    const file = field(cut, "file");
    lines.push(`[The output was ${bytes} bytes, cut to its first 2 KB and last 6 KB. All of it is in ${file}.]`);
  }
  return lines.join("\n");
}

function field(input: Json, name: string): Json | undefined {
  return typeof input === "object" && input !== null && !Array.isArray(input) ? input[name] : undefined;
}
