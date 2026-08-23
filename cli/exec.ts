/**
 * The executor: a run request in, a finished stage session out.
 *
 * Everything that touches the world lives here — the run's directory, the clone, the trust
 * entry, the credential, the child process, and the signal. It is deliberately *not* in
 * `run.ts`: the tick's writes-nothing property is held by a source-level guard in
 * `test/dispatch.test.ts`, and that guard keeps meaning what it means only while nothing on
 * the decision path can reach a module that writes. `tick()` takes a launcher as a parameter
 * rather than importing one, so the guard passes unmodified. See `cli/AGENTS.md`.
 *
 * No judgment happens here. The request was decided by the tick and is taken as decided:
 * the skill it names is the skill that runs, the role it names is the identity it runs
 * under, and a status that changed since the decision changes nothing. `stage-execution`
 * states this as a requirement, and the reason is that two runners must not be able to reach
 * different conclusions from the same request.
 *
 * Nothing here writes to the tracker — not for a session that failed, and not for one that
 * was terminated. Every tracker write in the pipeline belongs to a stage session, which is
 * what makes a dead session's task read as in flight until a person moves it.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { credentialsFor, GitHub, remoteUrl, type Credentials, type Environment } from './github.js';

import type { RunRequest } from './run.js';
import type { Role } from './stages.js';

/**
 * The warning a session prints when its workspace was never trusted, and the reason this
 * module exists in the shape it does.
 *
 * Matched on the *symptom* rather than on the mechanism, which is what makes it worth more
 * than the mechanism it defends. `CLAUDE_CONFIG_DIR` is undocumented; if it is ever
 * withdrawn, or the path is written wrong, this fires on the first second of the run instead
 * of the session being denied its own build halfway through with nobody there to grant it.
 */
export const PERMISSION_WARNING = /Ignoring \d+ permissions\.allow entries/;

/** Where the tracker's MCP server lives. Overridable only so a test can point elsewhere. */
export const TRACKER_MCP_URL = 'https://mcp.linear.app/mcp';

/** What a finished run is known to have done. Handed back; nothing here records it. */
export interface RunOutcome {
  task: string;
  skill: string;
  role: Role;
  /** Whether the session both ran and reported success. Every signal must agree. */
  ok: boolean;
  /** Every signal that said failure, in the order they were read. Empty when {@link ok}. */
  failures: string[];
  /** `total_cost_usd`, where the session reported one. */
  cost?: number;
  sessionId?: string;
  /** The session's own stream, line-delimited, as it was emitted. */
  transcript: string;
  /** Whether the run ended because it was terminated rather than because the session did. */
  terminated: boolean;
}

/** What `tick()` is given so it can act without importing anything that acts. */
export type Launcher = (request: RunRequest) => Promise<RunOutcome>;

/** A spawned child's ending, with everything it wrote. */
export interface Exit {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

export interface CommandSpec {
  command: string;
  args: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

/** A running child: what it will have written, and a way to stop it. */
export interface Child {
  exited: Promise<Exit>;
  kill(signal: NodeJS.Signals): void;
}

export type Spawner = (spec: CommandSpec) => Child;

/**
 * The default spawner, over `node:child_process`.
 *
 * stdin is `'ignore'` rather than inherited, which is the redirect the design costed: a
 * `claude -p` with a live stdin waits about three seconds for input that will never arrive,
 * on every run.
 */
export const spawner: Spawner = (spec) => {
  const child: ChildProcess = spawn(spec.command, spec.args, {
    cwd: spec.cwd,
    env: spec.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  child.stdout?.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
  child.stderr?.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));

  const exited = new Promise<Exit>((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code, signal) => resolve({ code, signal, stdout, stderr }));
  });

  return { exited, kill: (signal) => child.kill(signal) };
};

export interface ExecOptions {
  env?: Environment;
  spawn?: Spawner;
  /** The assistant, as a command and its leading arguments. Tests point this at a stub. */
  claude?: string[];
  /** How a repository is addressed for cloning. Tests point this at a local path. */
  remote?: (repo: string, token: string) => string;
  /** Where run directories are made. Defaults to the system temporary directory. */
  root?: string;
  trackerMcpUrl?: string;
  github?: GitHub;
  /** Kept after the run rather than removed. Never set outside a test that inspects it. */
  keepDirectory?: boolean;
}

/** One event off the session's `stream-json` stream, as much of it as the run reads. */
interface StreamEvent {
  type?: string;
  subtype?: string;
  session_id?: string;
  mcp_server_errors?: unknown[];
  mcp_servers?: { name?: string; status?: string }[];
  is_error?: boolean;
  total_cost_usd?: number;
  result?: string;
}

