import { mkdtempSync, rmSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { RuntimeClient, type Identity } from "./delegation.ts";
import { Agent } from "./loop.ts";
import type { Item, Json } from "./model/port.ts";
import { ScriptedModel } from "./model/scripted.ts";
import { openStore } from "./store.ts";
import { MAX_COMMAND_BODY, workspaceTools } from "./workspace.ts";

// A runtime that records each request, with its body's size as sent, and
// answers from answer.
let runtime: http.Server;
let requests: { method: string; path: string; auth?: string; bytes: number; body: unknown }[];
let answer: () => { status: number; body?: unknown };
let client: RuntimeClient;
beforeEach(async () => {
  requests = [];
  answer = () => ({ status: 200, body: { exitCode: 0, output: "hi\n", timedOut: false } });
  runtime = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks);
      requests.push({ method: req.method!, path: req.url!, auth: req.headers.authorization, bytes: raw.length, body: JSON.parse(raw.toString("utf8")) });
      const { status, body } = answer();
      res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(body));
    });
  });
  await new Promise<void>((resolve) => runtime.listen(0, "127.0.0.1", resolve));
  client = new RuntimeClient(`http://127.0.0.1:${(runtime.address() as AddressInfo).port}`, "agent-token");
});
afterEach(async () => {
  runtime.closeAllConnections();
  await new Promise((resolve) => runtime.close(resolve));
});

const worker: Identity = { id: "a1b2c3d4e5f6", parent: "owner", grant: { spawn: false, workspace: true } };
const signal = new AbortController().signal;
const tool = () => workspaceTools(worker, client)[0]!;
const run = (input: Json) => tool().run(input, signal);

describe("run_command calls the runtime", () => {
  test("posts the command with the agent's own token, and the timeout only when set", async () => {
    await run({ command: "echo hi" });
    await run({ command: "sleep 1", timeout: 30 });
    expect(requests.map(({ method, path, auth, body }) => ({ method, path, auth, body }))).toEqual([
      { method: "POST", path: "/workspace/commands", auth: "Bearer agent-token", body: { command: "echo hi" } },
      { method: "POST", path: "/workspace/commands", auth: "Bearer agent-token", body: { command: "sleep 1", timeout: 30 } },
    ]);
  });

  test("a cancelled call aborts its request", async () => {
    const hung = http.createServer(() => {});
    await new Promise<void>((resolve) => hung.listen(0, "127.0.0.1", resolve));
    const slow = new RuntimeClient(`http://127.0.0.1:${(hung.address() as AddressInfo).port}`, "t");
    const abort = new AbortController();
    const running = workspaceTools(worker, slow)[0]!.run({ command: "sleep 100" }, abort.signal);
    abort.abort();
    await expect(running).rejects.toMatchObject({ name: "AbortError" });
    hung.closeAllConnections();
    await new Promise((resolve) => hung.close(resolve));
  });

  test("an agent without workspace has no run_command", () => {
    expect(workspaceTools({ ...worker, grant: { spawn: true, workspace: false } }, client)).toEqual([]);
  });
});

