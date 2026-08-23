/**
 * The git-host credential for one run: the role's app identity, resolved from the
 * environment, minted into a short-lived installation token, and never written anywhere.
 *
 * Shaped like `linear.ts` deliberately — a hand-written client over global `fetch` with an
 * injectable transport, no dependency, and every error path raising rather than returning
 * something empty. The failure this refuses is the same one: a credential problem that
 * presents as a session which simply did nothing.
 *
 * `node:crypto` signs RS256 natively, so minting happens in-process. The alternative of
 * shelling out to an Actions-provided minter is a layering error rather than a convenience:
 * it would work under one runner and not the other, and `stage-execution` requires that a
 * run cannot tell which runner produced its request.
 *
 * Nothing here reads or writes a file. `registry.yaml` *names* these identities; it never
 * authenticates one, and the two never meet on disk.
 */
import { createSign } from 'node:crypto';

import type { Role } from './stages.js';

/** Where the git host's API lives. Overridable only so tests can point at a recorded transport. */
export const GITHUB_API = 'https://api.github.com';

/** The transport, injectable so the client can be exercised without reaching the network. */
export type Transport = typeof fetch;

/** A required credential was absent from the environment. Names which one. */
export class CredentialError extends Error {}

/** The git host refused, or answered unusably. Never swallowed into a token-shaped empty value. */
export class GitHubError extends Error {}

/**
 * The environment a run reads, for the single role its request names.
 *
 * `<ROLE>` is the role upper-cased: `DESIGN`, `DEV`, `DELIVER`. Only the named role's
 * variables are ever read — a run that reached for a second role's could hold two
 * identities, and `pipeline-identity` requires it hold exactly one.
 */
export const VARIABLES = {
  repo: 'JEN_REPO',
  appId: (role: Role) => `JEN_GH_APP_ID_${role.toUpperCase()}`,
  installation: (role: Role) => `JEN_GH_INSTALLATION_${role.toUpperCase()}`,
  privateKey: (role: Role) => `JEN_GH_PRIVATE_KEY_${role.toUpperCase()}`,
  tracker: 'LINEAR_API_KEY',
  model: 'ANTHROPIC_API_KEY',
} as const;

/** Everything one run needs to act, resolved from the environment and held in memory only. */
export interface Credentials {
  /** `owner/name`, the repository a run clones. */
  repo: string;
  role: Role;
  appId: string;
  installation: string;
  /** PEM, as the environment supplied it. Never logged, never written to a file. */
  privateKey: string;
  /** The tracker agent, shared by all three roles — one agent serves every role. */
  trackerToken: string;
  modelKey: string;
}

export interface Environment {
  [key: string]: string | undefined;
}

function required(env: Environment, name: string, why: string): string {
  const value = env[name];
  if (value === undefined || value.trim() === '') {
    throw new CredentialError(`${name} is not set — ${why}.`);
  }
  return value;
}

/**
 * The role's credentials, or a refusal naming the variable that is absent.
 *
 * Every variable is read before anything else happens, which is the tick's refusal shape
 * reused on purpose: a misconfigured run fails naming what is missing, before a session
 * starts, rather than partway through one that cannot finish. `stage-execution` requires
 * exactly this — no session is started, and the missing credential is named.
 */
