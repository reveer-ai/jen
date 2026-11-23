import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { hashTask, promptTask, TASKS, type Task } from "./tasks.ts";

const task = (name: string) => TASKS.find((t) => t.name === name)!;

describe("a task's hash", () => {
  test("is the same for the same definition, and for another run's seed", () => {
    const files = task("files");
    expect(hashTask(files)).toBe(hashTask({ ...files }));
    expect(hashTask(files)).toMatch(/^[0-9a-f]{16}$/);
    // The command task's messages carry each run's seed, and its hash doesn't.
    const command = task("command");
    expect(command.steps("aaaaaaaa")).not.toEqual(command.steps("bbbbbbbb"));
    expect(hashTask(command)).toBe(hashTask({ ...command }));
  });

  test("changes when its check's source changes", () => {
    const base: Task = { name: "t", steps: () => ["hi"], replies: 1, check: async ({ replies }) => (replies.length > 0 ? [] : ["no reply"]) };
    const edited: Task = { ...base, check: async ({ replies }) => (replies.length > 1 ? [] : ["no reply"]) };
    expect(hashTask(edited)).not.toBe(hashTask(base));
  });

  test("changes with each other field", () => {
    const base: Task = { name: "t", steps: () => ["hi"], replies: 1 };
    const variants: Task[] = [
      { ...base, name: "u" },
      { ...base, steps: () => ["hello"] },
      { ...base, replies: 2 },
      { ...base, answer: "yes" },
      { ...base, grant: { workspace: true } },
      { ...base, limitMs: 60_000 },
    ];
    const hashes = new Set([base, ...variants].map(hashTask));
    expect(hashes.size).toBe(variants.length + 1);
  });

  test("differs for every defined task", () => {
    expect(new Set(TASKS.map(hashTask)).size).toBe(TASKS.length);
  });
});

describe("the defined tasks", () => {
  test("give the command and file tasks a workspace", () => {
    expect(task("command").grant).toEqual({ workspace: true });
    expect(task("files").grant).toEqual({ workspace: true });
  });

  test("the command task's check wants the seed's line and one run", async () => {
    const { check, steps } = task("command");
    const seed = "1234abcd";
    expect(steps(seed)[0]).toContain(seed);
    const exec = (runs: number) => async () => ({ status: 0, stdout: "run\n".repeat(runs) });
    const { createHash } = await import("node:crypto");
    const key = `KEY: ${createHash("sha256").update(seed).digest("hex").slice(0, 16)}`;
    expect(await check!({ replies: [`It printed ${key}.`], seed, exec: exec(1) })).toEqual([]);
    expect(await check!({ replies: ["KEY: 0000"], seed, exec: exec(2) })).toEqual([`the reply lacks "${key}"`, "the command ran 2 times"]);
  });
});

describe("a prompt task", () => {
  test("is named for its text, with the given grant, any number of replies and no check", () => {
    const t = promptTask("List your workspace's files.", { workspace: true });
    expect(t.name).toMatch(/^prompt-[0-9a-f]{8}$/);
    expect(promptTask("List your workspace's files.").name).toBe(t.name);
    expect(promptTask("Something else.").name).not.toBe(t.name);
    expect(t).toMatchObject({ replies: "some", grant: { workspace: true } });
    expect(t.steps("x")).toEqual(["List your workspace's files."]);
    expect(t.check).toBeUndefined();
    expect(promptTask("hi").grant).toEqual({ spawn: true });
  });
});

