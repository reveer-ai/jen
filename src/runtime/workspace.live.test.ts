// The workspace's boundary, checked from a real workspace container. Starts a
// runtime under a runtime name of its own, with placeholder model settings,
// since no model is called, spawns an agent with the workspace grant, and runs
// commands as that agent through POST /workspace/commands. Each test is one
// probe, so a failure names the one that didn't hold.
//
// It needs Docker and no credentials, so it never skips: without Docker it
// fails. CI runs it on every push, on a plain Linux kernel.
//
// Vitest can't interrupt a synchronous child, so each Docker command has its
// own deadline, and together they fit inside each test's timeout.

import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

const name = `jen-live-${randomBytes(4).toString("hex")}`;
const ownerToken = randomBytes(32).toString("hex");
const owner = { Authorization: `Bearer ${ownerToken}` };
let base = "";
let agentId = "";

const agentContainer = () => `${name}-agent-${agentId}`;
const workspace = () => `${name}-workspace-${agentId}`;

interface Answer {
  status: number;
  body: { exitCode: number | null; output: string; timedOut: boolean; cut?: { bytes: number; file: string }; error?: string };
  seconds: number;
}

// Runs a command as the agent, with its current token.
async function run(command: string, timeout?: number): Promise<Answer> {
  const started = Date.now();
  const res = await fetch(`${base}/workspace/commands`, {
    method: "POST",
    headers: { Authorization: `Bearer ${tokenOf(agentContainer())}` },
    body: JSON.stringify(timeout === undefined ? { command } : { command, timeout }),
    signal: AbortSignal.timeout(200_000),
  });
  return { status: res.status, body: await res.json(), seconds: (Date.now() - started) / 1000 };
}

// Runs a command that must succeed, and returns its output.
async function output(command: string): Promise<string> {
  const answer = await run(command);
  expect(answer, command).toMatchObject({ status: 200, body: { exitCode: 0, timedOut: false } });
  return answer.body.output;
}

const call = (path: string, init: RequestInit = {}) => fetch(`${base}${path}`, { ...init, headers: owner, signal: AbortSignal.timeout(120_000) });

beforeAll(async () => {
  for (const target of ["agent", "runtime", "workspace"]) {
    docker(["build", "--target", target, "-t", `jen-${target}`, join(import.meta.dirname, "../..")], { timeout: 300_000 });
  }
  // Placeholders: nothing here calls a model.
  const env = { ...process.env, JEN_RUNTIME_NAME: name, JEN_OWNER_TOKEN: ownerToken, JEN_MODEL: "placeholder", JEN_API_KEY: "placeholder" };
  const names = ["JEN_RUNTIME_NAME", "JEN_OWNER_TOKEN", "JEN_MODEL", "JEN_API_KEY"];
  docker(["run", "-d", "--name", `${name}-runtime`, "-p", "127.0.0.1::8080", "-v", "/var/run/docker.sock:/var/run/docker.sock", ...names.flatMap((n) => ["-e", n]), "jen-runtime"], { env });
  const port = docker(["port", `${name}-runtime`, "8080/tcp"]).trim().split("\n")[0]!.split(":").at(-1);
  base = `http://127.0.0.1:${port}`;
  await until(async () => !!(await fetch(base).catch(() => undefined)), "the runtime to serve");
  const res = await call("/agents", { method: "POST", body: JSON.stringify({ grant: { workspace: true } }) });
  const agent = await res.json();
  expect([res.status, agent.grant]).toEqual([201, { spawn: false, workspace: true }]);
  agentId = agent.id;
  expect(docker(["container", "inspect", "-f", "{{.State.Status}}", workspace()]).trim()).toBe("running");
}, 900_000);

afterAll(() => {
  // Everything the check created, whatever state it was left in.
  const quiet = (args: string[]) => spawnSync("docker", args, { encoding: "utf8", timeout: 30_000 });
  const containers = quiet(["ps", "-aq", "--filter", `label=jen.runtime=${name}`]).stdout.split("\n").filter(Boolean);
  quiet(["rm", "-f", `${name}-runtime`, ...containers]);
  const volumes = quiet(["volume", "ls", "-q", "--filter", `label=jen.runtime=${name}`]).stdout.split("\n").filter(Boolean);
  if (volumes.length > 0) quiet(["volume", "rm", ...volumes]);
  quiet(["network", "rm", name]);
}, 120_000);

