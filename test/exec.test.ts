/**
 * The executor: what it isolates, what it establishes before a session starts, and what it
 * concludes from what the session reported.
 *
 * The verdict and the stream reader are pure and are exercised directly, because every one
 * of their branches is a failure mode that would otherwise only appear in production — an
 * unreachable tracker, a session that never started, permissions silently inert.
 *
 * Everything else runs for real against a stub. `claude` is a node script emitting canned
 * `stream-json`, and the remote is a git repository on disk, so the clone, the branch
 * placement, the child's environment, the cleanup, and the signal are all exercised as
 * themselves rather than through a mock of them. No test spends money or reaches the
 * network, which is the only thing the stubs are there to avoid.
 */
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtemp, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { GitHub } from '../cli/github.js';
import {
  Executor,
  prompt,
  readStream,
  spawner,
  verdict,
  type Exit,
  type ExecOptions,
  type RunOutcome,
  type SessionReport,
  type Spawner,
} from '../cli/exec.js';

import type { RunRequest } from '../cli/run.js';

const REQUEST: RunRequest = { task: 'ENG-1', skill: 'implement-task', role: 'dev', branch: 'eng-1-a-task' };

function exit(overrides: Partial<Exit> = {}): Exit {
  return { code: 0, signal: null, stdout: '', stderr: '', ...overrides };
}

function report(overrides: Partial<SessionReport> = {}): SessionReport {
  return { mcpFailures: [], started: true, isError: false, ...overrides };
}

describe('the prompt', () => {
  // Both halves are named and neither is inferred. The task especially: a session launched
  // with a bare skill name has no asking branch under `dontAsk`, so it would refuse to act —
  // spending a dispatch and presenting from outside as a stage failure.
  it('names the skill by name and the task beside it', () => {
    expect(prompt(REQUEST)).toBe('/implement-task ENG-1');
  });
});

describe('reading the session’s stream', () => {
  const init = (extra: Record<string, unknown> = {}) =>
    JSON.stringify({ type: 'system', subtype: 'init', session_id: 's-1', mcp_servers: [], ...extra });
  const result = (extra: Record<string, unknown> = {}) =>
    JSON.stringify({ type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0.42, ...extra });

  it('takes the cost and the session id off the result', () => {
    const read = readStream([init(), result()].join('\n'));

    expect(read.started).toBe(true);
    expect(read.cost).toBe(0.42);
    expect(read.sessionId).toBe('s-1');
    expect(read.mcpFailures).toEqual([]);
  });

  // The shape the task was written against.
  it('reads an explicit mcp_server_errors list', () => {
    const read = readStream([init({ mcp_server_errors: ['linear failed to validate'] }), result()].join('\n'));

    expect(read.mcpFailures).toEqual([{ server: undefined, detail: 'linear failed to validate' }]);
  });

  // And the shape the harness has been observed emitting. A check knowing only one of them
  // would pass a session that never reached the tracker — which cannot announce itself, so
  // the next tick dispatches the task again.
  it('reads a server that came up in any state but connected', () => {
    const failed = init({ mcp_servers: [{ name: 'linear', status: 'failed' }] });
    const read = readStream([failed, result()].join('\n'));

    expect(read.mcpFailures).toEqual([{ server: 'linear', detail: 'reported `failed`' }]);
  });

  // The clone is a full jen installation, so a project's own `.mcp.json` contributes servers
  // beside the tracker's. Each failure has to carry the name it belongs to; the verdict is
  // where that turns into a diagnosis.
  it('keeps each failing server’s own name rather than pooling them', () => {
    const failed = init({
      mcp_servers: [
        { name: 'linear', status: 'connected' },
        { name: 'some-other-server', status: 'failed' },
      ],
    });

    expect(readStream([failed, result()].join('\n')).mcpFailures).toEqual([
      { server: 'some-other-server', detail: 'reported `failed`' },
    ]);
  });

  it('says nothing failed when every server connected', () => {
    const read = readStream([init({ mcp_servers: [{ name: 'linear', status: 'connected' }] }), result()].join('\n'));

    expect(read.mcpFailures).toEqual([]);
  });

  it('reports a session that emitted no init event', () => {
    expect(readStream(result()).started).toBe(false);
  });

  // The stream carries whatever the session's tools printed. A run that raised on a stray
  // line would be reporting the wrong failure.
  it('skips lines that are not events rather than failing on them', () => {
    const read = readStream(['npm warn deprecated something', '', '{ not json', init(), result()].join('\n'));

    expect(read.started).toBe(true);
    expect(read.cost).toBe(0.42);
  });
});

