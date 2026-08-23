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

describe('minting the installation token', () => {
  it('exchanges the JWT and reports the identity the run commits under', async () => {
    const { transport, asked } = stub(
      { body: { slug: 'reveer-jen-dev' } },
      { body: { token: 'ghs_recorded', expires_at: '2026-08-23T02:00:00Z' } },
    );

    const installation = await new GitHub({ transport }).installation(credentials());

    expect(installation.token).toBe('ghs_recorded');
    expect(installation.login).toBe('reveer-jen-dev[bot]');
    expect(installation.email).toBe('4588651+reveer-jen-dev[bot]@users.noreply.github.com');
    expect(asked[0]!.url).toMatch(/\/app$/);
    expect(asked[1]!.url).toMatch(/\/app\/installations\/153578694\/access_tokens$/);
    expect(asked[1]!.method).toBe('POST');
  });

  // Both requests go under the JWT, and the JWT never leaves the client. Only the minted
  // token does, and it expires on its own.
  it('authenticates both requests as the app', async () => {
    const { transport, asked } = stub({ body: { slug: 'reveer-jen-dev' } }, { body: { token: 'ghs_recorded' } });
    await new GitHub({ transport }).installation(credentials());

    for (const request of asked) {
      expect(request.authorization).toMatch(/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);
    }
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
    const { transport } = stub({ body: { slug: 'reveer-jen-dev' } }, { body: { message: 'ok' } });

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
  it('carries the token as the username the host expects', () => {
    expect(remoteUrl('reveer-ai/jen', 'ghs_recorded')).toBe(
      'https://x-access-token:ghs_recorded@github.com/reveer-ai/jen.git',
    );
  });
});