describe("a workspace can't reach jen", () => {
  test("no JEN_* variable in its environment or any process it can see, and no agent process", async () => {
    const seen = await output("env; for f in /proc/[0-9]*/environ; do tr '\\0' '\\n' < \"$f\" 2>/dev/null; done; ps -eo user,args");
    expect(seen).not.toMatch(/JEN_/);
    expect(seen).not.toMatch(/node|main\.ts/);
    expect(seen).toMatch(/sleep infinity/);
  });

  test("no /state and no agent database", async () => {
    expect(await output("ls -d /state 2>&1; find / -name 'agent.db*' 2>/dev/null; true")).toMatch(/^ls: cannot access '\/state'/);
    expect(await output("find / -name 'agent.db*' 2>/dev/null; true")).toBe("");
  });

  test("nothing it writes outside its home, /tmp and /dev/shm can be read back", async () => {
    // Creates a file in every directory it can see, and appends to every
    // regular file it may write, reading each back. Docker's masked /proc
    // files look writable and discard what's written, so permissions alone
    // prove nothing.
    const script = [
      "probe=jen-probe-$$",
      "skip='^/(home/agent|tmp|dev/shm)(/|$)'",
      "{ find / -xdev -type d 2>/dev/null; find /dev /proc /sys -maxdepth 2 -type d 2>/dev/null; echo /proc/self; } | sort -u | while read -r d; do",
      '  [[ $d =~ $skip ]] && continue',
      '  { echo "$probe" > "$d/$probe"; } 2>/dev/null && [[ $(cat "$d/$probe" 2>/dev/null) == "$probe" ]] && echo "created in $d"',
      "done",
      "find / \\( -path /proc -o -path /sys -o -path /home/agent -o -path /tmp -o -path /dev/shm \\) -prune -o -type f -writable -print 2>/dev/null | while read -r f; do",
      '  { echo "$probe" >> "$f"; } 2>/dev/null && [[ $(tail -n 1 "$f" 2>/dev/null) == "$probe" ]] && echo "appended to $f"',
      "done",
      "true",
    ].join("\n");
    expect(await output(script)).toBe("");
    // The writable places are writable.
    expect(await output("for d in ~ /tmp /dev/shm; do echo x > $d/probe && cat $d/probe && rm $d/probe; done")).toBe("x\nx\nx\n");
  });

  test("an executable built in /tmp runs", async () => {
    expect(await output("printf '#!/bin/sh\\necho built\\n' > /tmp/tool && chmod +x /tmp/tool && /tmp/tool")).toBe("built\n");
  });

  test("it runs as agent with no capabilities and no new privileges", async () => {
    const status = await output("id; grep -E '^(CapEff|CapPrm|CapBnd|NoNewPrivs):' /proc/self/status");
    expect(status).toMatch(/^uid=1000\(agent\) gid=1000\(agent\)/);
    expect(status).toMatch(/CapEff:\s+0{16}/);
    expect(status).toMatch(/CapBnd:\s+0{16}/);
    expect(status).toMatch(/NoNewPrivs:\s+1/);
  });
});

describe("a workspace has no network", () => {
  test("it can't reach the runtime, its agent or the internet", async () => {
    const ip = (container: string) => docker(["container", "inspect", "-f", `{{(index .NetworkSettings.Networks "${name}").IPAddress}}`, container]).trim();
    const targets = [
      `http://${ip(`${name}-runtime`)}:8080`,
      `http://${ip(agentContainer())}:8080`,
      `http://${name}-runtime:8080`,
      "http://runtime:8080",
      "https://1.1.1.1",
      "https://example.com",
    ];
    const tried = await output(targets.map((url) => `curl -sS -m 5 -o /dev/null ${url} 2>/dev/null && echo "reached ${url}"`).join("; ") + "; ip -o addr 2>/dev/null || cat /proc/net/dev; true");
    expect(tried).not.toMatch(/reached/);
    expect(tried).not.toMatch(/eth0/);
  });

  test("its own loopback works: a background server outlives its call, and a later command fetches from it", async () => {
    const started = await run("python3 -m http.server 8000 > server.log 2>&1 &");
    expect(started.status).toBe(200);
    expect(started.seconds).toBeLessThan(5);
    expect(await output("for i in $(seq 100); do curl -sf -o /dev/null localhost:8000 && echo up && break; sleep 0.1; done")).toBe("up\n");
  });
});