/** What the session's own stream said, reduced to the three things a verdict rests on. */
export interface SessionReport {
  /** Tracker servers that did not come up, named. Empty where every one connected. */
  mcpFailures: string[];
  /** Whether an init event was seen at all. Its absence is itself a failure. */
  started: boolean;
  isError?: boolean;
  cost?: number;
  sessionId?: string;
  resultText?: string;
}

/**
 * Read the session's stream.
 *
 * `stream-json` rather than `json` — and therefore `--verbose`, which it requires — because
 * plain `json` returns only the final result and the MCP verification lives in the
 * `system/init` event. Needing the init event is the whole reason for the format.
 *
 * Both shapes of MCP failure are read: an explicit `mcp_server_errors` list, and a
 * `mcp_servers` entry whose status is anything but connected. The task was written against
 * the first and the harness has been observed emitting the second, and a check that knew
 * only one of them would pass a session that never reached the tracker — which is the
 * failure that feeds straight back into repeated dispatch, since a session that cannot
 * reach the tracker cannot announce itself.
 *
 * Unparseable lines are skipped rather than raised on. The stream carries whatever the
 * session's tools printed, and a run that failed on a stray line would be reporting the
 * wrong failure.
 */
export function readStream(stdout: string): SessionReport {
  const report: SessionReport = { mcpFailures: [], started: false };

  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;

    let event: StreamEvent;
    try {
      event = JSON.parse(trimmed) as StreamEvent;
    } catch {
      continue;
    }

    if (event.type === 'system' && event.subtype === 'init') {
      report.started = true;
      report.sessionId ??= event.session_id;
      for (const failure of event.mcp_server_errors ?? []) {
        report.mcpFailures.push(typeof failure === 'string' ? failure : JSON.stringify(failure));
      }
      for (const server of event.mcp_servers ?? []) {
        if (server.status && server.status !== 'connected') {
          report.mcpFailures.push(`${server.name ?? 'an MCP server'} reported \`${server.status}\``);
        }
      }
    }

    if (event.type === 'result') {
      report.isError = event.is_error ?? report.isError;
      report.cost = event.total_cost_usd ?? report.cost;
      report.sessionId = event.session_id ?? report.sessionId;
      report.resultText = event.result ?? report.resultText;
    }
  }

  return report;
}

/**
 * The verdict, from every signal at once.
 *
 * Success is not concluded from the exit status alone. The task was opened saying an in-run
 * failure prints as the result rather than raising the exit code; verified against 2.1.220,
 * an authentication failure raised *both* — exit 1 and `is_error: true`. So neither signal
 * is reliably the whole story, and reading only one is right by accident. Treating any of
 * them as sufficient for failure costs nothing: they agree on success, and a disagreement is
 * a failure either way.
 *
 * A pure function of what was observed, so every one of these paths is a test rather than
 * something that was thought about once.
 */
export function verdict(report: SessionReport, exit: Exit, stderr: string): string[] {
  const failures: string[] = [];

  if (PERMISSION_WARNING.test(stderr)) {
    failures.push(
      'the session reported that its workspace was never trusted, so the permissions its own checks ' +
        'require were not in force. Establishing trust is this run\'s job and it did not take effect.',
    );
  }
  for (const failure of report.mcpFailures) {
    failures.push(`the tracker connection did not initialize: ${failure}`);
  }
  if (!report.started) {
    failures.push('the session emitted no init event, so it never started.');
  }
  if (report.isError) {
    failures.push(`the session reported failure: ${report.resultText?.slice(0, 300) ?? 'no detail given'}`);
  }
  if (exit.signal) {
    failures.push(`the session was killed by ${exit.signal}.`);
  } else if (exit.code !== 0) {
    failures.push(`the session exited ${exit.code}.`);
  }

  return failures;
}

/**
 * The prompt.
 *
 * Both halves are named and neither is inferred. The skill is named so it is invoked by
 * name rather than matched from its description — selecting a skill from its description is
 * a judgment, and judgment about what to run belongs to the dispatch decision, not to a
 * session nobody is watching.
 *
 * Naming the task is the half that interacts with `dontAsk`. A stage takes its task given
 * or inferred, asks when that is unclear, and stops when it can neither identify one nor
 * ask — and a dispatched run has no asking branch. A session launched with a bare skill name
 * would therefore refuse to act, correctly, spending a dispatch and presenting from outside
 * as a stage failure.
 */
export function prompt(request: RunRequest): string {
  return `/${request.skill} ${request.task}`;
}

