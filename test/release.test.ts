import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { readRepoFile } from './helpers.js';

/**
 * Three assertions about the release workflow, and one thing they have in common: each
 * guards a line that looks like noise to a future reader, and each has a failure mode
 * that reports the wrong subsystem. Nothing else in the suite catches any of them, and
 * the pipeline cannot be exercised before it merges — so this file is the only place a
 * well-meaning cleanup gets caught.
 */

interface Step {
  name?: string;
  uses?: string;
  run?: string;
  with?: Record<string, unknown>;
}

interface Job {
  environment?: string;
  steps?: Step[];
}

const workflow = parse(readRepoFile('.github/workflows/release.yml')) as {
  jobs: Record<string, Job>;
};

const publish = workflow.jobs.publish;

describe('the release workflow', () => {
  it('has a publish job', () => {
    expect(publish, 'no `publish` job — the assertions below describe it').toBeDefined();
  });

  // Setting it makes `setup-node` write an `.npmrc` holding a placeholder token, and npm
  // prefers a token it can see over performing an OIDC exchange. The run then fails with
  // a 404 naming the package, as though it had never been published.
  it('sets up Node without a registry-url anywhere', () => {
    for (const [name, job] of Object.entries(workflow.jobs)) {
      for (const step of job.steps ?? []) {
        if (!step.uses?.includes('actions/setup-node')) continue;
        expect(
          Object.keys(step.with ?? {}),
          `${name} sets registry-url, which defeats the OIDC exchange`,
        ).not.toContain('registry-url');
      }
    }
  });

  // Provenance is generated automatically only while conditions this repository does not
  // fully control continue to hold. Demanded explicitly, losing one fails the run; relied
  // upon as a default, losing one publishes without provenance and still reports success.
  it('demands provenance explicitly on the publish', () => {
    const step = (publish?.steps ?? []).find((candidate) => candidate.run?.includes('npm publish'));
    expect(step, 'no step runs `npm publish`').toBeDefined();
    expect(step!.run).toContain('--provenance');
  });

  // The environment is what makes the branch a condition of the credential rather than of
  // the trigger: GitHub puts it in the OIDC claims and npm matches it against the trusted
  // publisher entry. Remove it and the pipeline keeps working, having silently dropped a
  // claim the registry was checking.
  it('runs the publish in the environment npm is told to require', () => {
    expect(publish?.environment).toBe('release');
  });
});
