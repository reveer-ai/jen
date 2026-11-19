#!/usr/bin/env node
// The jen command, run on the user's machine, outside any container. It parses
// its arguments and dispatches to the module for each command. It's a client
// of the runtime's API as the owner, and reaches the engine only through the
// user's docker command. It imports only types from src/runtime/ and
// src/agent/, so none of their code runs here. Every module it needs is
// imported here, at startup, so jen uninstall can remove the command's own
// files while it finishes.

import { emitKeypressEvents } from "node:readline";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { ApiError, Unanswered } from "./api.ts";
import { createDocker, DockerError, runProcess, Unreachable, type Docker, type Runner } from "./docker.ts";
import { listRoots, newRoot, openRoot, query, stopRoot } from "./roots.ts";
import { config, stopAll, type Context } from "./runtime.ts";
import { MissingImage, namesFrom, Refusal, type Terminal } from "./settings.ts";
import { uninstall } from "./uninstall.ts";

export const USAGE = `jen runs your agents.

  jen new <name>          create a root agent named <name>
  jen @<name> <query>     send <query> to that root, show its progress and print its reply
  jen @<name> open        open that root's UI in the browser
  jen list                list the roots and whether each is running
  jen stop @<name>        stop that root and everything under it
  jen stop all            stop every agent and the runtime
  jen config              set the model, the base URL and the model key
  jen uninstall           delete everything of jen's, then the command itself
  jen help                show this

To remove jen, run jen uninstall: npm uninstall alone leaves every agent and setting in Docker.`;

export type Command =
  | { kind: "help" }
  | { kind: "usage" }
  | { kind: "new"; name: string }
  | { kind: "list" }
  | { kind: "stop"; name: string }
  | { kind: "stop-all" }
  | { kind: "config" }
  | { kind: "uninstall" }
  | { kind: "open"; name: string }
  | { kind: "query"; name: string; text: string };

export function parse(args: string[]): Command {
  const [first, ...rest] = args;
  const only = (command: Command) => (rest.length === 0 ? command : { kind: "usage" as const });
  if (first === "help") return only({ kind: "help" });
  if (first === "list") return only({ kind: "list" });
  if (first === "config") return only({ kind: "config" });
  if (first === "uninstall") return only({ kind: "uninstall" });
  if (first === "new" && rest.length === 1) return { kind: "new", name: rest[0]! };
  if (first === "stop" && rest.length === 1) {
    if (rest[0] === "all") return { kind: "stop-all" };
    if (rest[0]!.startsWith("@") && rest[0]!.length > 1) return { kind: "stop", name: rest[0]!.slice(1) };
  }
  if (first?.startsWith("@") && first.length > 1 && rest.length > 0) {
    const name = first.slice(1);
    if (rest.length === 1 && rest[0] === "open") return { kind: "open", name };
    return { kind: "query", name, text: rest.join(" ") };
  }
  return { kind: "usage" };
}

export interface Deps {
  docker: Docker;
  env: NodeJS.ProcessEnv;
  terminal: Terminal;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  columns: number;
  // Ctrl-C, while a query is followed.
  interrupt: AbortSignal;
  mainPath: string;
  npm: Runner;
  open?: (url: string) => Promise<boolean>;
}

// Runs the command and answers its exit code.
export async function run(command: Command, deps: Deps): Promise<number> {
  if (command.kind === "help" || command.kind === "usage") {
    (command.kind === "help" ? deps.stdout : deps.stderr)(`${USAGE}\n`);
    return command.kind === "help" ? 0 : 2;
  }
  const ctx: Context = {
    docker: deps.docker,
    names: namesFrom(deps.env),
    terminal: deps.terminal,
    say: (line) => deps.stderr(`${line}\n`),
    print: (line) => deps.stdout(`${line}\n`),
    fetch: deps.fetch,
    sleep: deps.sleep,
    now: deps.now,
  };
  try {
    await deps.docker.ping();
    switch (command.kind) {
      case "new":
        await newRoot(ctx, command.name);
        return 0;
      case "list":
        await listRoots(ctx);
        return 0;
      case "stop":
        await stopRoot(ctx, command.name);
        return 0;
      case "stop-all":
        await stopAll(ctx);
        return 0;
      case "config":
        await config(ctx);
        return 0;
      case "uninstall":
        return await uninstall(ctx, { mainPath: deps.mainPath, npm: deps.npm });
      case "open":
        await openRoot(ctx, command.name, deps.open);
        return 0;
      case "query":
        return await query(ctx, command.name, command.text, { interrupt: deps.interrupt, columns: deps.columns, write: deps.stdout });
    }
  } catch (error) {
    if ([Refusal, MissingImage, Unreachable, ApiError, DockerError, Unanswered].some((type) => error instanceof type)) {
      deps.stderr(`jen: ${(error as Error).message}\n`);
      return 1;
    }
    throw error;
  }
}

// Asks on stderr, reading from stdin. A hidden answer is read with echo off.
function terminal(): Terminal {
  const ask = async (question: string) => {
    const rl = createInterface({ input: process.stdin, output: process.stderr, terminal: true });
    try {
      return await rl.question(question);
    } finally {
      rl.close();
    }
  };
  const askHidden = (question: string) =>
    new Promise<string>((resolve) => {
      process.stderr.write(question);
      const stdin = process.stdin;
      emitKeypressEvents(stdin);
      stdin.setRawMode(true);
      stdin.resume();
      let answer = "";
      const onKey = (text: string | undefined, key: { name?: string; ctrl?: boolean } = {}) => {
        if (key.ctrl && key.name === "c") {
          stdin.setRawMode(false);
          process.stderr.write("\n");
          process.exit(130);
        }
        if (key.name === "return" || key.name === "enter") {
          stdin.off("keypress", onKey);
          stdin.setRawMode(false);
          stdin.pause();
          process.stderr.write("\n");
          return resolve(answer);
        }
        if (key.name === "backspace") answer = answer.slice(0, -1);
        else if (text && !key.ctrl && text >= " ") answer += text;
      };
      stdin.on("keypress", onKey);
    });
  return { interactive: process.stdin.isTTY === true, ask, askHidden };
}

if (import.meta.main) {
  const interrupt = new AbortController();
  const command = parse(process.argv.slice(2));
  // Only a followed query handles Ctrl-C, by leaving the root working.
  if (command.kind === "query") process.on("SIGINT", () => interrupt.abort());
  const code = await run(command, {
    docker: createDocker(),
    env: process.env,
    terminal: terminal(),
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
    fetch: globalThis.fetch,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: Date.now,
    columns: process.stderr.columns || 80,
    interrupt: interrupt.signal,
    mainPath: fileURLToPath(import.meta.url),
    npm: runProcess,
  });
  process.exitCode = code;
  // An open stream or a keep-alive connection would hold the process.
  process.stdout.write("", () => process.exit(code));
}
