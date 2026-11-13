// The tree of agents on one Docker engine. Docker holds the only record: each
// agent is a labelled volume, and each run of it is a container. The runtime
// keeps nothing of its own, so it can be restarted at any moment and read the
// tree back.
//
// An agent with the workspace grant also has a workspace: a volume of its own
// and a sandboxed container with no network, where the runtime runs the
// agent's commands and reads and writes its files. The workspace follows
// what's done to its agent: it's started before the agent and removed after
// it. It's labelled jen.workspace, not jen.agent, so nothing that reads the
// tree mistakes it for an agent.
//
// A caller is the owner (null) or an agent, named by its ID and the hash of
// the token it authenticated with. The owner is every agent's ancestor and has
// every capability; a root agent's parent is the owner. On the wire the
// owner's ID is "owner" and the runtime's is "runtime", which no agent has.

import { createHash, randomBytes } from "node:crypto";
import http from "node:http";
import net from "node:net";
import { DockerError, type Container, type Docker, type ExecEnd, type Sandbox } from "./docker.ts";

export type Caller = { id: string; credential: string } | null;

// What an agent may do: start sub-agents, and run commands in a workspace of
// its own. Each key is a capability, and a key that's missing means false.
export interface Grant {
  spawn: boolean;
  workspace: boolean;
}

const CAPABILITIES = ["spawn", "workspace"] as const satisfies readonly (keyof Grant)[];

export interface Agent {
  id: string;
  parent: string | null;
  grant: Grant;
  state: "running" | "stopped";
}

export interface RuntimeOptions {
  docker: Docker;
  // JEN_RUNTIME_NAME. Every label, volume, container and network carries it.
  name: string;
  // The agent image, run with its default command.
  image: string;
  // The workspace image, run with its default command.
  workspaceImage: string;
  model: { model: string; apiKey: string; baseURL?: string };
  maxDepth: number;
  maxAgents: number;
  // Where an agent's protocol is served, given its container's name.
  agentURL?: (container: string) => string;
  // Resolves once an agent at url accepts connections, and rejects if it
  // never does.
  ready?: (url: string) => Promise<void>;
  // Posts a message from the runtime to the agent at url, with its token.
  send?: (url: string, token: string, text: string) => Promise<void>;
}

// A command's outcome. exitCode is null when the command was killed by its
// timeout, and cut is set when the output was cut to its start and end.
export interface CommandResult {
  exitCode: number | null;
  output: string;
  timedOut: boolean;
  cut?: { bytes: number; file: string };
}

// Where to reach a running agent's protocol, and its current token.
export interface Address {
  url: string;
  token: string;
}

// A refusal or failure the API reports with status. agent names an agent a
// failed spawn left behind.
export class RuntimeError extends Error {
  readonly status: number;
  readonly agent?: string;
  constructor(status: number, message: string, agent?: string) {
    super(message);
    this.name = "RuntimeError";
    this.status = status;
    this.agent = agent;
  }
}