describe("run_command's result", () => {
  test("gives the exit code, then the output", async () => {
    expect(await run({ command: "echo hi" })).toBe("Exit code 0.\nhi\n");
  });

  test("says when there was no output", async () => {
    answer = () => ({ status: 200, body: { exitCode: 1, output: "", timedOut: false } });
    expect(await run({ command: "false" })).toBe("Exit code 1.\n(no output)");
  });

  test("says the command was killed by its timeout", async () => {
    answer = () => ({ status: 200, body: { exitCode: null, output: "started\n", timedOut: true } });
    expect(await run({ command: "echo started; sleep 100", timeout: 1 })).toBe("The command was killed by its timeout.\nstarted\n");
  });

  test("ends a cut with the full size and the file that holds it", async () => {
    answer = () => ({ status: 200, body: { exitCode: 0, output: "start…end", timedOut: false, cut: { bytes: 123456, file: "/home/agent/.jen/output/ab.log" } } });
    const result = await run({ command: "seq 100000" });
    expect(result.split("\n")).toEqual([
      "Exit code 0.",
      "start…end",
      "[The output was 123456 bytes, cut to its first 2 KB and last 6 KB. All of it is in /home/agent/.jen/output/ab.log.]",
    ]);
  });

  test("a refusal from the runtime is a result that starts with Error: and holds its status", async () => {
    answer = () => ({ status: 403, body: { error: "the caller has no workspace" } });
    const dir = mkdtempSync(join(tmpdir(), "jen-workspace-"));
    const store = openStore(join(dir, "agent.db"));
    const turn: Item[] = [{ type: "tool_call", id: "c1", name: "run_command", input: { command: "ls" } }];
    const agent = new Agent({ store, model: new ScriptedModel([turn, [{ type: "message", role: "assistant", text: "ok" }]]), tools: [tool()], instructions: "", parent: "owner" });
    agent.start();
    agent.accept({ from: "owner", text: "list", urgent: false });
    await agent.idle();
    const output = (store.load().find((i) => i.type === "tool_result") as { output: string }).output;
    expect(output).toMatch(/^Error: .*403/);
    expect(output).toContain("the caller has no workspace");
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("run_command refuses what the runtime would, before any request", () => {
  test.each([0, 0.5, 601, "60", -1])("a timeout of %j", async (timeout) => {
    await expect(run({ command: "true", timeout })).rejects.toThrow("timeout must be a number of seconds from 1 to 600");
    expect(requests).toEqual([]);
  });

  test("a missing or empty command", async () => {
    await expect(run({})).rejects.toThrow("command");
    await expect(run({ command: "" })).rejects.toThrow("command");
    expect(requests).toEqual([]);
  });

  test("a 70 KiB heredoc, saying to write it in parts", async () => {
    await expect(run({ command: `cat > big.txt <<'EOF'\n${"x".repeat(70 * 1024)}\nEOF` })).rejects.toThrow(/over the 64 KB limit\. Write the content in parts/);
    expect(requests).toEqual([]);
  });

  test("escaping counts: 64,000 bytes of short lines with quotes and backslashes are over the bound as sent", async () => {
    const command = 'a"b\\c\n'.repeat(64_000 / 7).padEnd(64_000, "x");
    expect(Buffer.byteLength(command)).toBe(64_000);
    await expect(run({ command, timeout: 600 })).rejects.toThrow(/in parts/);
    expect(requests).toEqual([]);
  });

  // A command of escaped characters whose body as sent, timeout included, is
  // bytes long.
  function bodyOf(bytes: number, timeout?: number): string {
    const base = 'é"\\\n\t'.repeat(3_000);
    const size = (command: string) => Buffer.byteLength(JSON.stringify(timeout === undefined ? { command } : { command, timeout }));
    return base + "x".repeat(bytes - size(base));
  }

  test.each([undefined, 600])("at the bound with timeout %j, a body as sent of exactly 64 KiB goes through, and one byte more doesn't", async (timeout) => {
    const input = (command: string): Json => (timeout === undefined ? { command } : { command, timeout });
    await run(input(bodyOf(MAX_COMMAND_BODY, timeout)));
    await expect(run(input(bodyOf(MAX_COMMAND_BODY + 1, timeout)))).rejects.toThrow(/in parts/);
    expect(requests.map((r) => r.bytes)).toEqual([MAX_COMMAND_BODY]);
  });
});

describe("run_command's description says how the workspace works", () => {
  test("it names the limits and how to work within them", () => {
    const { description } = tool();
    expect(description).toMatch(/bash/);
    expect(description).toMatch(/home directory/);
    expect(description).toMatch(/no network/);
    expect(description).toMatch(/no way to install anything/);
    expect(description).toMatch(/2 minutes/);
    expect(description).toMatch(/10 minutes/);
    expect(description).toMatch(/background with its output redirected/);
    expect(description).toMatch(/about 8 KB/);
    expect(description).toMatch(/saved to a file/);
    expect(description).toMatch(/64 KB as sent/);
    expect(description).toMatch(/in parts/);
  });
});
