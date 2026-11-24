// The boundary of an agent's world, checked from real containers. Starts a
// stand-in model provider on Docker's default bridge, then a runtime under a
// runtime name of its own, with a placeholder model and key and the
// stand-in's address as JEN_BASE_URL, and spawns an agent with the workspace
// grant. It runs commands as that agent through POST /workspace/commands,
// reads and writes files through /workspace/files, and probes the agent's own
// container with docker exec: what it holds, what it reaches, and what its
// model calls carry to the stand-in. Each test is one probe, so a failure
// names the one that didn't hold.
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
import { WRITE_SCRIPT } from "./workspace.ts";

const name = `jen-live-${randomBytes(4).toString("hex")}`;
const ownerToken = randomBytes(32).toString("hex");
// The runtime's placeholder model settings: no real model is called.
const placeholderModel = "placeholder-model";
const placeholderKey = `placeholder-key-${randomBytes(8).toString("hex")}`;
// The stand-in provider, and a listener on the engine's host network.
const provider = `${name}-provider`;
const hostListener = `${name}-host`;
const hostPort = 20000 + randomBytes(2).readUInt16BE() % 20000;
let baseURL = "";
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

// Reads or writes a file as the agent, with its current token.
async function file(path: string, body?: Buffer | string): Promise<{ status: number; bytes: Buffer; error?: string }> {
  const res = await fetch(`${base}/workspace/files?path=${encodeURIComponent(path)}`, {
    method: body === undefined ? "GET" : "PUT",
    headers: { Authorization: `Bearer ${tokenOf(agentContainer())}` },
    body: typeof body === "string" ? body : body && new Uint8Array(body),
    signal: AbortSignal.timeout(60_000),
  });
  const bytes = Buffer.from(await res.arrayBuffer());
  return { status: res.status, bytes, ...(res.status >= 400 ? { error: JSON.parse(bytes.toString("utf8")).error } : {}) };
}

const call = (path: string, init: RequestInit = {}) => fetch(`${base}${path}`, { ...init, headers: owner, signal: AbortSignal.timeout(120_000) });

beforeAll(async () => {
  for (const target of ["agent", "runtime", "workspace"]) {
    docker(["build", "--target", target, "-t", `jen-${target}`, join(import.meta.dirname, "../..")], { timeout: 300_000 });
  }
  // The stand-in records each call and answers it as a provider would. It's
  // on the default bridge, as a provider is beyond the runtime's own network.
  docker(["run", "-d", "--name", provider, "--entrypoint", "node", "jen-runtime", "-e", STAND_IN]);
  const providerIP = docker(["container", "inspect", "-f", "{{.NetworkSettings.Networks.bridge.IPAddress}}", provider]).trim();
  baseURL = `http://${providerIP}:8080/v1`;
  // Accepts connections on every address the engine's host has.
  docker(["run", "-d", "--name", hostListener, "--network", "host", "-e", `PORT=${hostPort}`, "--entrypoint", "node", "jen-runtime", "-e", HOST_LISTENER]);
  // Placeholders: the stand-in takes any model and key.
  const env = { ...process.env, JEN_RUNTIME_NAME: name, JEN_OWNER_TOKEN: ownerToken, JEN_MODEL: placeholderModel, JEN_API_KEY: placeholderKey, JEN_BASE_URL: baseURL };
  const names = ["JEN_RUNTIME_NAME", "JEN_OWNER_TOKEN", "JEN_MODEL", "JEN_API_KEY", "JEN_BASE_URL"];
  docker(["run", "-d", "--name", `${name}-runtime`, "-p", "127.0.0.1::8080", "-v", "/var/run/docker.sock:/var/run/docker.sock", ...names.flatMap((n) => ["-e", n]), "jen-runtime"], { env });
  const port = docker(["port", `${name}-runtime`, "8080/tcp"]).trim().split("\n")[0]!.split(":").at(-1);
  base = `http://127.0.0.1:${port}`;
  await until(async () => !!(await fetch(base).catch(() => undefined)), "the runtime to serve");
  const res = await call("/agents", { method: "POST", body: JSON.stringify({ grant: { workspace: true }, name: "boundary" }) });
  const agent = await res.json();
  expect([res.status, agent.grant]).toEqual([201, { spawn: false, workspace: true }]);
  agentId = agent.id;
  expect(docker(["container", "inspect", "-f", "{{.State.Status}}", workspace()]).trim()).toBe("running");
}, 900_000);