describe("a workspace is bounded", () => {
  test("no more than 512 processes start", async () => {
    const counted = await output(
      [
        "python3 - <<'EOF'",
        "import os, signal, time",
        "kids, refused = [], False",
        "try:",
        "    for _ in range(600):",
        "        pid = os.fork()",
        "        if pid == 0:",
        "            time.sleep(60)",
        "            os._exit(0)",
        "        kids.append(pid)",
        "except OSError:",
        "    refused = True",
        "for pid in kids:",
        "    os.kill(pid, signal.SIGKILL)",
        "for pid in kids:",
        "    os.waitpid(pid, 0)",
        "print(refused, len(kids))",
        "EOF",
      ].join("\n"),
    );
    const [refused, started] = counted.trim().split(" ");
    expect(refused).toBe("True");
    expect(Number(started)).toBeLessThan(512);
  }, 60_000);

  test("its memory, CPU and pid limits are the fixed ones", async () => {
    expect(await output("cat /sys/fs/cgroup/memory.max /sys/fs/cgroup/cpu.max /sys/fs/cgroup/pids.max; df -B1 --output=size /tmp /dev/shm | tail -n 2 | tr -d ' '")).toBe(
      `${2 * 2 ** 30}\n200000 100000\n512\n${512 * 2 ** 20}\n${64 * 2 ** 20}\n`,
    );
  });
});

describe("commands", () => {
  test("a command's result, in bash, from the home directory", async () => {
    const answer = await run("echo hi; echo err >&2; exit 3");
    expect(answer).toMatchObject({ status: 200, body: { exitCode: 3, timedOut: false } });
    expect(answer.body.output).toBe("hi\nerr\n");
    expect(await output("cd /tmp; [[ -n $BASH_VERSION ]] && set -o pipefail && false | true || echo pipefail")).toBe("pipefail\n");
    expect(await output("pwd")).toBe("/home/agent\n");
  });

  test("long output is cut to its start and end, and saved whole", async () => {
    const answer = await run("seq 1 30000");
    const whole = Buffer.byteLength(Array.from({ length: 30000 }, (_, i) => `${i + 1}\n`).join(""));
    expect(answer.body.cut?.bytes).toBe(whole);
    expect(answer.body.output.startsWith("1\n2\n3\n")).toBe(true);
    expect(answer.body.output.endsWith("29999\n30000\n")).toBe(true);
    expect(Buffer.byteLength(answer.body.output)).toBe(8192);
    expect(await output(`seq 1 30000 | cmp - ${answer.body.cut!.file} && echo same`)).toBe("same\n");
  });

  test("short output leaves no file behind", async () => {
    const before = await output("ls ~/.jen/output | wc -l");
    expect(await output("seq 1 100 | wc -l")).toBe("100\n");
    expect(await output("ls ~/.jen/output | wc -l")).toBe(before);
  });

  test("a timeout kills its command, and nothing of it is left running", async () => {
    const answer = await run("sleep 100", 1);
    expect(answer).toMatchObject({ status: 200, body: { exitCode: null, timedOut: true } });
    expect(answer.seconds).toBeLessThan(6);
    expect(await output("ps -eo args | grep -cx 'sleep 100'; true")).toBe("0\n");
  }, 30_000);

  test("1 MiB written straight to the exec's stream through /proc gets 502 at once, and the command is killed", async () => {
    const answer = await run("head -c 1048576 /dev/zero > /proc/$PPID/fd/1; sleep 101");
    expect(answer.status).toBe(502);
    expect(answer.seconds).toBeLessThan(5);
    expect(await output("ps -eo args | grep -cx 'sleep 101'; true")).toBe("0\n");
  }, 30_000);

  test("a background process that holds the exec's stream and keeps writing doesn't hold the call", async () => {
    const answer = await run("(sleep 1; while :; do echo forged; sleep 0.2; done) > /proc/$PPID/fd/1 & echo done");
    expect(answer).toMatchObject({ status: 200, body: { exitCode: 0, output: "done\n" } });
    expect(answer.seconds).toBeLessThan(3);
  }, 30_000);

  test("a command that stops the wrapper is answered by its timeout plus 5 seconds", async () => {
    const answer = await run("kill -STOP $PPID; sleep 102", 2);
    expect(answer).toMatchObject({ status: 200, body: { exitCode: null, timedOut: true } });
    expect(answer.seconds).toBeLessThan(8);
    await until(async () => (await output("ps -eo args | grep -cx 'sleep 102'; true")) === "0\n", "the stopped command to be killed");
  }, 60_000);
});

