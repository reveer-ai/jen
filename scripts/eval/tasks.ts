// The tasks an evaluation runs, and their checks. A task is the owner's
// messages to a root of its own, how many replies the owner should get, and
// optionally an answer sent once the root first replies and a check of its
// own, run once the run has settled. Every run gets a fresh seed, which a
// task may build into its messages so that no run can reuse another's answer.
//
// A task is identified by its name and a hash of its definition: its fields,
// its messages as they read with a fixed seed, and its setup's and check's
// source. A setup or check that reads a value from outside itself must take
// it from its messages or its own source, so that changing the value changes
// the hash.

import { createHash } from "node:crypto";

export interface Grant {
  spawn?: boolean;
  workspace?: boolean;
}

// What a check may look at once its run has settled, before the root is
// deleted.
export interface CheckInput {
  // The root's replies to the owner, in order.
  replies: string[];
  // The run's seed.
  seed: string;
  // Runs argv in the root's workspace as its agent, with input on stdin, and
  // resolves once it exits. Only a task whose grant has workspace may call it.
  exec(argv: string[], input?: string): Promise<{ status: number; stdout: string }>;
}

export interface Task {
  name: string;
  // The owner's messages for a run with this seed: the first, then each later
  // one once the run settles.
  steps: (seed: string) => string[];
  // How many replies the owner should get, or "some" for one or more.
  replies: number | "some";
  // Sent to the root once it first replies.
  answer?: string;
  // The root's grant, which is {"spawn": true} unless set.
  grant?: Grant;
  // How long a run may take to settle, in milliseconds; 6 minutes unless set.
  limitMs?: number;
  // Prepares the root's workspace before the first message.
  setup?: (run: Pick<CheckInput, "seed" | "exec">) => Promise<void>;
  // Faults only this task can see, each a sentence saying what's wrong.
  check?: (run: CheckInput) => Promise<string[]>;
}

// The seed a task's hash reads its messages with.
const HASH_SEED = "00000000";

// The command task's command: a hash of the seed the model can't work out
// without running it. It counts its own runs before it prints anything, so a
// run piped into grep, or rewritten any other way, still counts. About 140 KB
// of log, with the line in its middle, in neither the start nor the end a cut
// output keeps.
const command = (seed: string) =>
  'echo run >> ~/runs.txt; for i in $(seq 1 4000); do echo "worker[$i]: step complete, status ok"; ' +
  `if [ "$i" -eq 2000 ]; then echo "KEY: $(printf %s ${seed} | sha256sum | cut -c1-16)"; fi; done`;

// The file task's files. settings.conf is about 35 KB, written by a command,
// with the line to change in its middle; release.md's text holds what breaks
// a heredoc or shell quoting.
const settingsCommand =
  'for i in $(seq 1 600); do echo "option_$i = value_$i  # how the service handles case $i"; if [ "$i" -eq 300 ]; then echo "cache_ttl = 300"; fi; done > ~/settings.conf';
const release = [
  "# Release 2.4",
  "",
  "- Paths under `$HOME` now expand, so \"~/.config\" works.",
  "- The 'quiet' flag is kept when `--verbose` is set.",
  "EOF",
  "Windows paths end in a backslash, such as C:\\",
].join("\n");