describe('the verdict', () => {
  it('is success only when every signal agrees', () => {
    expect(verdict(report(), exit(), '')).toEqual([]);
  });

  // The task was opened saying an in-run failure prints as the result rather than raising the
  // exit code. Verified against 2.1.220, an authentication failure raised *both* — so neither
  // signal is reliably the whole story and reading only one is right by accident.
  it('fails on the session’s own result even where it exited 0', () => {
    const failures = verdict(report({ isError: true, resultText: 'Invalid API key' }), exit(), '');

    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain('Invalid API key');
  });

  it('fails on a non-zero exit even where the result said nothing', () => {
    expect(verdict(report(), exit({ code: 1 }), '')).toEqual([expect.stringContaining('exited 1')]);
  });

  it('fails on a tracker connection that did not initialize', () => {
    const failures = verdict(report({ mcpFailures: [{ server: 'linear', detail: 'reported `failed`' }] }), exit(), '');

    expect(failures).toEqual([expect.stringContaining('tracker connection did not initialize')]);
  });

  // A second server failing is still a failed run — the session was given something it did
  // not get — but calling it the tracker sends whoever reads the report after the wrong
  // system entirely.
  it('names the server that failed rather than diagnosing every one of them as the tracker', () => {
    const failures = verdict(
      report({ mcpFailures: [{ server: 'some-other-server', detail: 'reported `failed`' }] }),
      exit(),
      '',
    );

    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain('some-other-server');
    expect(failures[0]).not.toContain('tracker');
  });

  it('fails on a session that never started', () => {
    expect(verdict(report({ started: false }), exit(), '')).toEqual([expect.stringContaining('never started')]);
  });

  // The mitigation that makes an undocumented `CLAUDE_CONFIG_DIR` an acceptable dependency:
  // it turns the silent loss of permissions into a named first-second failure. The check is
  // on the symptom, so it holds whatever the mechanism.
  it('fails on the untrusted-workspace warning, which the session prints and survives', () => {
    const stderr = 'Ignoring 8 permissions.allow entries from .claude/settings.json: this workspace has not been trusted.';
    const failures = verdict(report(), exit(), stderr);

    expect(failures).toEqual([expect.stringContaining('never trusted')]);
  });

  it('reports every signal that failed rather than the first', () => {
    const failures = verdict(
      report({ isError: true, mcpFailures: [{ server: 'linear', detail: 'reported `failed`' }] }),
      exit({ code: 1 }),
      'Ignoring 8 permissions.allow entries',
    );

    expect(failures).toHaveLength(4);
  });

  it('names the signal when a session was killed rather than reporting an exit code', () => {
    expect(verdict(report(), exit({ code: null, signal: 'SIGTERM' }), '')).toEqual([
      expect.stringContaining('SIGTERM'),
    ]);
  });
});