// The owner's grant: every capability.
const OWNER_GRANT: Grant = { spawn: true, workspace: true };
const MAX_RETRIES = 3;
// The address agents reach the runtime at, by its alias on their network.
const RUNTIME_URL = "http://runtime:8080";
const READY_MS = 30_000;
// How long a message from the runtime may take to be accepted. Notices are
// sent while holding the tree-operation queue, so one must never wait forever.
const SEND_MS = 10_000;
// A workspace's home directory, where its volume is mounted and every command
// starts, and what bounds it. These are fixed: no caller can change them.
const HOME = "/home/agent";
const SANDBOX: Sandbox = {
  user: "agent",
  tmp: { path: "/tmp", bytes: 512 * 2 ** 20 },
  shmBytes: 64 * 2 ** 20,
  memoryBytes: 2 * 2 ** 30,
  nanoCpus: 2e9,
  pids: 512,
};
// The longest a command may run, in seconds.
export const MAX_TIMEOUT = 600;
// Output within OUTPUT_CAP bytes is returned whole, and longer output is cut
// to its first OUTPUT_START and last OUTPUT_END bytes.
const OUTPUT_CAP = 8 * 1024;
const OUTPUT_START = 2 * 1024;
const OUTPUT_END = OUTPUT_CAP - OUTPUT_START;
// The most the runtime reads from a command's exec. The wrapper's own output
// is at most OUTPUT_CAP and two short lines, so only a command that writes
// around its output file comes near it.
const READ_BOUND = 16 * 1024;
// How long a command's report may take once its timeout has passed, and how
// long any kill may take.
const GRACE_MS = 5_000;
// How long a stream that ended without a report is given to show whether its
// workspace stopped: the stream can end before the engine says so.
const STOPPED_MS = 1_000;
// Runs each command, sent with every exec, so nothing in the workspace can
// change how commands run. Its arguments are the command, never spliced into
// the script, and the file its output goes to. It prints, in order:
// 1. its own PID and the process group the command runs in. The command's
//    shell prints this line before it starts the command, so it's the
//    wrapper's own: whatever follows may be the command's.
// 2. once the command's shell exits, its exit code and the output's size
// 3. the output, whole within OUTPUT_CAP, or else its start and end.
// set -m gives the command a process group of its own, which the runtime
// kills on a timeout or a hang-up. Output goes to a file, not the exec's
// stream, so a background process holds the file and not the call, and long
// output is kept whole. A file that's printed whole is deleted first.
const WRAPPER = `set -m
mkdir -p -- "\${2%/*}"
bash -c 'echo "$PPID $$"; exec bash -c "$1" </dev/null >"$2" 2>&1' jen "$1" "$2" &
wait -f $!
code=$?
size=$(stat -c %s -- "$2" 2>/dev/null) || { size=0; : >"$2"; }
if [ "$size" -le ${OUTPUT_CAP} ]; then
  exec 3<"$2"
  rm -f -- "$2"
  printf '%s %s\n' "$code" "$size"
  head -c "$size" <&3
else
  printf '%s %s\n' "$code" "$size"
  head -c ${OUTPUT_START} -- "$2"
  tail -c ${OUTPUT_END} -- "$2"
fi
`;
// The largest file the runtime reads or writes, in bytes. It holds a whole
// file in memory while it moves it, so this caps what any caller can make the
// shared runtime hold.
export const MAX_FILE = 16 * 2 ** 20;
// The most the runtime reads from a file operation's exec: the file, its
// status line and the stream's frame headers.
const FILE_READ_BOUND = MAX_FILE + 64 * 1024;
// How long a file operation may take. 16 MiB takes well under a second.
const FILE_MS = 30_000;
// The longest status line a file script prints, which holds a tool's error.
const STATUS_MAX = 4096;
// Each file script is sent with every exec, as the wrapper is, and its
// arguments are the path and a size, never spliced into it. It runs as agent
// in the home directory, so a file operation reaches exactly what a command
// can: a relative path is relative to the home, a symlink is followed, and the
// kernel decides what may be read or written. It prints a status line before
// anything else, and an error's message is the failing tool's own, its text
// after the last ": ", such as "Permission denied". LC_ALL=C keeps messages in
// English.
//
// The read script copies at most its bound plus one byte of the file into
// /tmp and measures the copy, since a pseudo-file's stat size is 0. It prints
// "ok <size>" and then exactly the copy's bytes, "missing", "large <size>", or
// "error <message>". The copy is deleted before it's sent, and held open.
export const READ_SCRIPT = `export LC_ALL=C
reason() { printf '%s' "\${1##*: }" | head -n 1; }
tmp=$(mktemp /tmp/.jen-read.XXXXXXXX 2>&1) || { printf 'error %s\\n' "$(reason "$tmp")"; exit 0; }
err=$(head -c $(($2 + 1)) -- "$1" 2>&1 >"$tmp")
if [ $? -ne 0 ]; then
  rm -f -- "$tmp"
  err=$(reason "$err")
  if [ "$err" = "No such file or directory" ]; then echo missing; else printf 'error %s\\n' "$err"; fi
  exit 0
fi
size=$(stat -c %s -- "$tmp")
if [ "$size" -gt "$2" ]; then
  rm -f -- "$tmp"
  real=$(stat -L -c %s -- "$1" 2>/dev/null) || real=$size
  [ "$real" -gt "$size" ] || real=$size
  printf 'large %s\\n' "$real"
  exit 0
fi
exec 3<"$tmp"
rm -f -- "$tmp"
printf 'ok %s\\n' "$size"
cat <&3
`;
// The write script resolves the path through symlinks, as a redirect would
// follow them, creates its folders, and refuses a folder and an existing file
// it can't write: a rename needs only the folder to be writable, so without
// that check a write would replace a read-only file. It reads exactly the
// declared size from stdin into a temporary file beside the target, and
// deletes it if fewer bytes arrived, as when the caller hangs up. Otherwise
// it gives the temporary file the target's mode, or a new file's, and renames
// it over the target, which within one folder is atomic: a reader sees the
// old file or the new one, never part of one. It prints "ok" or
// "error <message>".
export const WRITE_SCRIPT = `export LC_ALL=C
tmp=
reason() { printf '%s' "\${1##*: }" | head -n 1; }
fail() { [ -z "$tmp" ] || rm -f -- "$tmp"; printf 'error %s\\n' "$1"; exit 0; }
target=$(realpath -m -- "$1" 2>&1) || fail "$(reason "$target")"
[ -d "$target" ] && fail "Is a directory"
dir=\${target%/*}
name=\${target##*/}
err=$(mkdir -p -- "\${dir:-/}" 2>&1) || fail "$(reason "$err")"
if [ -e "$target" ]; then
  err=$( { : >>"$target"; } 2>&1) || fail "$(reason "$err")"
fi
tmp=$(mktemp -- "$dir/.$name.jen-XXXXXXXX" 2>&1) || { err=$tmp; tmp=; fail "$(reason "$err")"; }
err=$(head -c "$2" 2>&1 >"$tmp") || fail "$(reason "$err")"
got=$(stat -c %s -- "$tmp")
[ "$got" = "$2" ] || fail "the write was cut short: $got of $2 bytes arrived"
if [ -e "$target" ]; then
  err=$(chmod --reference="$target" -- "$tmp" 2>&1) || fail "$(reason "$err")"
else
  chmod "$(printf '%o' $((0666 & ~$(umask))))" -- "$tmp"
fi
err=$(mv -fT -- "$tmp" "$target" 2>&1) || fail "$(reason "$err")"
echo ok
`;
// IDs that name the owner and the runtime. Agent IDs are 12 hex characters,
// so neither can collide, and no route reaches either.
const RESERVED = new Set(["owner", "runtime"]);

interface Node {
  id: string;
  parent: string | null;
  grant: Grant;
  container?: Container;
}

// A container is alive while it runs, or while the engine restarts it after
// a crash. Any other state is left over and counts as stopped.
export const alive = (state: string) => state === "running" || state === "restarting";

export class Runtime {
  readonly #o: Required<RuntimeOptions>;
  // Tree operations run one at a time, in order.
  #queue: Promise<unknown> = Promise.resolve();