describe("the workspace follows its agent", () => {
  test("files survive a stop and a start, and the background server doesn't", async () => {
    await output("echo kept > ~/kept.txt");
    expect((await call(`/agents/${agentId}/stop`, { method: "POST" })).status).toBe(200);
    expect(exists("container", workspace())).toBe(false);
    expect(exists("volume", workspace())).toBe(true);
    expect((await call(`/agents/${agentId}/start`, { method: "POST" })).status).toBe(200);
    expect(await output("cat ~/kept.txt")).toBe("kept\n");
    expect(await output("curl -sf -o /dev/null localhost:8000 && echo up; ps -eo args | grep -c '[h]ttp.server'; true")).toBe("0\n");
  }, 120_000);

  test("stopping the agent mid-command gets 409", async () => {
    const running = run("sleep 103");
    await until(async () => docker(["exec", workspace(), "ps", "-eo", "args"]).includes("sleep 103"), "the command to start");
    try {
      expect((await call(`/agents/${agentId}/stop`, { method: "POST" })).status).toBe(200);
      const answer = await running;
      expect(answer.status).toBe(409);
      expect(answer.body.error).toBe("the workspace stopped during the command");
    } finally {
      // The later probes need the agent running, whatever this one found.
      expect((await call(`/agents/${agentId}/start`, { method: "POST" })).status).toBe(200);
    }
  }, 120_000);

  test("a workspace whose first process is killed comes back with its files, and the agent keeps running", async () => {
    const restarts = () => Number(docker(["container", "inspect", "-f", "{{.RestartCount}}", workspace()]).trim());
    const before = restarts();
    // The container may stop before the exec reports, so its status is ignored.
    spawnSync("docker", ["exec", "-u", "agent", workspace(), "pkill", "-KILL", "-xf", "sleep infinity"], { timeout: 30_000 });
    await until(() => restarts() > before && docker(["container", "inspect", "-f", "{{.State.Status}}", workspace()]).trim() === "running", "the workspace to restart");
    expect(await output("cat ~/kept.txt")).toBe("kept\n");
    expect((await (await call(`/agents/${agentId}`)).json()).state).toBe("running");
  }, 120_000);

  test("deleting the agent removes its workspace container and volume", async () => {
    expect((await call(`/agents/${agentId}`, { method: "DELETE" })).status).toBe(204);
    expect(exists("container", workspace())).toBe(false);
    expect(exists("volume", workspace())).toBe(false);
  }, 120_000);
});

function tokenOf(container: string): string {
  return docker(["container", "inspect", "-f", "{{range .Config.Env}}{{println .}}{{end}}", container])
    .split("\n")
    .find((e) => e.startsWith("JEN_TOKEN="))!
    .slice("JEN_TOKEN=".length);
}

function exists(kind: "container" | "volume", n: string): boolean {
  return spawnSync("docker", [kind, "inspect", n], { timeout: 30_000 }).status === 0;
}

async function until(check: () => boolean | Promise<boolean>, what: string) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`timed out waiting for ${what}`);
}

function docker(args: string[], { env, timeout = 30_000 }: { env?: NodeJS.ProcessEnv; timeout?: number } = {}): string {
  const result = spawnSync("docker", args, { encoding: "utf8", env, timeout });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`docker ${args[0]} exited ${result.status}: ${result.stderr}`);
  return result.stdout;
}
