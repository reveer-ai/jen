/**
 * The role's credential: what it refuses, what it signs, and what it commits under.
 *
 * The JWT is checked against the public half of a key pair generated here rather than
 * against a recorded string. A recorded signature proves the implementation still produces
 * the bytes it produced the day it was written; verifying proves it produces a token the
 * git host would accept, which is the property that matters and the one that would break
 * silently.
 *
 * Nothing here reaches the network. The exchange goes through a stub transport, in the
 * idiom `linear.test.ts` uses for the tracker.
 */
import { createVerify, generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  appJwt,
  credentialsFor,
  CredentialError,
  GitHub,
  GitHubError,
  normalizeKey,
  remoteUrl,
  VARIABLES,
  type Credentials,
  type Transport,
} from '../cli/github.js';

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

/** A complete environment for every role, so a test can remove exactly one thing from it. */
function environment(): Record<string, string> {
  return {
    JEN_REPO: 'reveer-ai/jen',
    JEN_GH_APP_ID_DESIGN: '4588648',
    JEN_GH_INSTALLATION_DESIGN: '153578675',
    JEN_GH_PRIVATE_KEY_DESIGN: privateKey,
    JEN_GH_APP_ID_DEV: '4588651',
    JEN_GH_INSTALLATION_DEV: '153578694',
    JEN_GH_PRIVATE_KEY_DEV: privateKey,
    LINEAR_API_KEY: 'lin_api_recorded',
    ANTHROPIC_API_KEY: 'sk-ant-recorded',
  };
}

function decode(part: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as Record<string, unknown>;
}

function credentials(overrides: Partial<Credentials> = {}): Credentials {
  return {
    repo: 'reveer-ai/jen',
    role: 'dev',
    appId: '4588651',
    installation: '153578694',
    privateKey,
    trackerToken: 'lin_api_recorded',
    modelKey: 'sk-ant-recorded',
    ...overrides,
  };
}

/** A transport answering each request in order, recording what it was asked. */
function stub(...responses: { status?: number; body: unknown }[]) {
  const asked: { url: string; method: string; authorization: string }[] = [];
  let index = 0;
  const transport: Transport = async (input, init) => {
    const headers = new Headers(init?.headers);
    asked.push({
      url: String(input),
      method: init?.method ?? 'GET',
      authorization: headers.get('authorization') ?? '',
    });
    const recorded = responses[index++] ?? { body: {} };
    return new Response(JSON.stringify(recorded.body), { status: recorded.status ?? 200 });
  };
  return { transport, asked };
}

describe('resolving a role’s credentials', () => {
  it('reads the variables for the role it was asked for', () => {
    const resolved = credentialsFor('design', environment());

    expect(resolved.appId).toBe('4588648');
    expect(resolved.installation).toBe('153578675');
    expect(resolved.repo).toBe('reveer-ai/jen');
  });

  // `pipeline-identity` requires a run hold exactly one role's credentials. The resolution
  // reading only the named role's is the first half of that; the second is `exec.ts`
  // stripping the rest out of the session's environment.
  it('reads nothing belonging to another role', () => {
    const env = environment();
    delete env.JEN_GH_APP_ID_DEV;
    delete env.JEN_GH_INSTALLATION_DEV;
    delete env.JEN_GH_PRIVATE_KEY_DEV;

    expect(() => credentialsFor('design', env)).not.toThrow();
  });

  it.each([
    ['JEN_REPO', 'JEN_REPO'],
    ['JEN_GH_APP_ID_DEV', 'JEN_GH_APP_ID_DEV'],
    ['JEN_GH_INSTALLATION_DEV', 'JEN_GH_INSTALLATION_DEV'],
    ['JEN_GH_PRIVATE_KEY_DEV', 'JEN_GH_PRIVATE_KEY_DEV'],
    ['LINEAR_API_KEY', 'LINEAR_API_KEY'],
    ['ANTHROPIC_API_KEY', 'ANTHROPIC_API_KEY'],
  ])('refuses when %s is absent, naming it', (variable, named) => {
    const env = environment();
    delete env[variable];

    expect(() => credentialsFor('dev', env)).toThrow(CredentialError);
    expect(() => credentialsFor('dev', env)).toThrow(named);
  });

  // An empty secret is what an unset repository secret expands to in a workflow, and it
  // would otherwise mint a token against an empty app id and fail much further along.
  it('treats an empty variable as absent', () => {
    expect(() => credentialsFor('dev', { ...environment(), JEN_GH_APP_ID_DEV: '   ' })).toThrow('JEN_GH_APP_ID_DEV');
  });

  it('refuses a repository that is not owner/name', () => {
    expect(() => credentialsFor('dev', { ...environment(), JEN_REPO: 'jen' })).toThrow(VARIABLES.repo);
  });

  it('names the variables per role', () => {
    expect(VARIABLES.appId('deliver')).toBe('JEN_GH_APP_ID_DELIVER');
    expect(VARIABLES.privateKey('design')).toBe('JEN_GH_PRIVATE_KEY_DESIGN');
  });
});