  constructor(options: RuntimeOptions) {
    this.#o = {
      agentURL: (container) => `http://${container}:8080`,
      ready: (url) => waitForConnection(url),
      send: postMessage,
      ...options,
    };
  }

  // Claims the runtime's name, joins its network, and repairs what a crash
  // left behind. hostname is the runtime's own container's ID.
  startup(hostname: string): Promise<void> {
    return this.#serial(async () => {
      const { docker, name } = this.#o;
      const self = await docker.inspectContainer(hostname);
      if (!self) throw new Error(`the runtime must run in a container, and none has the ID ${hostname}`);

      // Container names are unique on an engine, so holding this one is the lock.
      const claim = `${name}-runtime`;
      if (self.name !== claim) {
        const holder = await docker.inspectContainer(claim);
        if (holder && alive(holder.state)) {
          throw new Error(`another runtime named ${name} is running, in container ${holder.id.slice(0, 12)}`);
        }
        if (holder) await docker.removeContainer(holder.id);
        try {
          await docker.renameContainer(self.id, claim);
        } catch (error) {
          if (error instanceof DockerError && error.status === 409) throw new Error(`another runtime named ${name} claimed the name first`);
          throw error;
        }
      }

      if (!(await docker.inspectNetwork(name))) {
        try {
          await docker.createNetwork(name, { "jen.runtime": name });
        } catch (error) {
          if (!(error instanceof DockerError && error.status === 409)) throw error;
        }
      }
      if (!self.networks.includes(name)) await docker.connectNetwork(name, self.id, ["runtime"]);

      const { nodes, containers } = await this.#read();
      for (const c of containers) {
        if (!alive(c.state) || !nodes.has(c.labels["jen.agent"])) await docker.removeContainer(c.id);
      }
      // Detached: an agent whose parent is gone. Its subtree goes with it.
      for (const node of nodes.values()) {
        if (node.parent !== null && !nodes.has(node.parent) && nodes.has(node.id)) {
          for (const gone of subtree(nodes, node.id)) {
            await this.#remove(gone);
            nodes.delete(gone.id);
          }
        }
      }
      // A workspace is left running only beside its running agent, and kept
      // only while its agent exists.
      const workspaces = [`jen.runtime=${name}`, "jen.workspace"];
      for (const c of await docker.listContainers(workspaces)) {
        const node = nodes.get(c.labels["jen.workspace"]);
        if (!node || !running(node) || !node.grant.workspace || c.name !== this.#workspace(node.id)) await docker.removeContainer(c.id);
      }
      for (const v of await docker.listVolumes(workspaces)) {
        if (!nodes.has(v.labels["jen.workspace"])) await docker.removeVolume(v.name);
      }
    });
  }

  // The running agent whose current token is token, or undefined.
  async identify(token: string): Promise<Caller | undefined> {
    const credential = sha256(token);
    const { nodes } = await this.#read();
    for (const node of nodes.values()) {
      if (current(node, credential)) return { id: node.id, credential };
    }
    return undefined;
  }

  // grant may leave a capability out, which means false.
  spawn(caller: Caller, requested: Partial<Grant>): Promise<Agent> {
    const grant = fullGrant(requested);
    return this.#serial(async () => {
      const { nodes } = await this.#read();
      const parentId = authorize(nodes, caller);
      let parentGrant = OWNER_GRANT;
      let depth = 1;
      if (parentId !== null) {
        const parent = nodes.get(parentId)!;
        parentGrant = parent.grant;
        depth = depthOf(nodes, parent) + 1;
      }
      if (!parentGrant.spawn) throw new RuntimeError(403, "the caller may not spawn");
      for (const key of CAPABILITIES) {
        if (grant[key] && !parentGrant[key]) throw new RuntimeError(403, `the grant exceeds the caller's: ${key}`);
      }
      if (depth > this.#o.maxDepth) throw new RuntimeError(403, `the agent would be deeper than ${this.#o.maxDepth}`);
      if (nodes.size >= this.#o.maxAgents) throw new RuntimeError(403, `the runtime already holds ${this.#o.maxAgents} agents`);

      const node: Node = { id: randomBytes(6).toString("hex"), parent: parentId, grant };
      try {
        await this.#o.docker.createVolume(this.#resource(node.id), {
          "jen.runtime": this.#o.name,
          "jen.agent": node.id,
          "jen.parent": node.parent ?? "",
          "jen.grant": JSON.stringify(node.grant),
        });
        if (node.grant.workspace) {
          await this.#o.docker.createVolume(this.#workspace(node.id), { "jen.runtime": this.#o.name, "jen.workspace": node.id });
          await this.#runWorkspace(node);
        }
        await this.#run(node);
      } catch (error) {
        // The step may have happened even if it reported failure, so undo
        // everything by name.
        try {
          await this.#remove(node);
        } catch {
          throw new RuntimeError(500, `spawning failed (${message(error)}), and agent ${node.id} is left stopped or running`, node.id);
        }
        throw new RuntimeError(500, `spawning failed: ${message(error)}`);
      }
      return describe(node, "running");
    });
  }

  // The caller's descendants.
  async list(caller: Caller): Promise<Agent[]> {
    const { nodes } = await this.#read();
    const by = authorize(nodes, caller);
    return [...nodes.values()].filter((node) => reaches(nodes, by, node.id)).map((node) => describe(node));
  }

  async get(caller: Caller, id: string): Promise<Agent> {
    const { nodes } = await this.#read();
    return describe(reach(nodes, caller, id));
  }

  // Stops the agent and everything under it, deepest first, keeping state
  // and workspaces' files.
  stop(caller: Caller, id: string): Promise<Agent> {
    return this.#serial(async () => {
      const { nodes } = await this.#read();
      const target = reach(nodes, caller, id);
      for (const node of subtree(nodes, id)) await this.#halt(node);
      return describe(target, "stopped");
    });
  }

  // Starts a stopped agent from its state. Its descendants are left as they
  // are, and an agent with stopped children is told so, as its only message.
  start(caller: Caller, id: string): Promise<Agent> {
    return this.#serial(async () => {
      const { nodes } = await this.#read();
      const target = reach(nodes, caller, id);
      if (running(target)) return describe(target);
      const notice = stoppedChildren(nodes, id);
      await this.#start(target, notice !== undefined);
      // The agent is running either way. One that never gets its notice
      // stays held until its next message.
      if (notice !== undefined) {
        await this.#notify(id, notice).catch((error) => process.stderr.write(`jen-runtime: agent ${id} wasn't sent its notice: ${message(error)}\n`));
      }
      return describe(target, "running");
    });
  }

  // Deletes the agent and everything under it, deepest first, with their state.
  delete(caller: Caller, id: string): Promise<void> {
    return this.#serial(async () => {
      const { nodes } = await this.#read();
      reach(nodes, caller, id);
      for (const node of subtree(nodes, id)) await this.#remove(node);
    });
  }

  // Runs command in the caller's own workspace, with timeout in seconds, and
  // answers once its shell exits. It runs outside the queue, since it can take
  // minutes. signal is the caller hanging up, which kills the command.
  //
  // The wrapper and the command run as the same user, so the command can write
  // to the exec's stream directly, forge the wrapper's report, stop the
  // wrapper or hold the stream open. None of that bounds the runtime: it reads
  // at most READ_BOUND bytes, answers within timeout plus GRACE_MS, trusts only
  // the first line, and answers as soon as a report parses.
  async runCommand(caller: Caller, command: string, timeout: number, signal: AbortSignal): Promise<CommandResult> {
    const { container, stopped } = await this.#callerWorkspace(caller, () => {
      if (!(timeout >= 1 && timeout <= MAX_TIMEOUT)) throw new RuntimeError(400, `timeout must be from 1 to ${MAX_TIMEOUT} seconds`);
    });
    const file = `${HOME}/.jen/output/${randomBytes(8).toString("hex")}.log`;
    const { docker } = this.#o;
    // Kills the given processes, or process groups by their negated ID, and
    // ignores a failure: the workspace may be gone, and so are they.
    const kill = (targets: number[]) =>
      docker
        .exec(container, { user: SANDBOX.user, workdir: HOME, cmd: ["kill", "-KILL", "--", ...targets.map(String)] }, { bound: 1024, signal: AbortSignal.timeout(GRACE_MS), onOutput: () => {} })
        .catch(() => undefined);

    return new Promise<CommandResult>((resolve, reject) => {
      const stream = new AbortController();
      let received: Buffer = Buffer.alloc(0);
      let head: Head | undefined;
      let timedOut = false;
      let hungUp = false;
      let settled = false;
      const timers: NodeJS.Timeout[] = [];

      // Settles once: closes the stream, then, after killing before if given,
      // answers with outcome. A call answered before the first line came, by
      // its timeout or a hang-up, would leave its command running, so the
      // stream stays open a while longer for the line, and its group is
      // killed if it comes.
      const settle = (outcome: CommandResult | RuntimeError, before?: number[]) => {
        if (settled) return;
        settled = true;
        for (const timer of timers) clearTimeout(timer);
        signal.removeEventListener("abort", hangUp);
        if (head || !(timedOut || hungUp)) stream.abort();
        else setTimeout(() => stream.abort(), GRACE_MS);
        void (before ? kill(before) : Promise.resolve()).then(() => (outcome instanceof RuntimeError ? reject(outcome) : resolve(outcome)));
      };
      const wroteAround = () => new RuntimeError(502, "the command wrote around its output file, so its output couldn't be read");
      const group = () => (head ? [-head.group] : undefined);

      const onOutput = (chunk: Buffer) => {
        if (settled && head) return;
        received = Buffer.concat([received, chunk]);
        if (!head) {
          const parsed = parseHead(received);
          if (parsed === "partial") return;
          if (parsed === "malformed") return settled ? stream.abort() : settle(wroteAround());
          head = parsed;
          // The call was already answered without it, so only the kill is left.
          if (settled) return void kill([-head.group, head.wrapper]).then(() => stream.abort());
          if (hungUp) return settle(new RuntimeError(499, "the caller hung up"), group());
          if (timedOut) void kill([-head.group]);
        }
        const report = parseReport(received.subarray(head.length), file);
        if (report === "partial") return;
        if (report === "malformed") return settle(wroteAround(), group());
        // A report that came after the timeout killed the command.
        settle(timedOut ? { ...report, exitCode: null, timedOut: true } : report);
      };

      const hangUp = () => {
        hungUp = true;
        // Without the first line there's no group to kill yet, so the line is
        // awaited, though no longer than the grace.
        if (head) settle(new RuntimeError(499, "the caller hung up"), group());
        else timers.push(setTimeout(() => settle(new RuntimeError(499, "the caller hung up")), GRACE_MS));
      };
      if (signal.aborted) return reject(new RuntimeError(499, "the caller hung up"));
      signal.addEventListener("abort", hangUp, { once: true });

      timers.push(
        setTimeout(() => {
          timedOut = true;
          if (head) void kill([-head.group]);
          // A report that doesn't come in time means the wrapper itself was
          // stopped, so it's killed too, and nothing it said is used.
          timers.push(
            setTimeout(() => {
              const wrapper = head?.wrapper;
              settle({ exitCode: null, output: "", timedOut: true });
              if (wrapper !== undefined) void kill([wrapper]);
            }, GRACE_MS),
          );
        }, timeout * 1000),
      );

      docker
        .exec(container, { user: SANDBOX.user, workdir: HOME, cmd: ["bash", "-c", WRAPPER, "jen", command, file] }, { bound: READ_BOUND, signal: stream.signal, onOutput })
        .then(
          async (end: ExecEnd) => {
            if (settled) return;
            if (end === "bound") return settle(wroteAround(), group());
            if (timedOut) return settle({ exitCode: null, output: "", timedOut: true });
            if (await stopped()) settle(new RuntimeError(409, "the workspace stopped during the command"));
            else settle(new RuntimeError(502, "the command's output ended before its report"), group());
          },
          (error) => settle(execFailed(error, "the command couldn't be run")),
        );
    });
  }

  // The bytes of the file at path in the caller's own workspace, read as the
  // agent, as a command would read it. Like a command, it runs outside the
  // queue, and signal is the caller hanging up.
  async readFile(caller: Caller, path: string, signal: AbortSignal): Promise<Buffer> {
    const content = await this.#fileOp(caller, "read", [READ_SCRIPT, "jen", path, String(MAX_FILE)], undefined, signal, (status) => {
      if (status === "missing") throw new RuntimeError(404, `no file at ${path}`);
      if (/^large \d{1,15}$/.test(status)) throw new RuntimeError(413, `the file is ${status.slice(6)} bytes, over the ${MAX_FILE}-byte limit`);
      if (status.startsWith("error ")) throw new RuntimeError(400, status.slice(6));
      const ok = /^ok (\d{1,9})$/.exec(status);
      if (!ok || Number(ok[1]) > MAX_FILE) throw malformed();
      return Number(ok[1]);
    });
    return content!;
  }

  // Writes bytes as the whole file at path in the caller's own workspace, as
  // the agent, creating its folders. The file is replaced only once every
  // byte has arrived. Like a command, it runs outside the queue.
  async writeFile(caller: Caller, path: string, bytes: Buffer, signal: AbortSignal): Promise<void> {
    if (bytes.length > MAX_FILE) throw new RuntimeError(413, `the file is larger than ${MAX_FILE} bytes`);
    await this.#fileOp(caller, "write", [WRITE_SCRIPT, "jen", path, String(bytes.length)], bytes, signal, (status) => {
      if (status === "ok") return "done";
      if (status.startsWith("error ")) throw new RuntimeError(400, status.slice(6));
      throw malformed();
    });
  }

  // Runs a file script in the caller's workspace with args, and reads its
  // status line with parse, which throws a refusal, answers "done", or gives
  // the size of the content that follows, which is then the answer. It reads
  // at most FILE_READ_BOUND bytes and answers within FILE_MS, whatever the
  // workspace does, and trusts nothing from the stream that it enforces: any
  // process in the workspace can write to it.
  async #fileOp(
    caller: Caller,
    action: "read" | "write",
    args: string[],
    input: Buffer | undefined,
    signal: AbortSignal,
    parse: (status: string) => "done" | number,
  ): Promise<Buffer | undefined> {
    const { container, stopped } = await this.#callerWorkspace(caller);
    const { docker } = this.#o;
    return new Promise<Buffer | undefined>((resolve, reject) => {
      const stream = new AbortController();
      // Before the status line, what's arrived; after it, the content.
      let head: Buffer = Buffer.alloc(0);
      let size: number | undefined;
      const content: Buffer[] = [];
      let received = 0;
      let settled = false;
      const settle = (outcome: Buffer | undefined | RuntimeError) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener("abort", hangUp);
        stream.abort();
        if (outcome instanceof RuntimeError) reject(outcome);
        else resolve(outcome);
      };
      const more = (chunk: Buffer) => {
        received += chunk.length;
        content.push(chunk);
        if (received > size!) settle(new RuntimeError(502, `the workspace sent more than the ${size}-byte file it reported`));
      };
      const onOutput = (chunk: Buffer) => {
        if (settled) return;
        if (size !== undefined) return more(chunk);
        head = Buffer.concat([head, chunk]);
        const newline = head.subarray(0, STATUS_MAX + 1).indexOf(10);
        if (newline < 0) return void (head.length > STATUS_MAX && settle(malformed()));
        let parsed: "done" | number;
        try {
          parsed = parse(head.subarray(0, newline).toString("utf8"));
        } catch (error) {
          return settle(error instanceof RuntimeError ? error : malformed());
        }
        if (parsed === "done") return settle(undefined);
        size = parsed;
        more(head.subarray(newline + 1));
      };
      const hangUp = () => settle(new RuntimeError(499, "the caller hung up"));
      const timer = setTimeout(() => settle(new RuntimeError(502, `the workspace didn't finish the ${action} within ${FILE_MS / 1000} seconds`)), FILE_MS);
      if (signal.aborted) return hangUp();
      signal.addEventListener("abort", hangUp, { once: true });
      docker
        .exec(container, { user: SANDBOX.user, workdir: HOME, cmd: ["bash", "-c", ...args], ...(input === undefined ? {} : { input }) }, { bound: FILE_READ_BOUND, signal: stream.signal, onOutput })
        .then(
          async (end: ExecEnd) => {
            if (settled) return;
            if (end === "bound") return settle(new RuntimeError(502, `the workspace sent more than the ${action} could hold`));
            if (size !== undefined && received === size) return settle(Buffer.concat(content));
            if (await stopped()) settle(new RuntimeError(409, `the workspace stopped during the ${action}`));
            else if (size !== undefined) settle(new RuntimeError(502, `the workspace sent ${received} bytes of the ${size}-byte file it reported`));
            else settle(new RuntimeError(502, `the workspace's answer to the ${action} ended before its status`));
          },
          (error) => settle(execFailed(error, `the ${action} couldn't be run`)),
        );
    });
  }

  // The caller's own workspace container, refusing the owner, which has none,
  // and an agent without the grant, then check, then a workspace that isn't
  // running. stopped tells whether the workspace has since stopped, been
  // replaced or restarted, waiting up to STOPPED_MS for the engine to say so.
  async #callerWorkspace(caller: Caller, check?: () => void): Promise<{ container: string; stopped: () => Promise<boolean> }> {
    if (caller === null) throw new RuntimeError(404, "the owner has no workspace");
    const { nodes } = await this.#read();
    const node = nodes.get(authorize(nodes, caller)!)!;
    if (!node.grant.workspace) throw new RuntimeError(403, "the caller has no workspace");
    check?.();
    const container = this.#workspace(node.id);
    const { docker } = this.#o;
    const before = await docker.inspectContainer(container);
    if (!before || before.state !== "running") throw new RuntimeError(409, "the workspace isn't running");
    const stopped = async () => {
      for (const deadline = Date.now() + STOPPED_MS; ; ) {
        const now = await docker.inspectContainer(container).catch(() => undefined);
        if (!now || now.id !== before.id || now.state !== "running" || now.startedAt !== before.startedAt) return true;
        if (Date.now() >= deadline) return false;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    };
    return { container, stopped };
  }

  // Where to relay to a running agent the caller can reach, and its current token.
  async target(caller: Caller, id: string): Promise<Address> {
    const { nodes } = await this.#read();
    const node = reach(nodes, caller, id);
    if (!running(node)) throw new RuntimeError(409, `agent ${id} is stopped`);
    return this.#address(id);
  }

  // Where to relay a message to an agent the caller may message: a descendant
  // or its parent. A stopped one is started first, holding its loop until the
  // message arrives, and notice is what the runtime sends it after the message.
  async messageTarget(caller: Caller, id: string): Promise<Address & { notice?: string }> {
    const { nodes } = await this.#read();
    if (running(reachMessage(nodes, caller, id))) return this.#address(id);
    return this.#serial(async () => {
      const { nodes } = await this.#read();
      const target = reachMessage(nodes, caller, id);
      if (running(target)) return this.#address(id);
      await this.#start(target, true);
      return { ...(await this.#address(id)), notice: stoppedChildren(nodes, id) };
    });
  }

  // Sends text from the runtime to the agent at address.
  notify(address: Address, text: string): Promise<void> {
    return this.#o.send(address.url, address.token, text);
  }

  // Watches the engine for agents whose process exits and won't be restarted,
  // and tells each one's parent. Returns a function that stops watching.
  watch(onError: (error: unknown) => void = () => {}): () => void {
    return this.#o.docker.watchExits([`jen.runtime=${this.#o.name}`, "jen.agent"], (container) => {
      this.#exited(container).catch(onError);
    });
  }

  // Checked inside the queue, against the tree it acts on: an operation queued
  // ahead of it may have stopped, deleted or replaced the container.
  #exited(container: string) {
    return this.#serial(async () => {
      const details = await this.#o.docker.inspectContainer(container);
      // A container being restarted, or removed by the runtime, isn't reported.
      if (!details || details.state !== "exited") return;
      const id = details.labels["jen.agent"];
      const { nodes } = await this.#read();
      const node = nodes.get(id);
      // Only the agent's current container counts, not one since replaced.
      if (!node || node.container?.id !== details.id) return;
      // The agent counts as stopped now, and so its workspace stops too.
      if (node.grant.workspace) await this.#o.docker.removeContainer(this.#workspace(node.id));
      const parent = nodes.get(node.parent ?? "");
      // A root's parent is the owner, who sees it as stopped.
      if (!parent) return;
      const woken = !running(parent);
      if (woken) await this.#start(parent, true);
      await this.#notify(parent.id, `Your sub-agent ${id} stopped: its process kept exiting and its restarts ran out. Message it to start it again.`);
      const notice = woken ? stoppedChildren(nodes, parent.id) : undefined;
      if (notice !== undefined) await this.#notify(parent.id, notice);
    });
  }

  // Starts a stopped agent's container, and on failure leaves it stopped. A
  // start with messages to deliver holds the agent until the first arrives.
  async #start(node: Node, wake: boolean) {
    // Whatever is left over, such as containers the engine gave up restarting.
    await this.#halt(node);
    try {
      if (node.grant.workspace) await this.#runWorkspace(node);
      await this.#run(node, wake ? randomBytes(16).toString("hex") : undefined);
    } catch (error) {
      await this.#halt(node);
      throw new RuntimeError(500, `starting failed: ${message(error)}`);
    }
  }

  async #notify(id: string, text: string) {
    await this.notify(await this.#address(id), text);
  }

  async #address(id: string): Promise<Address> {
    const details = await this.#o.docker.inspectContainer(this.#resource(id));
    const token = details?.env.find((e) => e.startsWith("JEN_TOKEN="))?.slice("JEN_TOKEN=".length);
    if (!details || !alive(details.state) || !token) throw new RuntimeError(409, `agent ${id} is stopped`);
    return { url: this.#o.agentURL(details.name), token };
  }

  // Creates and starts a new container for the agent, with a new token, and
  // waits until the agent accepts connections.
  async #run(node: Node, wake?: string) {
    const { docker, name, image, model } = this.#o;
    const token = randomBytes(32).toString("hex");
    const resource = this.#resource(node.id);
    await docker.createContainer(resource, {
      image,
      env: [
        `JEN_MODEL=${model.model}`,
        `JEN_API_KEY=${model.apiKey}`,
        ...(model.baseURL ? [`JEN_BASE_URL=${model.baseURL}`] : []),
        `JEN_TOKEN=${token}`,
        `JEN_RUNTIME_URL=${RUNTIME_URL}`,
        `JEN_AGENT_ID=${node.id}`,
        `JEN_PARENT=${node.parent ?? "owner"}`,
        `JEN_GRANT=${JSON.stringify(node.grant)}`,
        ...(wake ? [`JEN_WAKE=${wake}`] : []),
      ],
      labels: { "jen.runtime": name, "jen.agent": node.id, "jen.credential": sha256(token) },
      volume: { name: resource, path: "/state" },
      network: name,
      restart: { maxRetries: MAX_RETRIES },
    });
    await docker.startContainer(resource);
    await this.#o.ready(this.#o.agentURL(resource));
  }

  // Creates and starts a new workspace container for the agent, on its
  // workspace volume, with the fixed sandbox and no network.
  async #runWorkspace(node: Node) {
    const { docker, name, workspaceImage } = this.#o;
    const resource = this.#workspace(node.id);
    await docker.createContainer(resource, {
      image: workspaceImage,
      env: [],
      labels: { "jen.runtime": name, "jen.workspace": node.id },
      volume: { name: resource, path: HOME },
      network: "none",
      // A workspace whose first process dies comes back with its files.
      restart: "unless-stopped",
      sandbox: SANDBOX,
    });
    await docker.startContainer(resource);
  }

  // Removes an agent's container, then its workspace's, keeping both volumes.
  async #halt(node: Node) {
    await this.#o.docker.removeContainer(this.#resource(node.id));
    if (node.grant.workspace) await this.#o.docker.removeContainer(this.#workspace(node.id));
  }

  // Removes an agent's containers, then its workspace volume, and its own
  // volume, its record, last. Each step succeeds when there's nothing to
  // remove, so an interrupted removal can be repeated and still finds the agent.
  async #remove(node: Node) {
    await this.#halt(node);
    if (node.grant.workspace) await this.#o.docker.removeVolume(this.#workspace(node.id));
    await this.#o.docker.removeVolume(this.#resource(node.id));
  }

  // The tree as the engine has it: every agent, with its container if it has
  // one, and every agent container, including ones with no agent.
  async #read(): Promise<{ nodes: Map<string, Node>; containers: Container[] }> {
    const labels = [`jen.runtime=${this.#o.name}`, "jen.agent"];
    const [volumes, containers] = await Promise.all([this.#o.docker.listVolumes(labels), this.#o.docker.listContainers(labels)]);
    const nodes = new Map<string, Node>();
    for (const v of volumes) {
      const id = v.labels["jen.agent"];
      if (v.name !== this.#resource(id)) continue;
      nodes.set(id, { id, parent: v.labels["jen.parent"] || null, grant: parseGrant(v.labels["jen.grant"]) });
    }
    for (const c of containers) {
      const node = nodes.get(c.labels["jen.agent"]);
      if (node && c.name === this.#resource(node.id)) node.container = c;
    }
    return { nodes, containers };
  }

  // An agent's volume and container share this name.
  #resource(id: string) {
    return `${this.#o.name}-agent-${id}`;
  }

  // And its workspace's volume and container share this one.
  #workspace(id: string) {
    return `${this.#o.name}-workspace-${id}`;
  }

  #serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#queue.then(operation);
    this.#queue = result.catch(() => {});
    return result;
  }
}