/** The tracker server, as the session is handed it. */
function mcpConfig(url: string, token: string): string {
  return JSON.stringify({
    mcpServers: {
      linear: { type: 'http', url, headers: { Authorization: `Bearer ${token}` } },
    },
  });
}

/**
 * The child's environment: this run's role and nothing of another's.
 *
 * Every `JEN_GH_*` variable is stripped rather than filtered down to the running role's.
 * `pipeline-identity` requires that a session cannot obtain another role's credentials, and
 * a session inherits whatever the runner's environment held — which on a runner configured
 * for all three roles is all three private keys. The session needs none of them: it acts
 * through the minted token, which is already scoped to its own installation and expires on
 * its own.
 */
function childEnvironment(base: Environment, credentials: Credentials, token: string, configDir: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(base)) {
    if (key.startsWith('JEN_GH_')) continue;
    env[key] = value;
  }

  env.CLAUDE_CONFIG_DIR = configDir;
  env.ANTHROPIC_API_KEY = credentials.modelKey;
  env.LINEAR_API_KEY = credentials.trackerToken;
  // What `gh` reads. The stage conventions put every pull-request act through it.
  env.GH_TOKEN = token;
  env.GITHUB_TOKEN = token;
  return env;
}

class ExecError extends Error {}

/**
 * The executor.
 *
 * One instance per command invocation, holding the children it started so a termination can
 * reach them. Each run's directory is removed in its own `finally`, so cleanup happens once,
 * in one place, on every exit path — success, failure, and termination alike.
 */
export class Executor {
  readonly #options: ExecOptions;
  readonly #env: Environment;
  readonly #live = new Set<Child>();
  #terminating = false;

  constructor(options: ExecOptions = {}) {
    this.#options = options;
    this.#env = options.env ?? process.env;
  }

  /** Whether a termination has been signalled. Read by the command for its exit code. */
  get terminating(): boolean {
    return this.#terminating;
  }