describe('the app JWT', () => {
  it('verifies against the public half of the key that signed it', () => {
    const [header, payload, signature] = appJwt('4588651', privateKey, Date.UTC(2026, 7, 23)).split('.');

    const verifier = createVerify('RSA-SHA256');
    verifier.update(`${header}.${payload}`);
    verifier.end();

    expect(verifier.verify(publicKey, signature!, 'base64url')).toBe(true);
  });

  it('claims RS256 and the app as issuer', () => {
    const now = Date.UTC(2026, 7, 23);
    const [header, payload] = appJwt('4588651', privateKey, now).split('.');

    expect(decode(header!)).toEqual({ alg: 'RS256', typ: 'JWT' });
    expect(decode(payload!).iss).toBe('4588651');
  });

  // The host rejects a token whose `iat` is in its own future, and a runner's clock is not
  // ours to trust. Backdating is the whole mitigation, so it is asserted rather than assumed.
  it('backdates iat and expires inside the ten minutes the host allows', () => {
    const now = Date.UTC(2026, 7, 23);
    const claims = decode(appJwt('4588651', privateKey, now).split('.')[1]!);
    const seconds = Math.floor(now / 1000);

    expect(claims.iat as number).toBeLessThan(seconds);
    expect((claims.exp as number) - seconds).toBeLessThan(600);
    expect((claims.exp as number) - seconds).toBeGreaterThan(0);
  });

  // A key crossing a secret store or a shell often arrives with its newlines escaped, and
  // `createSign` rejects that with a message about the key's format rather than its newlines.
  it('accepts a PEM whose newlines were escaped in transit', () => {
    const escaped = privateKey.replace(/\n/g, '\\n');

    expect(normalizeKey(escaped)).toBe(privateKey);
    expect(() => appJwt('4588651', escaped)).not.toThrow();
  });

  it('leaves a PEM that already carries real newlines alone', () => {
    expect(normalizeKey(privateKey)).toBe(privateKey);
  });

  it('refuses a key that is not a PEM, naming the variable', () => {
    expect(() => appJwt('4588651', 'not-a-key')).toThrow(CredentialError);
    expect(() => appJwt('4588651', 'not-a-key')).toThrow('JEN_GH_PRIVATE_KEY_<ROLE>');
  });
});

/** The three responses a successful mint reads, in the order the client asks for them. */
function minting(overrides: { app?: unknown; token?: unknown; bot?: unknown } = {}) {
  return stub(
    { body: overrides.app ?? { slug: 'reveer-jen-dev' } },
    { body: overrides.token ?? { token: 'ghs_recorded', expires_at: '2026-08-23T02:00:00Z' } },
    { body: overrides.bot ?? { id: 316769915 } },
  );
}