// Everything below runs a real clone against a real repository and a real child process.
describe('a run', () => {
  let scratch: string;
  let origin: string;
  let stub: string;
  let record: string;

  const git = (args: string[], cwd: string) =>
    execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

  beforeAll(() => {
    scratch = join(tmpdir(), `jen-exec-${process.pid}`);
    origin = join(scratch, 'origin');
    stub = join(scratch, 'claude.mjs');
    record = join(scratch, 'record.json');
    mkdirSync(origin, { recursive: true });

    git(['init', '-b', 'main'], origin);
    git(['config', 'user.name', 'Origin'], origin);
    git(['config', 'user.email', 'origin@example.com'], origin);
    writeFileSync(join(origin, 'README.md'), '# origin\n');
    git(['add', '-A'], origin);
    git(['commit', '-m', 'first'], origin);
    // A branch that already exists, so the fetch path and the create path are both real.
    git(['switch', '-c', 'eng-2-designed'], origin);
    writeFileSync(join(origin, 'design.md'), '# design\n');
    git(['add', '-A'], origin);
    git(['commit', '-m', 'design'], origin);
    git(['switch', 'main'], origin);

    // The stub assistant: records how it was invoked, emits canned events, exits as told.
    writeFileSync(
      stub,
      `import { chmodSync, writeFileSync } from 'node:fs';
const env = process.env;
writeFileSync(env.STUB_RECORD, JSON.stringify({
  argv: process.argv.slice(2),
  cwd: process.cwd(),
  env: Object.fromEntries(Object.entries(env).filter(([k]) => k.startsWith('JEN') || k.startsWith('GH') || k.startsWith('GITHUB') || k.startsWith('GIT_') || k === 'CLAUDE_CONFIG_DIR' || k === 'LINEAR_API_KEY' || k === 'ANTHROPIC_API_KEY')),
}));
if (env.STUB_STDERR) process.stderr.write(env.STUB_STDERR + '\\n');
for (const line of JSON.parse(env.STUB_EVENTS ?? '[]')) process.stdout.write(JSON.stringify(line) + '\\n');
// Takes away the run root's write bit from inside the run, so the removal that follows
// fails for a reason nothing in the executor can arrange for itself.
if (env.STUB_LOCK) chmodSync(env.STUB_LOCK, 0o500);
if (env.STUB_SLEEP) { setTimeout(() => process.exit(0), Number(env.STUB_SLEEP)); }
else process.exit(Number(env.STUB_EXIT ?? '0'));
`,
    );
  });

  afterAll(() => rmSync(scratch, { recursive: true, force: true }));

  const EVENTS = [
    { type: 'system', subtype: 'init', session_id: 's-1', mcp_servers: [{ name: 'linear', status: 'connected' }] },
    { type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0.5, session_id: 's-1' },
  ];

  function environment(extra: Record<string, string> = {}): Record<string, string> {
    return {
      JEN_REPO: 'reveer-ai/jen',
      JEN_GH_APP_ID_DEV: '4588651',
      JEN_GH_INSTALLATION_DEV: '153578694',
      JEN_GH_PRIVATE_KEY_DEV: 'unused — the host is stubbed',
      JEN_GH_PRIVATE_KEY_DESIGN: 'another role’s key, which the session must not receive',
      LINEAR_API_KEY: 'lin_api_recorded',
      ANTHROPIC_API_KEY: 'sk-ant-recorded',
      STUB_RECORD: record,
      STUB_EVENTS: JSON.stringify(EVENTS),
      ...extra,
    };
  }

  /** A `GitHub` that mints without signing, so a run needs no key and no network. */
  function host(delay = 0): GitHub {
    const minted = new GitHub({
      transport: async (input) =>
        new Response(
          JSON.stringify(String(input).endsWith('/app') ? { slug: 'reveer-jen-dev' } : { token: 'ghs_recorded' }),
        ),
    });
    // The JWT is not what is under test here, and signing needs a real key.
    Object.defineProperty(minted, 'installation', {
      value: async () => {
        // A run's first step reaches the network before any child exists, which is where a
        // signal used to fall through the gap. Slowed on request so that window is real.
        if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
        return {
          token: 'ghs_recorded',
          expiresAt: '2026-08-23T02:00:00Z',
          login: 'reveer-jen-dev[bot]',
          email: '316769915+reveer-jen-dev[bot]@users.noreply.github.com',
        };
      },
    });
    return minted;
  }

  function build(extra: Record<string, string> = {}, keepDirectory = false, options: Partial<ExecOptions> = {}): Executor {
    return new Executor({
      env: environment(extra),
      claude: [process.execPath, stub],
      remote: () => origin,
      root: scratch,
      github: host(),
      keepDirectory,
      ...options,
    });
  }

  async function launched(request = REQUEST, extra: Record<string, string> = {}, keep = false) {
    rmSync(record, { force: true });
    const outcome = await build(extra, keep).launch(request);
    const invoked = existsSync(record)
      ? (JSON.parse(readFileSync(record, 'utf8')) as { argv: string[]; cwd: string; env: Record<string, string> })
      : undefined;
    return { outcome, invoked };
  }

  it('runs the session and reports what it cost', async () => {
    const { outcome, invoked } = await launched();

    expect(outcome.failures).toEqual([]);
    expect(outcome.ok).toBe(true);
    expect(outcome.cost).toBe(0.5);
    expect(outcome.sessionId).toBe('s-1');
    expect(invoked).toBeDefined();
  });

  it('invokes the skill by name with the task, and puts the prompt last', async () => {
    const { invoked } = await launched();

    expect(invoked!.argv.at(-1)).toBe('/implement-task ENG-1');
    expect(invoked!.argv.at(-2)).toBe('-p');
    expect(invoked!.argv).toContain('--permission-mode');
    expect(invoked!.argv[invoked!.argv.indexOf('--permission-mode') + 1]).toBe('dontAsk');
    expect(invoked!.argv).toContain('--verbose');
    expect(invoked!.argv[invoked!.argv.indexOf('--output-format') + 1]).toBe('stream-json');
  });

  // `--bare` skips discovery of skills, MCP servers, memory, and `CLAUDE.md` — which is the
  // entirety of what jen installs. A session missing them is not a stage.
  it('does not run bare', async () => {
    const { invoked } = await launched();

    expect(invoked!.argv).not.toContain('--bare');
  });

  it('works in a clone of the repository, at the task’s branch', async () => {
    const { invoked } = await launched({ ...REQUEST, branch: 'eng-2-designed' }, {}, true);

    expect(git(['branch', '--show-current'], invoked!.cwd)).toBe('eng-2-designed');
    expect(existsSync(join(invoked!.cwd, 'design.md'))).toBe(true);
    rmSync(join(invoked!.cwd, '..'), { recursive: true, force: true });
  });

  // A branch placed off `origin/<branch>` tracks it; one placed off `FETCH_HEAD` tracks
  // nothing, and the session's own `git push` fails with *has no upstream branch* — on every
  // stage after design, which is every stage that resumes a branch.
  it('leaves the resumed branch tracking its remote, so the session can push it', async () => {
    const { invoked } = await launched({ ...REQUEST, branch: 'eng-2-designed' }, {}, true);

    expect(git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], invoked!.cwd)).toBe(
      'origin/eng-2-designed',
    );
    rmSync(join(invoked!.cwd, '..'), { recursive: true, force: true });
  });

  // Runner git calls inherit the operator's global configuration. Branch placement must
  // name both the start point and the tracking relationship instead of depending on DWIM:
  // `checkout.guess = false` rejects `git switch <branch>`, while
  // `branch.autoSetupMerge = false` silently leaves the branch without an upstream.
  it('places and tracks a resumed branch when the operator disables git’s branch defaults', async () => {
    const config = join(scratch, 'hostile-gitconfig');
    writeFileSync(config, '[checkout]\n\tguess = false\n[branch]\n\tautoSetupMerge = false\n');
    const hostile: Spawner = (spec) =>
      spawner({ ...spec, env: { ...process.env, ...spec.env, GIT_CONFIG_GLOBAL: config } });

    rmSync(record, { force: true });
    const outcome = await build({}, true, { spawn: hostile }).launch({ ...REQUEST, branch: 'eng-2-designed' });
    expect(outcome.ok).toBe(true);
    const invoked = JSON.parse(readFileSync(record, 'utf8')) as { cwd: string };
    expect(git(['branch', '--show-current'], invoked.cwd)).toBe('eng-2-designed');
    expect(git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], invoked.cwd)).toBe(
      'origin/eng-2-designed',
    );
    rmSync(join(invoked.cwd, '..'), { recursive: true, force: true });
  });

  // The defect this replaced: `git fetch origin <branch>` exits 128 both when the ref is
  // absent and when the fetch could not happen at all, so a transport or auth failure was
  // read as "the remote has no such branch" and the session was handed a branch cut from the
  // default one, carrying none of the task's history. The stage would then read the task as
  // untouched, redo it, write to the tracker, and fail only at the push.
  it('places a branch the remote has even when the remote goes unreachable after the clone', async () => {
    const moved = `${origin}-unreachable`;
    // The origin disappears the instant the clone finishes, so anything reaching for the
    // remote past that point fails exactly as an unreachable host or a dead credential does.
    const cutOff: Spawner = (spec) => {
      const child = spawner(spec);
      if (spec.args[0] === 'clone') void child.exited.then(() => renameSync(origin, moved)).catch(() => {});
      return child;
    };

    rmSync(record, { force: true });
    let outcome: RunOutcome;
    try {
      outcome = await build({}, true, { spawn: cutOff }).launch({ ...REQUEST, branch: 'eng-2-designed' });
    } finally {
      if (existsSync(moved)) renameSync(moved, origin);
    }
    const invoked = JSON.parse(readFileSync(record, 'utf8')) as { cwd: string };

    expect(outcome.ok).toBe(true);
    expect(git(['branch', '--show-current'], invoked.cwd)).toBe('eng-2-designed');
    // The history is the point: a branch off the default one would not carry this.
    expect(existsSync(join(invoked.cwd, 'design.md'))).toBe(true);
    rmSync(join(invoked.cwd, '..'), { recursive: true, force: true });
  });

  // The pipeline's entry point: `design-task` runs against a branch that does not exist yet,
  // so a clone insisting on the branch would fail every design dispatch.
  it('creates the branch locally where the remote has none, and does not push it', async () => {
    const { outcome, invoked } = await launched({ ...REQUEST, branch: 'eng-9-never-designed' }, {}, true);

    expect(outcome.ok).toBe(true);
    expect(git(['branch', '--show-current'], invoked!.cwd)).toBe('eng-9-never-designed');
    expect(git(['branch', '--list', 'eng-9-never-designed'], origin)).toBe('');
    rmSync(join(invoked!.cwd, '..'), { recursive: true, force: true });
  });

  // The token governs what a run may do; the git config governs what the history says it
  // was. Without this, commits carry whatever identity the host has — a person's, locally.
  it('commits under the role’s app identity rather than the host’s', async () => {
    const { invoked } = await launched(REQUEST, {}, true);

    expect(git(['config', 'user.name'], invoked!.cwd)).toBe('reveer-jen-dev[bot]');
    expect(git(['config', 'user.email'], invoked!.cwd)).toBe('316769915+reveer-jen-dev[bot]@users.noreply.github.com');
    rmSync(join(invoked!.cwd, '..'), { recursive: true, force: true });
  });

  it('trusts the clone in a config store of its own', async () => {
    const { invoked } = await launched(REQUEST, {}, true);
    const store = JSON.parse(readFileSync(join(invoked!.env.CLAUDE_CONFIG_DIR!, '.claude.json'), 'utf8')) as {
      projects: Record<string, { hasTrustDialogAccepted: boolean }>;
    };

    expect(store.projects[invoked!.cwd]!.hasTrustDialogAccepted).toBe(true);
    expect(invoked!.env.CLAUDE_CONFIG_DIR).not.toBe(process.env.CLAUDE_CONFIG_DIR);
    rmSync(join(invoked!.cwd, '..'), { recursive: true, force: true });
  });

  // `pipeline-identity` requires that a session cannot obtain another role's credentials, and
  // a session inherits whatever the runner's environment held — which on a runner configured
  // for all three roles is all three private keys.
  it('hands the session its own token and none of another role’s credentials', async () => {
    const { invoked } = await launched();

    expect(invoked!.env.GH_TOKEN).toBe('ghs_recorded');
    expect(invoked!.env.LINEAR_API_KEY).toBe('lin_api_recorded');
    expect(Object.keys(invoked!.env).filter((key) => key.startsWith('JEN_GH_'))).toEqual([]);
    expect(JSON.stringify(invoked!.env)).not.toContain('another role’s key');
  });

  // The same rule as the tracker payload below, on the same host: an installation token
  // spliced into the clone URL is an argv element of `git clone`, and `/proc/<pid>/cmdline`
  // is world-readable where `/proc/<pid>/environ` is owner-only.
  it('answers git’s prompt out of the environment rather than out of a command line', async () => {
    const { invoked } = await launched(REQUEST, {}, true);
    const askpass = invoked!.env.GIT_ASKPASS!;

    expect(askpass).toContain(invoked!.env.CLAUDE_CONFIG_DIR!);
    expect(existsSync(askpass)).toBe(true);
    expect(readFileSync(askpass, 'utf8')).not.toContain('ghs_recorded');
    // Set for the session too, so an unattended `git push` fails rather than waiting on a
    // prompt into a stdin nobody is attached to.
    expect(invoked!.env.GIT_TERMINAL_PROMPT).toBe('0');
    rmSync(join(invoked!.cwd, '..'), { recursive: true, force: true });
  });

  // The handshake itself, rather than the script's text. `git credential fill` is the same
  // path a `git push` from the session takes, with the configured helpers cleared so the
  // answer can only have come from the script.
  it('hands git the token when git asks for it', async () => {
    const { invoked } = await launched(REQUEST, {}, true);
    const filled = execFileSync('git', ['credential', 'fill'], {
      input: 'protocol=https\nhost=github.com\nusername=x-access-token\n\n',
      encoding: 'utf8',
      env: {
        ...process.env,
        // Both config files taken out of the picture, so a helper configured on the machine
        // running the tests cannot answer in the script's place.
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_CONFIG_SYSTEM: '/dev/null',
        GIT_ASKPASS: invoked!.env.GIT_ASKPASS!,
        GH_TOKEN: 'ghs_recorded',
        GIT_TERMINAL_PROMPT: '0',
      },
    });

    expect(filled).toContain('password=ghs_recorded');
    rmSync(join(invoked!.cwd, '..'), { recursive: true, force: true });
  });

  // A command line is readable by every process on the host, and this string carries the
  // tracker credential.
  it('passes the tracker server as a file rather than on the command line', async () => {
    const { invoked } = await launched();
    const config = invoked!.argv[invoked!.argv.indexOf('--mcp-config') + 1]!;

    expect(invoked!.argv.join(' ')).not.toContain('lin_api_recorded');
    expect(config).toContain(invoked!.env.CLAUDE_CONFIG_DIR!);
  });

  it('removes everything it created when the run ends', async () => {
    const { invoked } = await launched();

    expect(existsSync(invoked!.cwd)).toBe(false);
    expect(existsSync(invoked!.env.CLAUDE_CONFIG_DIR!)).toBe(false);
  });

  it('removes everything it created when the session failed', async () => {
    const { outcome, invoked } = await launched(REQUEST, { STUB_EXIT: '1' });

    expect(outcome.ok).toBe(false);
    expect(existsSync(invoked!.cwd)).toBe(false);
  });

  it('reports the untrusted-workspace warning as a failure of the run', async () => {
    const { outcome } = await launched(REQUEST, {
      STUB_STDERR: 'Ignoring 8 permissions.allow entries from .claude/settings.json: this workspace has not been trusted.',
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.failures).toEqual([expect.stringContaining('never trusted')]);
  });

  it('reports a tracker that did not connect', async () => {
    const events = [
      { type: 'system', subtype: 'init', session_id: 's-1', mcp_servers: [{ name: 'linear', status: 'failed' }] },
      { type: 'result', subtype: 'success', is_error: false, session_id: 's-1' },
    ];
    const { outcome } = await launched(REQUEST, { STUB_EVENTS: JSON.stringify(events) });

    expect(outcome.ok).toBe(false);
    expect(outcome.failures).toEqual([expect.stringContaining('tracker connection did not initialize')]);
  });

  // No session is started, and the missing credential is named.
  it('refuses before starting a session when a credential is missing', async () => {
    rmSync(record, { force: true });
    const env = environment();
    delete env.ANTHROPIC_API_KEY;
    const outcome = await new Executor({
      env,
      claude: [process.execPath, stub],
      remote: () => origin,
      root: scratch,
      github: host(),
    }).launch(REQUEST);

    expect(outcome.ok).toBe(false);
    expect(outcome.failures).toEqual([expect.stringContaining('ANTHROPIC_API_KEY')]);
    expect(existsSync(record), 'no session was started').toBe(false);
  });

  it('gives two concurrent runs working copies neither can reach', async () => {
    const first = join(scratch, 'record-1.json');
    const second = join(scratch, 'record-2.json');
    await Promise.all([
      build({ STUB_RECORD: first }).launch(REQUEST),
      build({ STUB_RECORD: second }).launch({ ...REQUEST, task: 'ENG-2' }),
    ]);

    const one = JSON.parse(readFileSync(first, 'utf8')) as { cwd: string };
    const two = JSON.parse(readFileSync(second, 'utf8')) as { cwd: string };
    expect(one.cwd).not.toBe(two.cwd);
  });

  // Termination is ordinary operation — a cancelled job and a stopping local runner both
  // produce it — so it is handled deterministically rather than as a crash path.
  it('stops its session on termination, cleans up, and leaves the outcome saying so', async () => {
    rmSync(record, { force: true });
    const sessions = build({ STUB_SLEEP: '30000' });
    const running = sessions.launch(REQUEST);

    // Wait for the session to actually be up before stopping it.
    for (let attempt = 0; attempt < 200 && !existsSync(record); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect(existsSync(record), 'the stub session started').toBe(true);
    sessions.terminate();

    const outcome: RunOutcome = await running;
    const invoked = JSON.parse(readFileSync(record, 'utf8')) as { cwd: string };

    expect(outcome.terminated).toBe(true);
    expect(outcome.sessionStarted).toBe(true);
    expect(outcome.ok).toBe(false);
    expect(existsSync(invoked.cwd), 'the working copy went with the run').toBe(false);
  });

  // `terminate()` reaches only what is already running, so a signal landing before the first
  // child — during the minting, where none exists at all — used to leave the run to clone,
  // configure, and start a full session after it had been told to stop. A stage would then
  // write to the tracker and push commits past its own cancellation.
  it('starts no session when it was stopped before one existed', async () => {
    rmSync(record, { force: true });
    const sessions = new Executor({
      env: environment(),
      claude: [process.execPath, stub],
      remote: () => origin,
      root: scratch,
      github: host(200),
    });
    const running = sessions.launch(REQUEST);
    await new Promise((resolve) => setTimeout(resolve, 50));
    sessions.terminate();

    const outcome: RunOutcome = await running;

    expect(existsSync(record), 'no session was started').toBe(false);
    expect(outcome.sessionStarted).toBe(false);
    expect(outcome.terminated).toBe(true);
    expect(outcome.ok).toBe(false);
  });

  // The other half of the same fix, and the race it closes: a signal arriving in the instant
  // between the session finishing and the run reading the flag. Read straight off the flag,
  // a run that had already finished and succeeded reported as stopped, and `see()` then
  // described its task as left mid-stage when the stage had in fact completed.
  it('does not call a finished run stopped because a signal arrived as it ended', async () => {
    let sessions: Executor;
    const stopOnExit: Spawner = (spec) => {
      const child = spawner(spec);
      if (spec.command === process.execPath) void child.exited.then(() => sessions.terminate());
      return child;
    };
    sessions = build({}, false, { spawn: stopOnExit });

    const outcome = await sessions.launch(REQUEST);

    expect(sessions.terminating, 'the signal really did land').toBe(true);
    expect(outcome.ok).toBe(true);
    expect(outcome.terminated).toBe(false);
  });

  // Cleanup is the whole of how `stage-execution`'s "no credential remains on the host" is
  // satisfied — `config/mcp.json` holds the tracker's, live until someone rotates it — so
  // the one case that violates the requirement must not be the one case nothing reports.
  it('reports a run directory it could not remove, naming where it is', async () => {
    if (process.getuid?.() === 0) return; // root ignores the permission this test relies on.
    const locked = await realpath(await mkdtemp(join(tmpdir(), 'jen-locked-')));
    try {
      const outcome = await new Executor({
        env: environment({ STUB_LOCK: locked }),
        claude: [process.execPath, stub],
        remote: () => origin,
        root: locked,
        github: host(),
      }).launch(REQUEST);

      expect(outcome.ok).toBe(false);
      expect(outcome.failures.at(-1)).toContain(locked);
      expect(outcome.failures.at(-1)).toContain('tracker credential');
      // The session's own verdict is not displaced by the sweep's — it is added beside it.
      expect(outcome.sessionId).toBe('s-1');
      expect(outcome.cost).toBe(0.5);
    } finally {
      chmodSync(locked, 0o700);
      rmSync(locked, { recursive: true, force: true });
    }
  });

  it('makes its directories where it was told to', async () => {
    // Resolved for the comparison, because the run resolves its own — see the note in
    // `exec.ts`, where that is load-bearing rather than tidiness.
    const root = await realpath(await mkdtemp(join(tmpdir(), 'jen-root-')));
    await new Executor({
      env: environment(),
      claude: [process.execPath, stub],
      remote: () => origin,
      root,
      github: host(),
    }).launch(REQUEST);

    const invoked = JSON.parse(readFileSync(record, 'utf8')) as { cwd: string };
    expect(invoked.cwd.startsWith(root)).toBe(true);
    rmSync(root, { recursive: true, force: true });
  });
});