export function credentialsFor(role: Role, env: Environment): Credentials {
  const repo = required(env, VARIABLES.repo, 'a run has no repository to clone without it');
  if (!/^[^/\s]+\/[^/\s]+$/.test(repo)) {
    throw new CredentialError(`${VARIABLES.repo} must be \`owner/name\`, and was \`${repo}\`.`);
  }

  return {
    repo,
    role,
    appId: required(env, VARIABLES.appId(role), `the \`${role}\` role's app cannot be identified without it`),
    installation: required(
      env,
      VARIABLES.installation(role),
      `the \`${role}\` role's installation cannot be identified without it`,
    ),
    privateKey: required(env, VARIABLES.privateKey(role), `the \`${role}\` role's token cannot be minted without it`),
    trackerToken: required(env, VARIABLES.tracker, 'a session that cannot reach the tracker cannot announce itself'),
    modelKey: required(env, VARIABLES.model, 'a session cannot run without model access'),
  };
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

/**
 * A PEM as the environment actually supplies it.
 *
 * A private key crossing a secret store, a `.env` file, or a shell often arrives with its
 * newlines escaped, and `createSign` rejects that with a message about the key's format
 * rather than about its newlines. Normalising here costs nothing and turns a confusing
 * failure into no failure at all; a key that already carries real newlines is unchanged.
 */
export function normalizeKey(pem: string): string {
  return pem.includes('\\n') && !pem.includes('\n') ? pem.replace(/\\n/g, '\n') : pem;
}

/**
 * The app JWT: RS256 over `{iat, exp, iss}`, signed with the app's private key.
 *
 * `iat` is backdated a minute because the git host rejects a token whose `iat` is in its
 * own future, and a runner's clock is not ours to trust. `exp` is well inside the ten
 * minutes the host allows, since this token lives only long enough to be exchanged.
 */
export function appJwt(appId: string, privateKey: string, now: number = Date.now()): string {
  const issued = Math.floor(now / 1000) - 60;
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify({ iat: issued, exp: issued + 540, iss: appId }));

  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${payload}`);
  signer.end();

  let signature: string;
  try {
    signature = signer.sign(normalizeKey(privateKey), 'base64url');
  } catch (error) {
    throw new CredentialError(
      'JEN_GH_PRIVATE_KEY_<ROLE> did not parse as a PEM private key: ' +
        `${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return `${header}.${payload}.${signature}`;
}

export interface GitHubOptions {
  endpoint?: string;
  transport?: Transport;
  now?: () => number;
}

/** What a run acts as on the git host: a token that expires, and the identity it commits under. */
export interface Installation {
  /** The installation access token. Short-lived, per-run, and discarded with the run. */
  token: string;
  /** ISO-8601, as the host supplies it. Reported, never acted on. */
  expiresAt: string;
  /** `<slug>[bot]`, the name commits made by this app carry. */
  login: string;
  /**
   * `<bot-user-id>+<slug>[bot]@users.noreply.github.com`.
   *
   * The number is the **bot user's** id, not the app's. They are different numbers for the
   * same app — `4588651` and `316769915` for this project's own — and the host accepts an
   * address built from either without complaint. Only the bot user's resolves to an account,
   * so only that one attributes a commit to the role; the other renders as an unlinked name.
   */
  email: string;
}

export class GitHub {
  readonly #endpoint: string;
  readonly #transport: Transport;
  readonly #now: () => number;

  constructor(options: GitHubOptions = {}) {
    this.#endpoint = options.endpoint ?? GITHUB_API;
    this.#transport = options.transport ?? fetch;
    this.#now = options.now ?? Date.now;
  }

  /**
   * One request. No retry and no backoff, for the reason `linear.ts` gives: the pipeline's
   * answer to a failed run is the next tick, and retrying inside makes a deterministic
   * failure cost three requests instead of one while hiding it either way.
   */
  async #request<T>(path: string, token: string, method: 'GET' | 'POST'): Promise<T> {
    let response: Response;
    try {
      response = await this.#transport(`${this.#endpoint}${path}`, {
        method,
        headers: {
          accept: 'application/vnd.github+json',
          authorization: `Bearer ${token}`,
          'x-github-api-version': '2022-11-28',
          'user-agent': 'jen',
        },
      });
    } catch (error) {
      throw new GitHubError(`could not reach the git host: ${error instanceof Error ? error.message : String(error)}`);
    }

    const text = await response.text();
    if (!response.ok) {
      throw new GitHubError(`the git host answered ${response.status} for ${path}: ${text.slice(0, 500)}`);
    }

    try {
      return JSON.parse(text) as T;
    } catch {
      throw new GitHubError(`the git host answered ${path} with unreadable JSON: ${text.slice(0, 500)}`);
    }
  }

  /**
   * Mint the role's installation token, and establish the identity it commits under.
   *
   * The slug is read from the host rather than configured, which is what keeps this at the
   * environment surface the design costed rather than a variable wider. `registry.yaml`
   * records an `app` name per role, but the executor reads no files by construction, and the
   * app's own `/app` response is authoritative about its slug in a way a recorded name is
   * not — a renamed app would otherwise commit under a name that no longer exists.
   *
   * The bot user's id is read for the same reason and for a sharper one: it is not the app's
   * id, and nothing tells you when you have used the wrong one. See {@link Installation.email}.
   *
   * Three requests. The first two go under the JWT, which is discarded here; the third goes
   * under the freshly minted installation token, because the JWT authenticates the *app* and
   * `/users/…` is an ordinary read rather than an app endpoint. Only the installation token
   * leaves this method, and it expires on its own.
   */
  async installation(credentials: Credentials): Promise<Installation> {
    const jwt = appJwt(credentials.appId, credentials.privateKey, this.#now());

    const app = await this.#request<{ slug?: string }>('/app', jwt, 'GET');
    if (!app.slug) {
      throw new GitHubError('the git host named no slug for this app, so a run has no identity to commit under.');
    }

    const minted = await this.#request<{ token?: string; expires_at?: string }>(
      `/app/installations/${encodeURIComponent(credentials.installation)}/access_tokens`,
      jwt,
      'POST',
    );
    if (!minted.token) {
      throw new GitHubError('the git host minted no token for this installation.');
    }

    const login = `${app.slug}[bot]`;
    const bot = await this.#request<{ id?: number }>(`/users/${encodeURIComponent(login)}`, minted.token, 'GET');
    if (bot.id === undefined) {
      // Raised rather than fallen back from. An address built on the app's id is accepted by
      // every layer that handles it and attributes the commit to nobody, which is the silent
      // failure this whole module is shaped to refuse.
      throw new GitHubError(`the git host named no user id for \`${login}\`, so a run has no address to commit under.`);
    }

    return {
      token: minted.token,
      expiresAt: minted.expires_at ?? 'unreported',
      login,
      email: `${bot.id}+${login}@users.noreply.github.com`,
    };
  }
}

/**
 * The clone URL a run pushes through.
 *
 * It carries the username the git host expects for an installation token and **not** the
 * token itself. The token would otherwise be an argv element of `git clone` — readable by
 * every process on the host, and on Linux through a world-readable `/proc/<pid>/cmdline` —
 * and it would then sit in the clone's `.git/config` for the rest of the run. Git asks for
 * the password instead, and `GIT_ASKPASS` answers out of the environment; see `askpass` in
 * `exec.ts`. It is the same rule `cli/AGENTS.md` states for the tracker payload, on the same
 * host and for the same reason.
 */
export function remoteUrl(repo: string): string {
  return `https://x-access-token@github.com/${repo}.git`;
}