describe('minting the installation token', () => {
  it('exchanges the JWT and reports the identity the run commits under', async () => {
    const { transport, asked } = minting();

    const installation = await new GitHub({ transport }).installation(credentials());

    expect(installation.token).toBe('ghs_recorded');
    expect(installation.login).toBe('reveer-jen-dev[bot]');
    expect(installation.email).toBe('316769915+reveer-jen-dev[bot]@users.noreply.github.com');
    expect(asked[0]!.url).toMatch(/\/app$/);
    expect(asked[1]!.url).toMatch(/\/app\/installations\/153578694\/access_tokens$/);
    expect(asked[1]!.method).toBe('POST');
    expect(asked[2]!.url).toMatch(/\/users\/reveer-jen-dev%5Bbot%5D$/);
  });

  // The whole reason the third request exists. The two numbers belong to the same app and
  // nothing rejects the wrong one: an address built on the app id is delivered, accepted,
  // and attributed to nobody, so a run's commits render with an unlinked name and
  // `pipeline-identity`'s attribution quietly stops holding.
  it('addresses the commit by the bot user’s id rather than the app’s', async () => {
    const { transport } = minting();

    const installation = await new GitHub({ transport }).installation(credentials({ appId: '4588651' }));

    expect(installation.email).not.toContain('4588651+');
    expect(installation.email).toBe('316769915+reveer-jen-dev[bot]@users.noreply.github.com');
  });

  // Silence here would be the failure this refuses, so it raises rather than falling back to
  // the app id — an address that works everywhere except where it is read.
  it('raises when the host names no user id, rather than committing to an address that resolves to nobody', async () => {
    const { transport } = minting({ bot: { login: 'reveer-jen-dev[bot]' } });

    await expect(new GitHub({ transport }).installation(credentials())).rejects.toThrow('no user id');
  });

  // The app's own endpoints go under the JWT, which never leaves the client. The user lookup
  // is an ordinary read rather than an app endpoint, so it goes under the minted token —
  // which is scoped to this installation and expires on its own.
  it('authenticates the app’s endpoints as the app and the user lookup as the installation', async () => {
    const { transport, asked } = minting();
    await new GitHub({ transport }).installation(credentials());

    expect(asked[0]!.authorization).toMatch(/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);
    expect(asked[1]!.authorization).toMatch(/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);
    expect(asked[2]!.authorization).toBe('Bearer ghs_recorded');
  });

  // The failure this refuses is the same one `linear.ts` refuses one layer over: a
  // credential problem that presents as a session which simply did nothing.
  it('raises when the host refuses', async () => {
    const refused = () => stub({ status: 401, body: { message: 'A JWT could not be decoded' } }).transport;

    await expect(new GitHub({ transport: refused() }).installation(credentials())).rejects.toThrow(GitHubError);
    await expect(new GitHub({ transport: refused() }).installation(credentials())).rejects.toThrow('401');
  });

  it('raises when the host names no slug, rather than committing as `undefined[bot]`', async () => {
    const { transport } = stub({ body: {} });

    await expect(new GitHub({ transport }).installation(credentials())).rejects.toThrow('no slug');
  });

  it('raises when the exchange returns no token', async () => {
    const { transport } = minting({ token: { message: 'ok' } });

    await expect(new GitHub({ transport }).installation(credentials())).rejects.toThrow('minted no token');
  });

  it('raises when the host cannot be reached', async () => {
    const transport: Transport = async () => {
      throw new Error('ECONNREFUSED');
    };

    await expect(new GitHub({ transport }).installation(credentials())).rejects.toThrow('could not reach the git host');
  });

  it('raises on an unreadable body rather than returning a token-shaped nothing', async () => {
    const transport: Transport = async () => new Response('<html>502</html>', { status: 200 });

    await expect(new GitHub({ transport }).installation(credentials())).rejects.toThrow('unreadable JSON');
  });
});

describe('the clone URL', () => {
  // The username the host expects for an installation token, and nothing else. A token
  // spliced in here would be an argv element of `git clone`, readable by every process on
  // the host — the same exposure the tracker payload is written to a file to avoid.
  it('names the username the host expects and carries no credential', () => {
    expect(remoteUrl('reveer-ai/jen')).toBe('https://x-access-token@github.com/reveer-ai/jen.git');
  });
});