export const TASKS: Task[] = [
  { name: "delegation", steps: () => ["Spawn a sub-agent to write a haiku about herons, then send me its haiku."], replies: 1 },
  { name: "direct", steps: () => ["What's the capital of Australia?"], replies: 1 },
  {
    name: "fanout",
    steps: () => ["Get three sub-agents to each propose a name for a coffee shop, then send me the best of the three with one line on why."],
    replies: 1,
  },
  {
    name: "question",
    steps: () => ["Have a sub-agent write a two-line wedding toast for my sister and her partner, using their names."],
    replies: 2,
    answer: "Maya and Jordan.",
  },
  { name: "followup", steps: () => ["Have a sub-agent write a haiku about herons and send it to me.", "Nice. Now one about cranes."], replies: 2 },
  {
    name: "nested",
    steps: () => [
      "Set up a small team: one sub-agent who leads two sub-agents of its own. The two each write one sentence of a two-sentence story about a lighthouse, and the lead combines them. Send me the story.",
    ],
    replies: 1,
  },
  {
    name: "command",
    steps: (seed) => [`Run this command in your workspace exactly once, and tell me the line of its output that starts with "KEY:".\n\n${command(seed)}`],
    replies: 1,
    grant: { workspace: true },
    check: async ({ replies, seed, exec }) => {
      const key = `KEY: ${createHash("sha256").update(seed).digest("hex").slice(0, 16)}`;
      const faults: string[] = [];
      if (!replies.some((text) => text.includes(key))) faults.push(`the reply lacks "${key}"`);
      const runs = (await exec(["cat", "/home/agent/runs.txt"])).stdout.split("\n").filter(Boolean).length;
      if (runs > 1) faults.push(`the command ran ${runs} times`);
      return faults;
    },
  },
  {
    // An edit in the middle of a file far over a command's output cap, and a
    // file whose text would break a heredoc. Judged by the files, not by the
    // tools that wrote them.
    name: "files",
    steps: () => [
      `In your workspace, run this command once, which writes settings.conf:\n\n${settingsCommand}\n\n` +
        "Then change the line `cache_ttl = 300` in settings.conf to `cache_ttl = 900`, and change nothing else in the file. " +
        "Then create notes/release.md holding exactly the text between the BEGIN and END lines below, not including them. Reply when you're done.\n\n" +
        `BEGIN\n${release}\nEND`,
    ],
    replies: 1,
    grant: { workspace: true },
    check: async ({ exec }) => {
      const settings = (ttl: number) =>
        Array.from({ length: 600 }, (_, i) => `option_${i + 1} = value_${i + 1}  # how the service handles case ${i + 1}\n${i + 1 === 300 ? `cache_ttl = ${ttl}\n` : ""}`).join("");
      const faults: string[] = [];
      const conf = await exec(["cat", "/home/agent/settings.conf"]);
      if (conf.status !== 0) faults.push("settings.conf can't be read");
      else if (conf.stdout !== settings(900)) faults.push(conf.stdout === settings(300) ? "settings.conf is unchanged" : "settings.conf differs from the expected bytes");
      const notes = await exec(["cat", "/home/agent/notes/release.md"]);
      if (notes.status !== 0) faults.push("notes/release.md can't be read");
      else if (notes.stdout !== release && notes.stdout !== `${release}\n`) faults.push(`notes/release.md holds ${JSON.stringify(notes.stdout)}`);
      return faults;
    },
  },
  {
    // Long multi-step work in a workspace: a module and its tests from a
    // short spec, judged by tests the agent never sees.
    name: "project",
    steps: () => [
      "In your workspace, write a Python module durations.py with two functions, and a unittest file test_durations.py that tests them. " +
        "Run the tests with `python3 -m unittest test_durations` until they pass, then reply with how many tests you wrote.\n\n" +
        '- parse(text) takes a duration such as "1h30m", "90s", "2d 4h" or "1d2h3m4s" and returns its length in whole seconds. ' +
        "The units are d, h, m and s: 86400, 3600, 60 and 1 seconds. Each part is a whole number followed by its unit, and the number may have leading zeros. " +
        'Parts may be separated by spaces, or by a comma with optional spaces around it, as in "1h, 30m", but a comma must sit between two parts. Leading and trailing spaces are allowed. ' +
        'Units must appear in that order, each at most once, and a number may be any size, so "90m" is 5400. ' +
        "Anything else raises ValueError: an empty string, a negative number, a decimal, a number with no unit, an unknown unit, a repeated unit, or units out of order.\n" +
        '- format(seconds, largest="d") takes a non-negative int and returns its shortest form: units from largest down to s, no spaces, units of zero left out, so 3661 is "1h1m1s", 86400 is "1d" and 0 is "0s". ' +
        'largest is the largest unit to use, one of d, h, m and s, so format(90061, largest="h") is "25h1m1s". ' +
        "A negative number, anything that isn't an int, or an unknown largest raises ValueError. A bool isn't an int here.",
    ],
    replies: 1,
    grant: { workspace: true },
    limitMs: 600_000,
    check: async ({ exec }) => {
      const hidden = [
        "import json, durations",
        "failures = []",
        "def expect(label, fn, want):",
        "    try:",
        "        got = fn()",
        "    except Exception as error:",
        "        got = type(error).__name__",
        "    if got != want: failures.append(f'{label} gave {got!r}, not {want!r}')",
        "for text, want in [('1h30m', 5400), ('90s', 90), ('2d 4h', 187200), ('1d2h3m4s', 93784), ('  5m  ', 300), ('90m', 5400), ('0s', 0), ('1h 0m', 3600), ('100000s', 100000), ('1h, 30m', 5400), ('1h,30m', 5400), ('1d , 2h 3m', 93780), ('01h', 3600), ('007s', 7)]:",
        "    expect(f'parse({text!r})', lambda: durations.parse(text), want)",
        "for text in ['', '   ', '-5m', '1.5h', '5', 'h', '5x', '1h1h', '1m1h', '1h 30', '1h-30m', '1h,,30m', ',1h', '1h,', '1h, ,30m']:",
        "    expect(f'parse({text!r})', lambda: durations.parse(text), 'ValueError')",
        "for n, want in [(0, '0s'), (59, '59s'), (60, '1m'), (3661, '1h1m1s'), (86400, '1d'), (93784, '1d2h3m4s'), (90061, '1d1h1m1s'), (3600, '1h'), (86460, '1d1m')]:",
        "    expect(f'format({n!r})', lambda: durations.format(n), want)",
        "for n in [-1, 1.5, True, '5']:",
        "    expect(f'format({n!r})', lambda: durations.format(n), 'ValueError')",
        "for n, largest, want in [(90061, 'h', '25h1m1s'), (3600, 'm', '60m'), (59, 'm', '59s'), (0, 'h', '0s'), (90061, 's', '90061s'), (90061, 'd', '1d1h1m1s')]:",
        "    expect(f'format({n!r}, largest={largest!r})', lambda: durations.format(n, largest=largest), want)",
        "for largest in ['x', 'H', '']:",
        "    expect(f'format(10, largest={largest!r})', lambda: durations.format(10, largest=largest), 'ValueError')",
        "for n in [1, 61, 3599, 86399, 1000000]:",
        "    expect(f'parse(format({n}))', lambda: durations.parse(durations.format(n)), n)",
        "print(json.dumps(failures))",
      ].join("\n");
      const faults: string[] = [];
      const run = await exec(["python3", "-"], hidden);
      let failures: string[];
      try {
        failures = JSON.parse(run.stdout.trim().split("\n").at(-1) ?? "");
      } catch {
        failures = [run.status === 124 ? "the hidden tests didn't finish within 2 minutes" : `the hidden tests couldn't run (exit ${run.status})`];
      }
      if (failures.length > 0) faults.push(`${failures.length} hidden tests failed: ${failures.slice(0, 5).join("; ")}`);
      const own = await exec(["python3", "-m", "unittest", "test_durations"]);
      if (own.status !== 0) faults.push(`its own tests don't pass (exit ${own.status})`);
      return faults;
    },
  },
  {
    // Recovering from failed commands: a script that fails twice, each time
    // saying only where to look next, and succeeds once both are fixed.
    name: "recover",
    steps: () => ["In your workspace, run `python3 report.py` to make the report for the eu region with a limit of 25, and tell me the total it prints."],
    replies: 1,
    grant: { workspace: true },
    limitMs: 480_000,
    setup: async ({ seed, exec }) => {
      const report = [
        "import hashlib, os, sys",
        "home = os.path.expanduser('~')",
        "if sys.argv[1:] in (['--help'], ['-h']):",
        "    print('usage: python3 report.py\\n\\nMakes the report report.conf describes. report.conf holds exactly two lines:\\n  region = <eu, us or apac>\\n  limit = <a whole number from 1 to 100>\\nThe report reads data/<region>.csv.')",
        "    sys.exit(0)",
        "with open(os.path.join(home, '.report-runs'), 'a') as runs: runs.write('run\\n')",
        "if sys.argv[1:]: sys.exit('error: report.py takes no arguments. Run python3 report.py --help.')",
        "conf = os.path.join(home, 'report.conf')",
        "if not os.path.exists(conf): sys.exit('error: report.conf is missing. Run python3 report.py --help.')",
        "values = {}",
        "for line in open(conf):",
        "    if not line.strip(): continue",
        "    if '=' not in line: sys.exit('error: report.conf is invalid. Run python3 report.py --help.')",
        "    key, value = (part.strip() for part in line.split('=', 1))",
        "    values[key] = value",
        "if set(values) != {'region', 'limit'} or values['region'] not in ('eu', 'us', 'apac') or not values['limit'].isdigit() or not 1 <= int(values['limit']) <= 100:",
        "    sys.exit('error: report.conf is invalid. Run python3 report.py --help.')",
        "data = os.path.join(home, 'data', values['region'] + '.csv')",
        "if not os.path.exists(data): sys.exit(f'error: data/{values[\"region\"]}.csv is missing. fetch.py makes it.')",
        "rows = [int(line.split(',')[1]) for line in open(data).read().split()[1:]]",
        "total = sum(sorted(rows, reverse=True)[:int(values['limit'])])",
        "os.makedirs(os.path.join(home, 'out'), exist_ok=True)",
        "with open(os.path.join(home, 'out', 'report.txt'), 'w') as out: out.write(f'region={values[\"region\"]} limit={values[\"limit\"]} total={total}\\n')",
        "print(f'Report written to out/report.txt. Total: {total}')",
      ].join("\n");
      const fetch = [
        "import hashlib, os, sys",
        "if len(sys.argv) != 2 or sys.argv[1] not in ('eu', 'us', 'apac'): sys.exit('usage: python3 fetch.py <eu, us or apac>')",
        "region = sys.argv[1]",
        "home = os.path.expanduser('~')",
        "os.makedirs(os.path.join(home, 'data'), exist_ok=True)",
        `rows = [int(hashlib.sha256(f'${seed}:{region}:{i}'.encode()).hexdigest()[:4], 16) for i in range(200)]`,
        "with open(os.path.join(home, 'data', region + '.csv'), 'w') as out: out.write('id,amount\\n' + ''.join(f'{i},{n}\\n' for i, n in enumerate(rows)))",
        "print(f'Wrote data/{region}.csv: 200 rows.')",
      ].join("\n");
      for (const [name, text] of [["report.py", report], ["fetch.py", fetch]]) {
        const wrote = await exec(["sh", "-c", `cat > /home/agent/${name}`], `${text}\n`);
        if (wrote.status !== 0) throw new Error(`${name} couldn't be written (exit ${wrote.status})`);
      }
    },
    check: async ({ replies, seed, exec }) => {
      const rows = Array.from({ length: 200 }, (_, i) => parseInt(createHash("sha256").update(`${seed}:eu:${i}`).digest("hex").slice(0, 4), 16));
      const total = rows.sort((a, b) => b - a).slice(0, 25).reduce((a, b) => a + b, 0);
      const faults: string[] = [];
      const out = await exec(["cat", "/home/agent/out/report.txt"]);
      if (out.status !== 0) faults.push("the report never succeeded: out/report.txt is missing");
      else if (out.stdout !== `region=eu limit=25 total=${total}\n`) faults.push(`out/report.txt holds ${JSON.stringify(out.stdout)}`);
      // A total written with digit groups, such as 28,751, is the total.
      if (!replies.some((text) => text.replace(/(?<=\d)[,\u00a0\u202f ](?=\d{3}\b)/g, "").includes(String(total)))) faults.push(`the reply lacks the total, ${total}`);
      // Once with no config, once with no data and once to succeed, and one
      // more allowed; --help isn't counted.
      const runs = (await exec(["cat", "/home/agent/.report-runs"])).stdout.split("\n").filter(Boolean).length;
      if (runs > 4) faults.push(`report.py ran ${runs} times`);
      return faults;
    },
  },
  {
    // A question relayed through two levels of sub-agents: only the owner
    // has the fact the deepest one needs.
    name: "relay",
    steps: () => [
      "Set up a small team: one sub-agent who leads a sub-agent of its own, the writer. The writer writes a three-sentence welcome note for a new teammate, using the teammate's name and start date. " +
        "Only I know those, so the writer has to ask me for them through the team. Send me the finished note.",
    ],
    replies: 2,
    answer: "Her name is Priya Raman, and she starts on Monday 7 December.",
    limitMs: 480_000,
    check: async ({ replies }) => {
      const note = replies.at(-1) ?? "";
      const faults: string[] = [];
      if (!note.includes("Priya")) faults.push("the note lacks the teammate's name");
      if (!/\b7(?:st|nd|rd|th)?(?: of)? Dec(?:ember)?\b|\bDec(?:ember)?\.? 7(?:st|nd|rd|th)?\b/i.test(note)) faults.push("the note lacks the start date");
      return faults;
    },
  },
];

// A prompt given on the command line, as a one-step task judged by the
// shared faults, with any number of replies of one or more.
export function promptTask(text: string, grant: Grant = { spawn: true }): Task {
  return { name: `prompt-${createHash("sha256").update(text).digest("hex").slice(0, 8)}`, steps: () => [text], replies: "some", grant };
}

// The task's identity beside its name: a hash of its fields, its messages
// with a fixed seed and its check's source.
export function hashTask(task: Task): string {
  const definition = {
    name: task.name,
    steps: task.steps(HASH_SEED),
    replies: task.replies,
    answer: task.answer ?? null,
    grant: task.grant ?? null,
    limitMs: task.limitMs ?? null,
    setup: task.setup?.toString() ?? null,
    check: task.check?.toString() ?? null,
  };
  return createHash("sha256").update(JSON.stringify(definition)).digest("hex").slice(0, 16);
}