  /**
   * Stop every session this executor started.
   *
   * SIGTERM is ordinary operation rather than a crash path: a cancelled Actions job and a
   * stopping local runner both produce it. Claude Code aborts the in-progress turn, kills
   * the Bash process tree, runs its `SessionEnd` hooks, and exits 143 — so the run waits for
   * that rather than killing harder, and each run's own `finally` removes its directory.
   *
   * Nothing is written to the tracker for a session that was stopped. The task keeps the
   * announcement its session wrote and no closing outcome, which every later tick reads as
   * in flight until a person moves it. Closing it on the session's behalf would restore the
   * loop ENG-163 removed, and would put a tracker write outside a stage session.
   */
  terminate(signal: NodeJS.Signals = 'SIGTERM'): void {
    this.#terminating = true;
    for (const child of this.#live) child.kill(signal);
  }

  launch = async (request: RunRequest): Promise<RunOutcome> => {
    const role = request.role as Role;
    const base: RunOutcome = { task: request.task, skill: request.skill, role, transcript: '', ok: false, failures: [], terminated: false };

    let directory: string | undefined;
    try {
      const credentials = credentialsFor(role, this.#env);
      const github = this.#options.github ?? new GitHub();
      const installation = await github.installation(credentials);

      directory = await mkdtemp(join(this.#options.root ?? tmpdir(), 'jen-run-'));
      const repo = join(directory, 'repo');
      const config = join(directory, 'config');
      await mkdir(config, { recursive: true });

      await this.#clone(repo, request.branch, credentials, installation.token);
      await this.#configureIdentity(repo, installation.login, installation.email);
      await this.#trust(config, repo);

      const mcp = join(config, 'mcp.json');
      // Written to a file rather than passed inline, because a command line is readable by
      // every process on the host and this string carries the tracker credential. The file
      // goes with the directory when the run ends.
      await writeFile(mcp, mcpConfig(this.#options.trackerMcpUrl ?? TRACKER_MCP_URL, credentials.trackerToken), {
        mode: 0o600,
      });

      const exit = await this.#session(repo, config, mcp, request, credentials, installation.token);
      const report = readStream(exit.stdout);
      const failures = verdict(report, exit, exit.stderr);

      return {
        ...base,
        ok: failures.length === 0,
        failures,
        cost: report.cost,
        sessionId: report.sessionId,
        transcript: exit.stdout,
        terminated: this.#terminating,
      };
    } catch (error) {
      return {
        ...base,
        failures: [error instanceof Error ? error.message : String(error)],
        terminated: this.#terminating,
      };
    } finally {
      if (directory && !this.#options.keepDirectory) {
        await rm(directory, { recursive: true, force: true }).catch(() => {});
      }
    }
  };

  #spawn(spec: CommandSpec): Child {
    const child = (this.#options.spawn ?? spawner)(spec);
    this.#live.add(child);
    child.exited.finally(() => this.#live.delete(child)).catch(() => {});
    return child;
  }

  async #run(spec: CommandSpec, what: string): Promise<Exit> {
    const exit = await this.#spawn(spec).exited;
    if (exit.code !== 0) {
      throw new ExecError(`${what} failed (${exit.signal ?? `exit ${exit.code}`}): ${exit.stderr.trim().slice(0, 500)}`);
    }
    return exit;
  }

  /**
   * Clone, then place the branch.
   *
   * `git clone --branch <branch>` cannot be used, and this is not a stylistic point:
   * `design-task` runs against a branch that does not exist yet. The request carries the
   * tracker's *suggested* branch name, and design is the stage that first creates and pushes
   * it — so a clone insisting on the branch would fail every design dispatch, which is the
   * pipeline's entry point, before the session could report anything useful.
   *
   * The branch is placed and nothing more. Pushing belongs to the stage; a branch pushed by
   * the executor is a branch with no commit explaining it.
   *
   * Full rather than shallow. Stages read history — the resume convention checks commits
   * against completion markers, and `openspec archive` and delivery both work over more than
   * one commit — so the cost on a large repository is accepted rather than solved.
   */
  async #clone(repo: string, branch: string, credentials: Credentials, token: string): Promise<void> {
    const url = (this.#options.remote ?? remoteUrl)(credentials.repo, token);
    await this.#run({ command: 'git', args: ['clone', url, repo] }, 'cloning the repository');

    const fetched = await this.#spawn({ command: 'git', args: ['fetch', 'origin', branch], cwd: repo }).exited;
    if (fetched.code === 0) {
      await this.#run({ command: 'git', args: ['switch', '--force-create', branch, 'FETCH_HEAD'], cwd: repo }, `switching to ${branch}`);
      return;
    }

    await this.#run({ command: 'git', args: ['switch', '--create', branch], cwd: repo }, `creating ${branch}`);
  }

  /**
   * The identity the clone's commits carry.
   *
   * The token governs what the run may *do*; the git config governs what the history *says*
   * it was, and they have to be set together. Without this, commits carry whatever identity
   * the host has configured — a person's, on a local runner — and the attribution
   * `pipeline-identity` builds its audit story on silently stops being true.
   */
  async #configureIdentity(repo: string, login: string, email: string): Promise<void> {
    await this.#run({ command: 'git', args: ['config', 'user.name', login], cwd: repo }, 'setting the commit name');
    await this.#run({ command: 'git', args: ['config', 'user.email', email], cwd: repo }, 'setting the commit email');
  }

  /**
   * Establish workspace trust for this clone, in a store the run throws away.
   *
   * The finding this task was opened for: `-p`'s own help says the trust dialog is skipped
   * in non-interactive mode, which reads like a dispatched run is exempt. It is not. An
   * untrusted clone runs as though `.claude/settings.json` were empty — and since every run
   * clones to a path nothing has ever trusted, that lands on every run rather than a first.
   *
   * `CLAUDE_CONFIG_DIR` rather than `HOME`, which was the other verified route: `HOME`
   * relocates git's config, ssh's known-hosts, npm's cache, and anything else a stage's own
   * build reaches for, where this moves exactly the one store that needs moving. And rather
   * than `--settings`, which would clear the gate but leave the project's own file inert —
   * so a project could never grant its runs a command jen does not ship, and jen cannot know
   * a project's typecheck, build, or test commands.
   */
  async #trust(config: string, repo: string): Promise<void> {
    const store = { projects: { [repo]: { hasTrustDialogAccepted: true } } };
    await writeFile(join(config, '.claude.json'), JSON.stringify(store, null, 2), { mode: 0o600 });
  }

  /** The session. The prompt goes last — a variadic flag placed before it consumes it. */
  async #session(
    repo: string,
    config: string,
    mcp: string,
    request: RunRequest,
    credentials: Credentials,
    token: string,
  ): Promise<Exit> {
    const [command, ...leading] = this.#options.claude ?? ['claude'];
    return this.#spawn({
      command: command!,
      args: [
        ...leading,
        '--permission-mode',
        'dontAsk',
        '--output-format',
        'stream-json',
        '--verbose',
        '--mcp-config',
        mcp,
        '-p',
        prompt(request),
      ],
      cwd: repo,
      env: childEnvironment(this.#env, credentials, token, config),
    }).exited;
  }
}

/** The launcher `cli.ts` hands the tick, and the executor it belongs to. */
export function executor(options: ExecOptions = {}): Executor {
  return new Executor(options);
}