// The wrapper's first line: its own PID, the command's process group, and the
// line's length in bytes.
interface Head {
  wrapper: number;
  group: number;
  length: number;
}

// The wrapper's first line, once it has arrived whole.
function parseHead(received: Buffer): Head | "partial" | "malformed" {
  const text = received.subarray(0, 32).toString("latin1");
  const line = /^(\d{1,10}) (\d{1,10})\n/.exec(text);
  if (line) return { wrapper: Number(line[1]), group: Number(line[2]), length: line[0].length };
  return /^\d{0,10}( \d{0,10})?$/.test(text) && received.length < 32 ? "partial" : "malformed";
}

// The report that follows the first line: the exit code and the output's
// size, then the output, whole within OUTPUT_CAP or else its start and end.
// Anything after it is ignored. file is where a cut output was kept.
function parseReport(received: Buffer, file: string): CommandResult | "partial" | "malformed" {
  const text = received.subarray(0, 32).toString("latin1");
  const line = /^(\d{1,3}) (\d{1,15})\n/.exec(text);
  if (!line) return /^\d{0,3}( \d{0,15})?$/.test(text) && received.length < 32 ? "partial" : "malformed";
  const exitCode = Number(line[1]);
  const bytes = Number(line[2]);
  const output = received.subarray(line[0].length);
  if (bytes <= OUTPUT_CAP) {
    if (output.length < bytes) return "partial";
    return { exitCode, output: output.subarray(0, bytes).toString("utf8"), timedOut: false };
  }
  if (output.length < OUTPUT_CAP) return "partial";
  // A character split by the cut decodes as a replacement character.
  const start = output.subarray(0, OUTPUT_START).toString("utf8");
  const end = output.subarray(OUTPUT_START, OUTPUT_CAP).toString("utf8");
  return { exitCode, output: start + end, timedOut: false, cut: { bytes, file } };
}