afterAll(() => {
  // Everything the check created, whatever state it was left in.
  const quiet = (args: string[]) => spawnSync("docker", args, { encoding: "utf8", timeout: 30_000 });
  const containers = quiet(["ps", "-aq", "--filter", `label=jen.runtime=${name}`]).stdout.split("\n").filter(Boolean);
  quiet(["rm", "-f", `${name}-runtime`, provider, hostListener, ...containers]);
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

describe("an agent's container holds no key and reaches only the runtime", () => {
  test("no key or endpoint in its configuration, its environment or any process's", () => {
    const config = docker(["container", "inspect", "-f", "{{json .Config}}", agentContainer()]);
    const seen = docker(["exec", "-u", "0", agentContainer(), "sh", "-c", "env; for f in /proc/[0-9]*/environ; do tr '\\0' '\\n' < \"$f\" 2>/dev/null; done; true"]);
    // The control: the agent's own token is there to find.
    expect(seen).toContain(`JEN_TOKEN=${tokenOf(agentContainer())}`);
    for (const held of [placeholderKey, baseURL, "JEN_API_KEY", "JEN_BASE_URL"]) {
      expect(config, held).not.toContain(held);
      expect(seen, held).not.toContain(held);
    }
  });

  test("it reaches the runtime", () => {
    expect(inAgent(`return await connects("runtime", 8080)`)).toBe(true);
  });

  test("it can't connect to a public address", () => {
    expect(inAgent(`return { https: await connects("1.1.1.1", 443), dns: await connects("8.8.8.8", 53) }`)).toEqual({ https: false, dns: false });
  });

  test("it gets no DNS answer for a public name, from its resolver or a public one", () => {
    const answers = inAgent(`
      const dns = process.getBuiltinModule("node:dns").promises;
      const answered = (lookup) => lookup.then(() => true, () => false);
      const resolver = new dns.Resolver({ timeout: 3000, tries: 1 });
      resolver.setServers(["8.8.8.8", "1.1.1.1"]);
      return {
        example: await answered(dns.lookup("example.com")),
        host: await answered(dns.lookup("host.docker.internal")),
        public: await answered(resolver.resolve4("example.com")),
      };
    `);
    expect(answers).toEqual({ example: false, host: false, public: false });
  });

  test("it can't connect to the engine's host at any address the host has", () => {
    const addresses = hostAddresses();
    expect(addresses.length).toBeGreaterThan(0);
    // The control: a container on a plain bridge reaches the listener at its gateway.
    const gateway = docker(["network", "inspect", "-f", "{{(index .IPAM.Config 0).Gateway}}", "bridge"]).trim();
    expect(runIn(provider, `return await connects(${JSON.stringify(gateway)}, ${hostPort})`)).toBe(true);
    const reached = inAgent(`
      const addresses = ${JSON.stringify(addresses)};
      const results = await Promise.all(addresses.map((a) => connects(a, ${hostPort})));
      return addresses.filter((a, i) => results[i]);
    `);
    expect(reached).toEqual([]);
  }, 60_000);

  test("a valid model call reaches the provider with the runtime's model and key", () => {
    const before = received().length;
    const status = inAgent(`return await callModel(${JSON.stringify(modelCall())})`);
    expect(status).toBe(200);
    const calls = received().slice(before);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ method: "POST", url: "/v1/responses", authorization: `Bearer ${placeholderKey}` });
    expect(JSON.parse(calls[0]!.body)).toEqual({ ...modelCall(), model: placeholderModel });
  });

  test("a model call with an image by URL gets 400 and reaches nothing", () => {
    const before = received().length;
    const call = { ...modelCall(), input: [{ role: "user", content: [{ type: "input_image", image_url: `${baseURL}/fetched-by-the-provider.png` }] }] };
    expect(inAgent(`return await callModel(${JSON.stringify(call)})`)).toBe(400);
    expect(received()).toHaveLength(before);
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

  test("a command starts with no signal ignored", async () => {
    expect(await output("grep SigIgn /proc/self/status")).toBe("SigIgn:\t0000000000000000\n");
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
    await until(async () => (await output("ps -eo args | grep -cx 'sleep 100'; true")) === "0\n", "the timed-out command to end");
  }, 60_000);

  test("a command that stops itself keeps its call until its timeout", async () => {
    const answer = await run("kill -STOP $$; echo resumed", 1);
    expect(answer).toMatchObject({ status: 200, body: { exitCode: null, timedOut: true, output: "" } });
  }, 60_000);

  test("1 MiB written straight to the exec's stream through /proc gets 502 at once, and the command is killed", async () => {
    const answer = await run("head -c 1048576 /dev/zero > /proc/$PPID/fd/1; sleep 101");
    expect(answer.status).toBe(502);
    expect(answer.seconds).toBeLessThan(5);
    // SIGKILL is delivered at once, but a loaded machine may take a moment to end the process.
    await until(async () => (await output("ps -eo args | grep -cx 'sleep 101'; true")) === "0\n", "the flooding command to end");
  }, 60_000);

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

describe("files", () => {
  test("all 256 byte values written to a new folder come back unchanged, in a file owned by agent", async () => {
    const bytes = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
    expect((await file("data/new/bytes.bin", bytes)).status).toBe(204);
    const read = await file("data/new/bytes.bin");
    expect(read.status).toBe(200);
    expect(read.bytes).toEqual(bytes);
    expect(await output("stat -c '%U %s' /home/agent/data/new/bytes.bin")).toBe("agent 256\n");
  });

  test("a relative path is relative to the home directory", async () => {
    expect((await file("notes.txt", "hello\n")).status).toBe(204);
    expect(await output("cat /home/agent/notes.txt")).toBe("hello\n");
  });

  test("an executable keeps its mode across a write", async () => {
    await output("printf '#!/bin/sh\\necho old\\n' > tool.sh && chmod 755 tool.sh");
    expect((await file("tool.sh", "#!/bin/sh\necho new\n")).status).toBe(204);
    expect(await output("stat -c %a tool.sh; ./tool.sh")).toBe("755\nnew\n");
  });

  test("a write over a file with mode 444 is refused, and leaves it unchanged", async () => {
    await output("echo old > ro.txt && chmod 444 ro.txt");
    const write = await file("ro.txt", "new\n");
    expect([write.status, write.error]).toEqual([400, "Permission denied"]);
    expect(await output("cat ro.txt; stat -c %a ro.txt")).toBe("old\n444\n");
  });

  test("a pseudo-file whose size reads as 0 is read with its content", async () => {
    expect(await output("stat -c %s /proc/self/status")).toBe("0\n");
    const read = await file("/proc/self/status");
    expect(read.status).toBe(200);
    expect(read.bytes.toString("utf8")).toMatch(/^Name:/);
    expect(read.bytes.toString("utf8")).toMatch(/\nUid:\s+1000\s/);
  });

  test("writes outside what a command can write are refused, through a symlink too, and change nothing", async () => {
    const passwd = await output("cat /etc/passwd");
    await output("ln -sf /etc/passwd passwd-link");
    for (const path of ["/etc/jen-probe", "/usr/local/bin/jen-probe", "passwd-link"]) {
      const write = await file(path, "jen-probe\n");
      expect(write.status, path).toBe(400);
      expect(write.error, path).toMatch(/^(Read-only file system|Permission denied)$/);
    }
    expect(await output("cat /etc/passwd")).toBe(passwd);
    expect(await output("ls /etc/jen-probe /usr/local/bin/jen-probe 2>&1; true")).toMatch(/No such file or directory[\s\S]*No such file or directory/);
  });

  test("jen's state isn't there, and a folder is refused", async () => {
    expect((await file("/state/agent.db")).status).toBe(404);
    const folder = await file("/home/agent");
    expect([folder.status, folder.error]).toEqual([400, "Is a directory"]);
    expect((await file("/home/agent", "x")).status).toBe(400);
  });

  test("a path naming a folder is refused as a redirect would refuse it, and writes nothing", async () => {
    for (const path of ["slash/", "slash/.", "."]) {
      const write = await file(path, "x");
      expect([write.status, write.error], path).toEqual([400, "Is a directory"]);
    }
    expect(await output("ls -d slash 2>&1; true")).toMatch(/No such file or directory/);
  });

  test("a read or write of a pipe nothing uses is answered within 30 seconds, and leaves nothing running", async () => {
    await output("mkfifo read-pipe write-pipe");
    const started = Date.now();
    const [read, write] = await Promise.all([file("read-pipe"), file("write-pipe", "x")]);
    expect((Date.now() - started) / 1000).toBeLessThan(30);
    expect([read.status, read.error]).toEqual([400, "the read didn't finish within 25 seconds, as when the file is a pipe nothing writes to"]);
    expect([write.status, write.error]).toEqual([400, "the write didn't finish within 25 seconds, as when the file is a pipe nothing reads from"]);
    // Anchored to the scripts' last arguments, so the pattern can't match this command's own wrapper.
    expect(await output("ps -eo args | grep -cE '[j]en (read-pipe 16777216|write-pipe 1)$|^[h]ead -c 16777217'; ls -A /tmp | grep -c jen-read; ls -A | grep -c jen-; true")).toBe(
      "0\n0\n0\n",
    );
  }, 60_000);

  test("a 17 MiB file gets 413", async () => {
    await output("head -c 17825792 /dev/zero > big.bin");
    expect((await file("big.bin")).status).toBe(413);
    await output("rm big.bin");
  }, 60_000);

  test("a write cut short leaves the file as it was, and no temporary file", async () => {
    await output("echo old > cut.txt");
    // The write script as the runtime sends it, given 3 of 10 declared bytes.
    const cut = spawnSync("docker", ["exec", "-i", "-u", "agent", "-w", "/home/agent", workspace(), "bash", "-c", WRITE_SCRIPT, "jen", "cut.txt", "10"], {
      input: "new",
      encoding: "utf8",
      timeout: 30_000,
    });
    expect(cut.stdout).toBe("error the write was cut short: 3 of 10 bytes arrived\n");
    expect(await output("cat cut.txt; ls -a | grep -c jen-; true")).toBe("old\n0\n");
  });
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

// The stand-in provider: records every call, serves the record at GET
// /received, and answers each call with a completed response.
const STAND_IN = `
const received = [];
process.getBuiltinModule("node:http").createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    res.writeHead(200, { "content-type": "application/json" });
    if (req.method === "GET" && req.url === "/received") return res.end(JSON.stringify(received));
    received.push({ method: req.method, url: req.url, authorization: req.headers.authorization, body });
    res.end(JSON.stringify({ id: "resp_1", object: "response", created_at: 0, model: "stand-in", status: "completed", output: [] }));
  });
}).listen(8080);
`;

// A listener on the engine's host network, on every interface.
const HOST_LISTENER = `process.getBuiltinModule("node:net").createServer((socket) => socket.end("host\\n")).listen(Number(process.env.PORT));`;

// What a probe has besides its own code: connects(host, port), true once a
// TCP connection opens within 3 seconds, and callModel(body), the status of a
// model call to the runtime with the container's own token.
const PRELUDE = `
const net = process.getBuiltinModule("node:net");
const connects = (host, port) => new Promise((resolve) => {
  const socket = net.connect({ host, port, timeout: 3000 });
  const done = (reached) => (socket.destroy(), resolve(reached));
  socket.on("connect", () => done(true)).on("timeout", () => done(false)).on("error", () => done(false));
});
const callModel = async (body) => {
  const res = await fetch(process.env.JEN_RUNTIME_URL + "/model/responses", {
    method: "POST",
    headers: { authorization: "Bearer " + process.env.JEN_TOKEN, "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  await res.text();
  return res.status;
};
`;

// Runs a probe's body as an async function in a container, as root, and
// returns what it returns.
function runIn(container: string, body: string): any {
  const script = `${PRELUDE}\nconsole.log(JSON.stringify(await (async () => {${body}})()));`;
  const out = docker(["exec", "-u", "0", container, "node", "--input-type=module", "-e", script], { timeout: 60_000 }).trim();
  return JSON.parse(out.split("\n").at(-1)!);
}

const inAgent = (body: string) => runIn(agentContainer(), body);

// A request in the agent adapter's shape, naming a model of its own.
const modelCall = () => ({
  model: "agent-chosen-model",
  instructions: "be brief",
  input: [{ role: "user", content: "From: owner\n\nhi" }],
  tools: [],
  store: false,
});

// Every call the stand-in provider has received.
function received(): { method: string; url: string; authorization?: string; body: string }[] {
  return runIn(provider, `return await (await fetch("http://127.0.0.1:8080/received")).json()`);
}

// Every address the engine's host has now, read in its listener's container,
// so it includes the agents' network's bridge, which the runtime created after
// the listener started. Link-local IPv6 addresses need a scope to reach, so
// they're left out.
function hostAddresses(): string[] {
  return runIn(hostListener, `
    const os = process.getBuiltinModule("node:os");
    return Object.values(os.networkInterfaces()).flat().filter((a) => !a.address.startsWith("fe80:")).map((a) => a.address);
  `);
}

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