describe("the harder tasks' checks", () => {
  // A stand-in workspace: a temporary folder as /home/agent, with commands
  // run on this machine, as the agent would run them.
  let home: string;
  beforeEach(() => (home = mkdtempSync(join(tmpdir(), "jen-eval-task-"))));
  afterEach(() => rmSync(home, { recursive: true, force: true }));
  const exec = async (argv: string[], input?: string) => {
    const run = spawnSync(argv[0]!, argv.slice(1).map((a) => a.replaceAll("/home/agent", home)), { cwd: home, env: { ...process.env, HOME: home }, input: input ?? "", encoding: "utf8" });
    return { status: run.status ?? 1, stdout: run.stdout };
  };
  const shell = (command: string) => spawnSync("sh", ["-c", command], { cwd: home, env: { ...process.env, HOME: home }, encoding: "utf8" });

  test("project: a module that meets the spec, with passing tests, passes; one that misses edge cases fails", async () => {
    const { check } = task("project");
    expect(task("project").grant).toEqual({ workspace: true });
    const module = [
      "import re",
      "UNITS = [('d', 86400), ('h', 3600), ('m', 60), ('s', 1)]",
      "PART = r'(\\d+)([dhms])'",
      "def parse(text):",
      "    if not isinstance(text, str): raise ValueError('not text')",
      "    if not re.fullmatch(r'\\s*' + PART + r'(?:\\s*(?:,\\s*)?' + PART + r')*\\s*', text): raise ValueError(text)",
      "    parts = re.findall(PART, text)",
      "    order = [u for u, _ in UNITS]",
      "    seen = [order.index(u) for _, u in parts]",
      "    if seen != sorted(set(seen)): raise ValueError(text)",
      "    return sum(int(n) * dict(UNITS)[u] for n, u in parts)",
      "def format(seconds, largest='d'):",
      "    if type(seconds) is not int or seconds < 0: raise ValueError(seconds)",
      "    names = [u for u, _ in UNITS]",
      "    if largest not in names: raise ValueError(largest)",
      "    if seconds == 0: return '0s'",
      "    out = ''",
      "    for unit, size in UNITS[names.index(largest):]:",
      "        n, seconds = divmod(seconds, size)",
      "        if n: out += f'{n}{unit}'",
      "    return out",
    ].join("\n");
    writeFileSync(join(home, "durations.py"), `${module}\n`);
    writeFileSync(join(home, "test_durations.py"), "import unittest, durations\nclass T(unittest.TestCase):\n    def test_parse(self):\n        self.assertEqual(durations.parse('1h30m'), 5400)\n");
    expect(await check!({ replies: ["I wrote 1 test."], seed: "s", exec })).toEqual([]);
    // isinstance lets a bool through, a repeated unit isn't refused, and
    // largest is ignored.
    const careless = module
      .replace("type(seconds) is not int", "not isinstance(seconds, int)")
      .replace("if seen != sorted(set(seen))", "if seen != sorted(seen)")
      .replace("UNITS[names.index(largest):]", "UNITS");
    writeFileSync(join(home, "durations.py"), `${careless}\n`);
    const faults = await check!({ replies: ["Done."], seed: "s", exec });
    expect(faults).toEqual([
      expect.stringMatching(/^5 hidden tests failed: parse\('1h1h'\) gave 7200, not 'ValueError'; format\(True\) gave '1s', not 'ValueError'; format\(90061, largest='h'\) gave '1d1h1m1s', not '25h1m1s'; /),
    ]);
    rmSync(join(home, "durations.py"));
    expect(await check!({ replies: [], seed: "s", exec })).toEqual(["1 hidden tests failed: the hidden tests couldn't run (exit 1)", "its own tests don't pass (exit 1)"]);
  });

  test("recover: the script fails twice, each time saying where to look, and once both are fixed the run passes", async () => {
    const { setup, check } = task("recover");
    const seed = "5eed5eed";
    await setup!({ seed, exec });
    const first = shell("python3 report.py");
    expect([first.status, first.stderr.trim()]).toEqual([1, "error: report.conf is missing. Run python3 report.py --help."]);
    expect(shell("python3 report.py --help").stdout).toContain("region = <eu, us or apac>\n  limit = <a whole number from 1 to 100>");
    expect(await check!({ replies: ["I couldn't."], seed, exec })).toEqual(["the report never succeeded: out/report.txt is missing", expect.stringMatching(/^the reply lacks the total, \d+$/)]);
    writeFileSync(join(home, "report.conf"), "region = eu\nlimit = 25\n");
    expect(shell("python3 report.py").stderr.trim()).toBe("error: data/eu.csv is missing. fetch.py makes it.");
    expect(shell("python3 fetch.py").stderr.trim()).toBe("usage: python3 fetch.py <eu, us or apac>");
    expect(shell("python3 fetch.py eu").stdout).toBe("Wrote data/eu.csv: 200 rows.\n");
    const last = shell("python3 report.py");
    expect(last.status).toBe(0);
    const total = Number(last.stdout.match(/Total: (\d+)/)![1]);
    expect(readFileSync(join(home, "out/report.txt"), "utf8")).toBe(`region=eu limit=25 total=${total}\n`);
    // The check computes the same total, and takes it with digit groups.
    expect(await check!({ replies: [`The total is ${total}.`], seed, exec })).toEqual([]);
    expect(await check!({ replies: [`The total is **${total.toLocaleString("en-US")}**.`], seed, exec })).toEqual([]);
    expect(await check!({ replies: [`The total is ${total + 1}.`], seed, exec })).toEqual([`the reply lacks the total, ${total}`]);
    // The wrong region, and running it again and again.
    writeFileSync(join(home, "report.conf"), "region = us\nlimit = 25\n");
    shell("python3 fetch.py us; python3 report.py; python3 report.py");
    expect(await check!({ replies: [`The total is ${total}.`], seed, exec })).toEqual([expect.stringMatching(/^out\/report\.txt holds "region=us limit=25 total=\d+\\n"$/), "report.py ran 5 times"]);
  });

  test("relay: a note holding the owner's facts passes, and one without them fails", async () => {
    const { check, answer, replies } = task("relay");
    expect(replies).toBe(2);
    expect(answer).toContain("Priya");
    expect(await check!({ replies: ["What's the teammate's name and start date?", "Welcome, Priya! You start on Monday 7 December. We're glad you're here."], seed: "s", exec })).toEqual([]);
    expect(await check!({ replies: ["Welcome, Alex! You start soon. We're glad you're here."], seed: "s", exec })).toEqual(["the note lacks the teammate's name", "the note lacks the start date"]);
  });
});