// Connects to url's host and port every 100 ms until one connection succeeds,
// for at most timeoutMs. A name that doesn't resolve yet counts as refused.
export async function waitForConnection(url: string, timeoutMs = READY_MS): Promise<void> {
  const { hostname, port } = new URL(url);
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const socket = net.connect({ host: hostname, port: Number(port) });
    socket.setTimeout(1_000);
    const connected = await new Promise<boolean>((resolve) => {
      socket.once("connect", () => resolve(true));
      socket.once("error", () => resolve(false));
      socket.once("timeout", () => resolve(false));
    });
    socket.destroy();
    if (connected) return;
    if (Date.now() >= deadline) throw new Error(`the agent didn't accept connections within ${timeoutMs / 1000} seconds`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

function describe(node: Node, state?: Agent["state"]): Agent {
  return {
    id: node.id,
    parent: node.parent,
    grant: { ...node.grant },
    state: state ?? (running(node) ? "running" : "stopped"),
  };
}

// Whether id is a strict descendant of caller.
function reaches(nodes: Map<string, Node>, caller: string | null, id: string): boolean {
  let parent = nodes.get(id)?.parent;
  if (parent === undefined) return false;
  if (caller === null) return true;
  while (parent !== null) {
    if (parent === caller) return true;
    const next = nodes.get(parent);
    if (!next) return false;
    parent = next.parent;
  }
  return false;
}

// The caller's ID, if its token is still current in this read of the tree: an
// agent stopped or restarted since it authenticated has no authority left.
// Every operation checks this against the tree it acts on, after any wait in
// the queue or for a request body.
function authorize(nodes: Map<string, Node>, caller: Caller): string | null {
  if (caller === null) return null;
  const node = nodes.get(caller.id);
  if (!node || !current(node, caller.credential)) throw new RuntimeError(401, "the caller's token is no longer current");
  return node.id;
}

// Whether the node is running with the token whose hash is credential.
function current(node: Node, credential: string): boolean {
  return !!node.container && alive(node.container.state) && node.container.labels["jen.credential"] === credential;
}

// The node, if the caller may act on it. Anything else is not found, so a
// caller can't probe for agents outside its subtree.
function reach(nodes: Map<string, Node>, caller: Caller, id: string): Node {
  if (RESERVED.has(id) || !reaches(nodes, authorize(nodes, caller), id)) throw new RuntimeError(404, `no agent ${id}`);
  return nodes.get(id)!;
}

// The node, if the caller may message it: a descendant, or its parent.
function reachMessage(nodes: Map<string, Node>, caller: Caller, id: string): Node {
  const by = authorize(nodes, caller);
  if (by !== null && !RESERVED.has(id) && nodes.get(by)!.parent === id && nodes.has(id)) return nodes.get(id)!;
  return reach(nodes, caller, id);
}

const running = (node: Node) => !!node.container && alive(node.container.state);

// The notice for an agent started while its sub-agents are stopped, or
// undefined when none is.
function stoppedChildren(nodes: Map<string, Node>, id: string): string | undefined {
  const stopped = [...nodes.values()].filter((n) => n.parent === id && !running(n)).map((n) => n.id);
  if (stopped.length === 0) return undefined;
  return `You were stopped and have been started again. Your sub-agents ${stopped.join(", ")} are still stopped. Messaging one starts it.`;
}

// Posts text to the agent at url as a message from the runtime, failing if
// the agent hasn't accepted it within timeoutMs.
export function postMessage(url: string, token: string, text: string, timeoutMs = SEND_MS): Promise<void> {
  const body = JSON.stringify({ text });
  return new Promise((resolve, reject) => {
    const req = http.request(new URL("/messages", url), {
      method: "POST",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { authorization: `Bearer ${token}`, "jen-from": "runtime", "content-type": "application/json", "content-length": Buffer.byteLength(body) },
    });
    req.on("response", (res) => {
      res.resume();
      const status = res.statusCode ?? 0;
      if (status >= 200 && status < 300) resolve();
      else reject(new Error(`the agent answered ${status}`));
    });
    req.on("error", reject);
    req.end(body);
  });
}

function depthOf(nodes: Map<string, Node>, node: Node): number {
  let depth = 1;
  for (let p = node.parent; p !== null; p = nodes.get(p)?.parent ?? null) depth++;
  return depth;
}

// The agent and its descendants, deepest first, so that whatever remains
// after an interruption still has its parent.
function subtree(nodes: Map<string, Node>, id: string): Node[] {
  const root = nodes.get(id)!;
  const found = [root, ...[...nodes.values()].filter((n) => reaches(nodes, id, n.id))];
  return found.sort((a, b) => depthOf(nodes, b) - depthOf(nodes, a));
}

// Every capability, with only a true value granting it.
function fullGrant(grant: Partial<Record<keyof Grant, unknown>>): Grant {
  return { spawn: grant.spawn === true, workspace: grant.workspace === true };
}

// A grant stored before a capability existed reads that capability as false.
function parseGrant(label: string | undefined): Grant {
  try {
    const stored = JSON.parse(label ?? "{}");
    return fullGrant(typeof stored === "object" && stored !== null ? stored : {});
  } catch {
    return fullGrant({});
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// A status line the runtime can't read: something in the workspace wrote to
// the stream.
function malformed(): RuntimeError {
  return new RuntimeError(502, "the workspace's answer couldn't be read");
}

// An exec the engine refused: a workspace that's gone or stopped is 409, as
// for any call to it, and anything else is the engine failing.
function execFailed(error: unknown, what: string): RuntimeError {
  if (error instanceof DockerError && (error.status === 404 || error.status === 409)) return new RuntimeError(409, "the workspace isn't running");
  return new RuntimeError(502, `${what}: ${message(error)}`);
}
