// The tool an agent with the workspace grant runs commands with. Each command
// runs in the agent's own workspace, a container beside its own, through the
// runtime's API with the agent's own token. The runtime holds the workspace's
// boundary and its limits; the tool refuses what the runtime would before
// sending anything, so the model hears why at once.

import type { Tool } from "./loop.ts";
import type { Json } from "./model/port.ts";
import type { Identity, RuntimeClient } from "./delegation.ts";

// The runtime's bounds: the longest timeout, in seconds, and the largest
// request body, in bytes, as sent.
export const MAX_TIMEOUT = 600;
export const MAX_COMMAND_BODY = 64 * 1024;

// The tools the agent's grant allows: run_command with workspace, and none
// without it.
export function workspaceTools(identity: Identity, runtime: RuntimeClient): Tool[] {
  if (!identity.grant.workspace) return [];
  return [
    {
      name: "run_command",
      description:
        "Run a bash command in your workspace and get its exit code and output, stdout and stderr together. " +
        "Each command starts in your home directory, /home/agent, which keeps its files for as long as you exist; a cd doesn't carry over to the next command. " +
        "The workspace has Node, git, python3, curl, ripgrep (rg) and jq, no network beyond its own localhost, and no way to install anything. " +
        "A command times out after 2 minutes unless you set timeout, up to 10 minutes, and a timeout kills it. " +
        "The call returns when the command's shell exits, so run anything that keeps running, such as a server, in the background with its output redirected, such as `npm run dev > dev.log 2>&1 &`. " +
        "Output is capped at about 8 KB: past that you get only its first 2 KB and last 6 KB, and the whole output is saved to a file the result names. " +
        "So when output may be large, send it to a file and search it with grep or tail rather than printing it. " +
        "A command may be at most 64 KB as sent, where escaped newlines and quotes count, so write a large file in parts.",
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
          throw new Error(`the command is ${size} bytes as sent, over the 64 KB limit. Write the content in parts, such as several commands that each append to the file.`);
        }
        return format(await runtime.request("POST", "/workspace/commands", body, signal));
      },
    },
  ];
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
