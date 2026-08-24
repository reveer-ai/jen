/**
 * The scheduled runner, as a file rather than as code.
 *
 * Nothing executes this in CI — its first run is on an adopter's repository, on a schedule,
 * with nobody watching — so the properties it is supposed to have are asserted here or
 * nowhere. Three of them are load-bearing and none of them is visible from a green build:
 * that the poll never checks the repository out, that it names only variables the CLI
 * actually reads, and that no placeholder can survive into it.
 */
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { VARIABLES } from '../cli/github.js';
import { payloadFiles, PLACEHOLDER, SUBSTITUTIONS } from '../cli/payload.js';
import { STAGES } from '../cli/stages.js';
import { readRepoFile } from './helpers.js';

const declared = payloadFiles().find(({ file }) => file.target === '.github/workflows/jen.yml')!;
const source = readRepoFile(declared.file.source);

interface Workflow {
  name: string;
  on: { schedule?: { cron: string }[]; workflow_dispatch?: unknown };
  permissions?: Record<string, string>;
  concurrency: { group: string; 'cancel-in-progress': boolean };
  jobs: Record<
    string,
    {
      'runs-on': string;
      'timeout-minutes'?: number;
      steps: { uses?: string; run?: string; env?: Record<string, string> }[];
    }
  >;
}

const workflow = parse(source) as Workflow;
const job = Object.values(workflow.jobs)[0]!;
const steps = job.steps;

describe('the shipped scheduled workflow', () => {
  it('is the file the payload declares, and ships to the path the git host fixes', () => {
    expect(declared.file.staged).toBe('workflows/jen.yml');
    expect(declared.file.substituted).toBe(true);
    expect(declared.stamped, 'a fixed path carries no stamp').toBe(false);
  });

  it('parses as YAML, and declares one job on a schedule that can also be asked for', () => {
    expect(workflow.name).toBeTruthy();
    expect(workflow.on.schedule?.[0]?.cron, 'the runner is a schedule').toMatch(/^\S+( \S+){4}$/);
    expect(workflow.on).toHaveProperty('workflow_dispatch');
    expect(Object.keys(workflow.jobs), 'the poll and its sessions are one job').toHaveLength(1);
  });

  // A tick that fired while one was running would poll the same tracker state twice and
  // bill for both. Cancelling instead would be worse: it kills a stage mid-session.
  it('queues a tick that falls due during one rather than running or cancelling it', () => {
    expect(workflow.concurrency['cancel-in-progress']).toBe(false);
    expect(workflow.concurrency.group).toBeTruthy();
  });

  // A liveness bound on the job, well under the host's six-hour ceiling, so a hung session
  // releases the runner instead of holding it until the ceiling.
  it('bounds how long a tick may hold the runner, below the host ceiling', () => {
    expect(job['timeout-minutes']).toBeGreaterThan(0);
    expect(job['timeout-minutes']!).toBeLessThan(360);
  });

  // The property that keeps a poll's cost flat as the repository grows, and the one most
  // likely to be undone by someone adding a step that needs the tree. The only checkout in
  // the pipeline is the one a stage session clones for itself.
  it('checks nothing out', () => {
    expect(source, 'the poll must not clone the repository').not.toContain('actions/checkout');
    for (const step of steps) expect(step.uses ?? '').not.toMatch(/checkout/);
  });

  it('installs the published CLI and runs one tick with it', () => {
    const commands = steps.map((step) => step.run ?? '').join('\n');
    expect(commands).toContain('@reveer/jen');
    expect(commands).toMatch(/\bjen run\b/);
    expect(commands, 'the loop is the schedule, not the CLI').not.toMatch(/\bjen watch\b/);
  });

  it('names only environment variables the CLI reads', () => {
    const roles = [...new Set(STAGES.map((stage) => stage.role))];
    const read = new Set([
      'JEN_TEAM',
      'JEN_PROJECT',
      VARIABLES.repo,
      VARIABLES.tracker,
      VARIABLES.model,
      ...roles.flatMap((role) => [VARIABLES.appId(role), VARIABLES.installation(role), VARIABLES.privateKey(role)]),
    ]);

    const supplied = steps.flatMap((step) => Object.keys(step.env ?? {}));
    for (const name of supplied) expect(read, `${name} is set and nothing reads it`).toContain(name);

    // Both directions: a role whose secrets were never wired fails at the first dispatch of
    // that stage and not before, which is late and looks like a broken stage.
    for (const name of read) expect(supplied, `${name} is read and nothing sets it`).toContain(name);

    const cli = readRepoFile('cli/cli.ts');
    for (const name of ['JEN_TEAM', 'JEN_PROJECT']) expect(cli).toContain(`env.${name}`);
  });

  it('takes every credential from the secret of the same name', () => {
    const env = Object.assign({}, ...steps.map((step) => step.env ?? {})) as Record<string, string>;
    for (const name of Object.keys(env)) {
      if (name === 'JEN_TEAM' || name === 'JEN_PROJECT' || name === VARIABLES.repo) continue;
      expect(env[name], `${name} must come from the secret of its own name`).toBe(`\${{ secrets.${name} }}`);
    }
    expect(env[VARIABLES.repo], 'the repository is the run\'s own, not a secret').toBe('${{ github.repository }}');
  });

  it('carries the project identity as substituted values, and nothing else', () => {
    const referenced = [...source.matchAll(PLACEHOLDER)].map((match) => match[1]!);
    expect(new Set(referenced), 'a name jen does not declare would render empty and look configured').toEqual(
      new Set(SUBSTITUTIONS),
    );

    // Quoted, so an empty value parses as an empty string rather than turning the mapping
    // into something the host reads as a syntax error.
    for (const name of SUBSTITUTIONS) expect(source).toContain(`"{{jen:${name}}}"`);
  });

  it('says it is jen\'s and names the registry as where its values are changed', () => {
    expect(source).toMatch(/jen update/);
    expect(source).toMatch(/registry\.yaml/);
  });
});
