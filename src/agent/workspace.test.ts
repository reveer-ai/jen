import { mkdtempSync, rmSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { RuntimeClient, RuntimeRefusal, type Identity } from "./delegation.ts";
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

  test("an agent without workspace has no workspace tools", () => {
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

  test("a 70 KiB heredoc, naming write_file", async () => {
    await expect(run({ command: `cat > big.txt <<'EOF'\n${"x".repeat(70 * 1024)}\nEOF` })).rejects.toThrow(/over the 64 KB limit\. Write files with write_file/);
    expect(requests).toEqual([]);
  });

  test("escaping counts: 64,000 bytes of short lines with quotes and backslashes are over the bound as sent", async () => {
    const command = 'a"b\\c\n'.repeat(64_000 / 7).padEnd(64_000, "x");
    expect(Buffer.byteLength(command)).toBe(64_000);
    await expect(run({ command, timeout: 600 })).rejects.toThrow(/write_file/);
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
    await expect(run(input(bodyOf(MAX_COMMAND_BODY + 1, timeout)))).rejects.toThrow(/write_file/);
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
    expect(description).toMatch(/write_file/);
  });
});

describe("the file tools", () => {
  // A RuntimeClient over an in-memory workspace: files by path, refusing a
  // read of a missing file with 404, as the runtime does. Each call is
  // recorded with the signal it was given.
  function fake(initial: Record<string, string | Buffer> = {}) {
    const files = new Map(Object.entries(initial).map(([path, content]) => [path, Buffer.from(content)]));
    const calls: { op: "read" | "write"; path: string; signal?: AbortSignal }[] = [];
    let refuse: RuntimeRefusal | undefined;
    const client = {
      async readFile(path: string, signal?: AbortSignal) {
        calls.push({ op: "read", path, signal });
        if (refuse) throw refuse;
        const file = files.get(path);
        if (!file) throw new RuntimeRefusal(404, `no file at ${path}`);
        return Buffer.from(file);
      },
      async writeFile(path: string, bytes: Buffer, signal?: AbortSignal) {
        calls.push({ op: "write", path, signal });
        if (refuse) throw refuse;
        files.set(path, Buffer.from(bytes));
      },
      async request() {
        throw new Error("the file tools make no JSON requests");
      },
    };
    const tools = workspaceTools(worker, client as unknown as RuntimeClient);
    const use = (name: string) => (input: Json) => tools.find((t) => t.name === name)!.run(input, signal);
    return {
      files,
      calls,
      refuse: (status: number, message: string) => (refuse = new RuntimeRefusal(status, message)),
      text: (path: string) => files.get(path)?.toString("utf8"),
      read: use("read_file"),
      write: use("write_file"),
      edit: use("edit_file"),
    };
  }
  const linesOf = (count: number, line = (n: number) => `line ${n}`) => Array.from({ length: count }, (_, i) => line(i + 1)).join("\n") + "\n";
  const num = (n: number, line: string) => `${String(n).padStart(6)}\t${line}`;

  test("with workspace, the model is offered run_command, read_file, write_file and edit_file", () => {
    expect(workspaceTools(worker, client).map((t) => t.name)).toEqual(["run_command", "read_file", "write_file", "edit_file"]);
  });

  test("each calls the runtime with the call's signal", async () => {
    const ws = fake({ "a.txt": "x\n" });
    await ws.read({ path: "a.txt" });
    await ws.write({ path: "b.txt", content: "y" });
    await ws.edit({ path: "a.txt", old_string: "x", new_string: "z" });
    expect(ws.calls.map(({ op, path, signal: s }) => [op, path, s === signal])).toEqual([
      ["read", "a.txt", true],
      ["write", "b.txt", true],
      ["read", "a.txt", true],
      ["write", "a.txt", true],
    ]);
  });

  test("calls the file route through RuntimeClient with the agent's own token", async () => {
    const seen: string[] = [];
    const files = http.createServer((req, res) => {
      seen.push(`${req.method} ${req.url} ${req.headers.authorization}`);
      req.resume();
      req.on("end", () => (req.method === "PUT" ? res.writeHead(204).end() : res.writeHead(200).end("hi\n")));
    });
    await new Promise<void>((resolve) => files.listen(0, "127.0.0.1", resolve));
    const real = new RuntimeClient(`http://127.0.0.1:${(files.address() as AddressInfo).port}`, "agent-token");
    const [, read, write] = workspaceTools(worker, real);
    expect(await read!.run({ path: "notes/a b.md" }, signal)).toBe(num(1, "hi"));
    await write!.run({ path: "notes/a b.md", content: "hi" }, signal);
    expect(seen).toEqual(["GET /workspace/files?path=notes%2Fa%20b.md Bearer agent-token", "PUT /workspace/files?path=notes%2Fa%20b.md Bearer agent-token"]);
    files.closeAllConnections();
    await new Promise((resolve) => files.close(resolve));
  });

  describe("read_file", () => {
    test("a small file is its lines, numbered, with no note", async () => {
      const ws = fake({ "a.txt": "one\ntwo\nthree\n" });
      expect(await ws.read({ path: "a.txt" })).toBe([num(1, "one"), num(2, "two"), num(3, "three")].join("\n"));
    });

    test("a last line without a newline is still a line", async () => {
      const ws = fake({ "a.txt": "one\ntwo" });
      expect(await ws.read({ path: "a.txt" })).toBe([num(1, "one"), num(2, "two")].join("\n"));
    });

    test("an empty file says so", async () => {
      expect(await fake({ e: "" }).read({ path: "e" })).toBe("e is empty.");
    });

    test("a 5000-line file without a range gives lines 1 to 2000 and a note to read on", async () => {
      // Short lines, so the line cap comes before the byte cap.
      const result = await fake({ big: linesOf(5000, (n) => String(n % 10)) }).read({ path: "big" });
      const lines = result.split("\n");
      expect(lines).toHaveLength(2001);
      expect(lines[0]).toBe(num(1, "1"));
      expect(lines[1999]).toBe(num(2000, "0"));
      expect(lines[2000]).toBe("[Lines 1 to 2000 of the file's 5000 lines. Read on with offset 2001.]");
    });

    test("a range gives its lines, numbered as in the file", async () => {
      const result = await fake({ f: linesOf(100) }).read({ path: "f", offset: 10, limit: 5 });
      expect(result.split("\n")).toEqual([...[10, 11, 12, 13, 14].map((n) => num(n, `line ${n}`)), "[Lines 10 to 14 of the file's 100 lines. Read on with offset 15.]"]);
    });

    test("a range that reaches the end says which lines these are, with no offset to read on from", async () => {
      const result = await fake({ f: linesOf(20) }).read({ path: "f", offset: 19 });
      expect(result.split("\n")).toEqual([num(19, "line 19"), num(20, "line 20"), "[Lines 19 to 20 of the file's 20 lines.]"]);
    });

    test("a limit over 2000 is held to 2000", async () => {
      const result = await fake({ big: linesOf(3000, () => "x") }).read({ path: "big", limit: 2500 });
      expect(result.split("\n").at(-1)).toBe("[Lines 1 to 2000 of the file's 3000 lines. Read on with offset 2001.]");
    });

    test("the result stops before 32 KiB, and says where to read on", async () => {
      const result = await fake({ wide: linesOf(500, () => "x".repeat(199)) }).read({ path: "wide" });
      expect(Buffer.byteLength(result)).toBeLessThan(32 * 1024 + 200);
      const shown = result.split("\n").slice(0, -1);
      expect(shown.reduce((size, line) => size + Buffer.byteLength(line) + 1, 0)).toBeLessThanOrEqual(32 * 1024);
      expect(result.split("\n").at(-1)).toBe(`[Lines 1 to ${shown.length} of the file's 500 lines. Read on with offset ${shown.length + 1}.]`);
    });

    test("a 50,000-character line comes back as its first 2000 characters, marked cut", async () => {
      const result = await fake({ "min.js": "a".repeat(50_000) }).read({ path: "min.js" });
      expect(result).toBe(num(1, `${"a".repeat(2000)} [line cut: it has 50000 characters]`));
    });

    test("an offset past the end, and an offset or limit that isn't a whole number from 1, are errors", async () => {
      const ws = fake({ f: linesOf(3) });
      await expect(ws.read({ path: "f", offset: 4 })).rejects.toThrow("f has 3 lines, so offset 4 is past its end");
      for (const bad of [{ offset: 0 }, { offset: 1.5 }, { limit: 0 }, { limit: "5" }] as Record<string, Json>[]) {
        await expect(ws.read({ path: "f", ...bad })).rejects.toThrow(/must be a whole number from 1/);
      }
      await expect(ws.read({ path: "" })).rejects.toThrow("path must be a non-empty string");
    });

    test("a missing file says there's no file at the path", async () => {
      await expect(fake().read({ path: "notes/release.md" })).rejects.toThrow("there's no file at notes/release.md.");
    });

    test("a binary file gives its size and names run_command", async () => {
      const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
      await expect(fake({ "logo.png": png }).read({ path: "logo.png" })).rejects.toThrow(/logo\.png isn't text: it's 12 bytes and holds a NUL byte\. Inspect it with run_command/);
      await expect(fake({ latin: Buffer.from([0x63, 0x61, 0x66, 0xe9]) }).read({ path: "latin" })).rejects.toThrow(/4 bytes that aren't valid UTF-8\. Inspect it with run_command/);
    });

    test("a file over 16 MiB says to search it with run_command", async () => {
      const ws = fake();
      ws.refuse(413, "the file is 17825792 bytes, over the 16777216-byte limit");
      await expect(ws.read({ path: "big.log" })).rejects.toThrow(/over the 16 MB limit.*Search it with run_command/);
    });

    test("any other refusal is an error holding the runtime's status", async () => {
      const ws = fake();
      ws.refuse(400, "Permission denied");
      await expect(ws.read({ path: "/etc/shadow" })).rejects.toThrow("the runtime answered 400: Permission denied");
    });
  });

  describe("write_file", () => {
    test("writes the content as given, with what would break a heredoc, and names the path and size", async () => {
      const ws = fake();
      const content = 'Home is $HOME, not `pwd`.\nShe said "it\'s fine".\nEOF\nends with a backslash \\';
      expect(await ws.write({ path: "notes/release.md", content })).toBe(`Wrote ${Buffer.byteLength(content)} bytes to notes/release.md.`);
      expect(ws.text("notes/release.md")).toBe(content);
    });

    test("writes UTF-8, and an empty file", async () => {
      const ws = fake();
      await ws.write({ path: "u", content: "é ✓ 😀" });
      expect(ws.files.get("u")).toEqual(Buffer.from("é ✓ 😀", "utf8"));
      expect(await ws.write({ path: "e", content: "" })).toBe("Wrote 0 bytes to e.");
    });

    test("content over 16 MiB is refused without calling the runtime", async () => {
      const ws = fake();
      await expect(ws.write({ path: "big", content: "x".repeat(16 * 2 ** 20 + 1) })).rejects.toThrow(/over the 16 MB limit/);
      expect(ws.calls).toEqual([]);
    });

    test("content that isn't a string is refused, and a refusal holds the runtime's status", async () => {
      const ws = fake();
      await expect(ws.write({ path: "a" })).rejects.toThrow("content must be a string");
      ws.refuse(400, "Read-only file system");
      await expect(ws.write({ path: "/etc/jen-probe", content: "x" })).rejects.toThrow("the runtime answered 400: Read-only file system");
    });
  });

  describe("edit_file", () => {
    test("one match changes that and nothing else", async () => {
      const ws = fake({ "settings.conf": "a = 1\ncache_ttl = 300\nb = 2\n" });
      await ws.edit({ path: "settings.conf", old_string: "cache_ttl = 300", new_string: "cache_ttl = 900" });
      expect(ws.text("settings.conf")).toBe("a = 1\ncache_ttl = 900\nb = 2\n");
    });

    test("a string not in the file is an error saying the match must be exact, and the file is unchanged", async () => {
      const ws = fake({ f: "  indented\n" });
      await expect(ws.edit({ path: "f", old_string: "indented\n  ", new_string: "x" })).rejects.toThrow(
        "old_string isn't in f. It must match the file exactly, whitespace and indentation included, and without read_file's line numbers.",
      );
      expect(ws.text("f")).toBe("  indented\n");
      expect(ws.calls.map((c) => c.op)).toEqual(["read"]);
    });

    test("three matches without replace_all is an error saying 3, and the file is unchanged", async () => {
      const ws = fake({ f: "x\nx\nx\n" });
      await expect(ws.edit({ path: "f", old_string: "x", new_string: "y" })).rejects.toThrow(
        "old_string matches 3 times in f. Include more of the surrounding text to make it match once, or set replace_all to replace every match.",
      );
      expect(ws.text("f")).toBe("x\nx\nx\n");
    });

    test("replace_all replaces all three, and says 3 with the path", async () => {
      const ws = fake({ f: "x\nx\nx\n" });
      expect(await ws.edit({ path: "f", old_string: "x", new_string: "y", replace_all: true })).toBe("Replaced 3 matches in f.");
      expect(ws.text("f")).toBe("y\ny\ny\n");
    });

    test("the replacement text isn't a pattern", async () => {
      const ws = fake({ f: "price: X\n" });
      await ws.edit({ path: "f", old_string: "X", new_string: "$& and $1 and $$" });
      expect(ws.text("f")).toBe("price: $& and $1 and $$\n");
    });

    test("an empty old_string says to use write_file, and the same strings say there's nothing to change, before any call", async () => {
      const ws = fake({ f: "x\n" });
      await expect(ws.edit({ path: "f", old_string: "", new_string: "y" })).rejects.toThrow(/old_string is empty\. .*use write_file/);
      await expect(ws.edit({ path: "f", old_string: "x", new_string: "x" })).rejects.toThrow("new_string is the same as old_string");
      expect(ws.calls).toEqual([]);
    });

    test("a missing file says so and names write_file, and a binary file isn't edited", async () => {
      const ws = fake({ bin: Buffer.from([1, 0, 2]) });
      await expect(ws.edit({ path: "nope", old_string: "a", new_string: "b" })).rejects.toThrow("there's no file at nope. To create it, use write_file.");
      await expect(ws.edit({ path: "bin", old_string: "\u0001", new_string: "b" })).rejects.toThrow(/isn't text/);
      expect(ws.calls.map((c) => c.op)).toEqual(["read", "read"]);
    });

    test("a one-line edit on line 50 of 100 shows the path and lines 46 to 54", async () => {
      const ws = fake({ f: linesOf(100) });
      const result = await ws.edit({ path: "f", old_string: "line 50\n", new_string: "fifty\n" });
      expect(result.split("\n")).toEqual(["Edited f:", ...[46, 47, 48, 49].map((n) => num(n, `line ${n}`)), num(50, "fifty"), ...[51, 52, 53, 54].map((n) => num(n, `line ${n}`))]);
    });

    test("the edited lines span what new_string reaches, at most 40 lines in all, each cut at 2000 characters", async () => {
      const ws = fake({ f: linesOf(10) });
      const result = await ws.edit({ path: "f", old_string: "line 2", new_string: "two\nmore" });
      expect(result.split("\n")).toEqual(["Edited f:", num(1, "line 1"), num(2, "two"), num(3, "more"), ...[3, 4, 5, 6].map((n) => num(n + 1, `line ${n}`))]);
      const tall = fake({ f: linesOf(200) });
      const shown = (await tall.edit({ path: "f", old_string: "line 100\n", new_string: linesOf(60, (n) => `new ${n}`) })).split("\n");
      expect(shown).toHaveLength(41);
      expect(shown[1]).toBe(num(96, "line 96"));
      const wide = fake({ f: "a\nb\n" });
      expect(await wide.edit({ path: "f", old_string: "b", new_string: "w".repeat(3000) })).toBe(`Edited f:\n${num(1, "a")}\n${num(2, `${"w".repeat(2000)} [line cut: it has 3000 characters]`)}`);
    });

    test("an edit at the start, and one that empties the file, show their lines", async () => {
      const ws = fake({ f: "only\n" });
      expect(await ws.edit({ path: "f", old_string: "only", new_string: "first" })).toBe(`Edited f:\n${num(1, "first")}`);
      expect(await ws.edit({ path: "f", old_string: "first\n", new_string: "" })).toBe(`Edited f:\n${num(1, "")}`);
      expect(ws.text("f")).toBe("");
    });

    test("a byte-order mark is kept", async () => {
      const ws = fake({ f: Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("a = 1\n")]) });
      await ws.edit({ path: "f", old_string: "1", new_string: "2" });
      expect(ws.files.get("f")).toEqual(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("a = 2\n")]));
    });
  });

  test("each file tool's description says what it does and its limits", () => {
    const [, read, write, edit] = workspaceTools(worker, client);
    expect(read!.description).toMatch(/number and a tab/);
    expect(read!.description).toMatch(/2000 lines and 32 KB/);
    expect(read!.description).toMatch(/offset to read on from/);
    expect(read!.description).toMatch(/run_command/);
    expect(write!.description).toMatch(/creating its folders/);
    expect(write!.description).toMatch(/16 MB/);
    expect(edit!.description).toMatch(/exactly, whitespace and indentation included, and without read_file's line numbers/);
    expect(edit!.description).toMatch(/replace_all/);
  });
});
