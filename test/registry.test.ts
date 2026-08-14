import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

import { readRepoFile, trackedFiles } from './helpers.js';

type Resource = Record<string, unknown> & { name?: string; kind?: string };

const stub = readRepoFile('scaffold/registry.yaml');
const registry = readRepoFile('registry.yaml');
const resources = (parse(registry) as { resources: Resource[] }).resources;

function identities(surface: string): Resource[] {
  return resources.filter((entry) => entry.kind === 'identity' && entry.surface === surface);
}

describe('the registry stub', () => {
  it('documents the identity shape', () => {
    // The stub is read far more often than it is filled in by hand, so the shape has to be
    // legible from the file itself rather than only from the skill that writes it.
    expect(stub).toContain('kind: identity');
    for (const role of ['design', 'dev', 'deliver']) expect(stub).toContain(role);
  });

  it('still reads as unfilled', () => {
    // Documenting the identities must not accidentally declare one. `jen init` writes this
    // file once and never returns to it, so a stray entry here is permanent in every
    // project installed afterward.
    expect(stub).toContain('resources: []');
    expect((parse(stub) as { resources: unknown[] }).resources).toEqual([]);
  });

  it('says where credentials do not go', () => {
    expect(stub).toMatch(/never authenticates|no private key|never meet on disk/i);
  });
});

describe("jen's own registry", () => {
  it('keeps the stub\'s documenting comments', () => {
    // Recorded by editing the `resources:` entry in place. A YAML round-trip would strip
    // every comment here and reformat what it kept, which is most of the file's value.
    expect(registry).toContain('# Every resource this project\'s workflow acts on');
    expect(registry).toContain('kind: identity');
  });

  it('names every resource and says what kind it is', () => {
    for (const entry of resources) {
      expect(entry.name, `an entry has no name: ${JSON.stringify(entry)}`).toBeTruthy();
      expect(entry.kind, `${entry.name} has no kind`).toBeTruthy();
    }
  });

  it('carries one git-host identity per role', () => {
    expect(identities('git-host').map((entry) => entry.role).sort()).toEqual(['deliver', 'design', 'dev']);
  });

  it('carries exactly one tracker agent, belonging to no role', () => {
    const agents = identities('tracker');
    expect(agents).toHaveLength(1);
    // The asymmetry is the design, not an omission: three agents would differ only in the
    // name on a comment. A `role` here would be the first step back toward three.
    expect(agents[0]!.role).toBeUndefined();
  });

  it('records the repository each application is installed on', () => {
    const repositories = resources.filter((entry) => entry.kind === 'repository').map((entry) => entry.name);
    for (const identity of identities('git-host')) {
      expect(repositories, `${identity.name} is installed on an unregistered repository`).toContain(
        identity.installed_on,
      );
    }
  });

  it('carries no field that could hold a credential', () => {
    for (const entry of resources) {
      for (const key of Object.keys(entry)) {
        expect(key, `${entry.name} carries a ${key}`).not.toMatch(/key|secret|token|password|credential/i);
      }
    }
  });
});

describe('the repository', () => {
  // The registry names identities and the environment authenticates them, and the two never
  // meet on disk. This is the net under that rule: a tracked credential is published to
  // everyone who clones, and survives in history after it is deleted.
  const secrets: [string, RegExp][] = [
    ['a PEM private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
    ['a GitHub token', /\b(gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{20,})\b/],
    ['a Linear token', /\blin_(api|oauth)_[A-Za-z0-9]{16,}\b/],
  ];

  it('tracks no credential in any file', () => {
    for (const path of trackedFiles()) {
      const contents = readRepoFile(path);
      for (const [what, pattern] of secrets) {
        expect(pattern.test(contents), `${path} contains ${what}`).toBe(false);
      }
    }
  });
});
