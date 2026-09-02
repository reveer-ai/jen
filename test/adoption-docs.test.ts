/**
 * The adopter's front page, held to the few claims that are load-bearing rather than to its
 * prose.
 *
 * Every one of these is a thing an adopter finds out the hard way when the documentation
 * does not say it: an edit lost to the next update, a schedule the git host switched off, a
 * pipeline they cannot work out how to stop, or a local runner they chose believing it took
 * the git host out of the picture. Nothing at runtime reports any of them.
 */
import { describe, expect, it } from 'vitest';

import { NAMESPACE, VARIABLES } from '../cli/github.js';
import { PAUSED_STATUS_NAME } from '../cli/linear.js';
import { STAGES } from '../cli/stages.js';
import { readRepoFile } from './helpers.js';

const readme = readRepoFile('README.md');

/** Where a heading or a phrase sits in the file, for the claims whose *order* is the point. */
function at(text: string): number {
  const index = readme.indexOf(text);
  expect(index, `README.md does not contain ${text}`).toBeGreaterThan(-1);
  return index;
}

describe('the ownership boundary', () => {
  it('is stated before the installation command', () => {
    expect(at('## What jen owns, and what you own')).toBeLessThan(at('npx jen init'));
  });

  // A file that reads as configuration is the likeliest one for an adopter to edit in place,
  // and the loss is the same as editing a skill — reached through a file they think is theirs.
  it('names the workflow as jen\'s, and the registry as where its values are changed', () => {
    const boundary = readme.slice(0, at('## Adopting jen'));

    expect(boundary).toContain('.github/workflows/jen.yml');
    expect(boundary).toMatch(/only managed file jen writes outside/);
    expect(boundary).toMatch(/registry\.yaml`, never in the workflow file/);
  });

  it('does not present unstamping as a way to keep an edit to a shipped skill', () => {
    expect(readme).toContain('Deleting the stamp does not claim it');
    expect(readme).toMatch(/no supported way to keep an edit to a skill jen currently ships/);
  });
});

/**
 * What a session receives, which the adopter is the only one who can supply.
 *
 * The failure this documentation prevents is quiet in both directions: a suite that cannot
 * reach its database because nobody said the runner's environment was where it comes from,
 * and a secret written into a declaration that was only ever meant to hold names.
 */
describe('the environment chapter', () => {
  const chapter = readme.slice(at('### 5. Give the stages'), at('### 6. Take a later version'));

  // Beside the permissions section deliberately: that one says a project's own checks must be
  // allowed to run, and this says how those same commands are given what they read.
  it('sits with the permissions guidance, and says what reaches a session', () => {
    expect(at('### 4. Grant the permissions the stages need')).toBeLessThan(at('### 5. Give the stages'));
    expect(chapter).toMatch(/set on the runner reaches every stage|reaches every stage's session/);
  });

  /**
   * The other way an adopter reads the passthrough as unconditional, and the more expensive one.
   *
   * §5 sits before the runner chapter, so a reader meets the words "the runner" before being told
   * there are two — and on the scheduled one nothing in this section works: Actions secrets are not
   * ambient, the job's `env:` block is a closed list, and the file holding it is managed. An adopter
   * who believes the section finds out when a stage dies at the first command that needed the name.
   */
  it('says which runner the passthrough is available on today', () => {
    expect(chapter).toMatch(/the local runner's today/);
    expect(chapter).toMatch(/scheduled runner cannot carry your variables/);
    expect(chapter).toContain('.github/workflows/jen.yml');
  });

  // An adopter who reads the passthrough as unconditional has been told the runner's role
  // keys are handed to every session, which is the opposite of what happens.
  it('names the namespace withheld from sessions, and that the credentials are in it', () => {
    expect(chapter).toContain(NAMESPACE);
    expect(chapter).toMatch(/never reaches a session/);
    expect(chapter).toMatch(/role credentials are inside it|credentials.{0,60}inside it/is);
  });

  it('gives the declaration that narrows a variable, under the name jen reads', () => {
    expect(chapter).toContain(VARIABLES.stageScope('test-task'));
    for (const stage of STAGES) expect(chapter, `${stage.skill} is never named`).toContain(VARIABLES.stageScope(stage.skill));
  });

  /**
   * The trap this assertion exists for, and the reason it counts.
   *
   * `JEN_ENV_TEST_TASK=STAGING_SSH_KEY` is indistinguishable at a glance from a variable
   * holding a key, so an example with one name in it teaches an adopter to paste their secret
   * into the declaration. Two names is what makes a list read as a list.
   */
  it('says the declaration holds names, and shows more than one of them', () => {
    expect(chapter).toMatch(/list of variable \*names\*, not values|names, not values/);

    const example = /JEN_ENV_TEST_TASK=(\S+)/.exec(chapter);
    expect(example, 'the chapter shows no declaration').not.toBeNull();
    expect(example![1]!.split(',').length, 'the example names one variable, which reads as a value').toBeGreaterThan(1);
  });

  // An adopter reasoning from the roles expects testing's variable to be kept from delivery
  // because of the identities. It is not — they are one identity — and only the declaration
  // arranges it.
  it('says the narrowing keys on the stage, and that three stages share one role', () => {
    expect(chapter).toMatch(/by stage, not by role|keys on the stage/);
    expect(chapter).toMatch(/Reviewing, testing, and delivering all act under the one `deliver` role/);
  });

  it('says a declaration that scoped nothing is reported rather than fatal', () => {
    expect(chapter).toMatch(/reported in the run's output and does not fail it/);
  });
});

describe('the runner chapter', () => {
  const chapter = readme.slice(at('## Running the pipeline'), at('## Which assistants this reaches'));

  it('presents both runners with what distinguishes them, and neither as the default', () => {
    expect(chapter).toContain('jen watch');
    expect(chapter).toContain('.github/workflows/jen.yml');
    expect(chapter).toMatch(/peers, not a default and a fallback/);
    expect(chapter).not.toMatch(/fall back to `jen watch`|the default runner/i);
  });

  // An adopter choosing the local runner to get away from the git host will assume the
  // pipeline follows them, and nothing about running it locally tells them otherwise.
  it('says the local runner does not remove the git host', () => {
    expect(chapter).toMatch(/does not remove GitHub from the pipeline/);
    expect(chapter).toMatch(/merge gate/);
  });

  it('names every credential a runner needs, under the name the runner reads', () => {
    const roles = [...new Set(STAGES.map((stage) => stage.role))];
    const needed = [
      VARIABLES.tracker,
      ...VARIABLES.model,
      ...roles.flatMap((role) => [VARIABLES.appId(role), VARIABLES.installation(role), VARIABLES.privateKey(role)]),
    ];

    for (const name of needed) expect(chapter, `${name} is never named`).toContain(name);
    expect(chapter).toContain('Eleven values');
  });

  // The symptom is silence, and quiet is what triggers it — so the only warning an adopter
  // can get is one written down before it happens.
  it('names the schedule a quiet repository loses, and how to get it back', () => {
    expect(chapter).toMatch(/60 days/);
    expect(chapter).toMatch(/public/);
    expect(chapter).toContain('gh workflow enable');
  });

  it('names what a session dying with its runner leaves on the task', () => {
    expect(chapter).toMatch(/sessions? (die|dies)|dies with the process/);
    expect(chapter).toMatch(/still working this|until a person moves it|not be picked up again/);
  });

  it('says what the pipeline does unsupervised, and what a human still owns', () => {
    expect(chapter).toContain('`Todo` → `In Design`');
    expect(chapter).toContain('`Pending` → `In Progress`');
    expect(chapter).toMatch(/parks anything only a person can settle/);
    expect(chapter).toContain('--concurrency');
  });

  it('documents the halt as the tracker\'s project status, under either runner', () => {
    const stopping = chapter.slice(chapter.indexOf('### Stopping it'));

    expect(stopping).toContain(PAUSED_STATUS_NAME);
    expect(stopping).toMatch(/halt under both runners/);
    expect(stopping).toMatch(/no schedule to delete, no process to stop, no task's status to edit/);
  });

  // The status is one the adopter creates, so naming it is not enough on its own — an
  // adopter who cannot find it in Linear has no halt, and nothing else about the pipeline
  // looks any different. The rename is the same class of silence, one step later.
  //
  // That binding cannot check it belongs in the same test: an adopter who reads
  // `setup-jen`'s report as a verification believes the halt was confirmed when nothing
  // confirmed it. Nothing in the pipeline verifies this status, so the sentence saying so
  // is what stands in place of the check.
  it('says where to create the pause status, and what renaming it costs', () => {
    const stopping = chapter.slice(chapter.indexOf('### Stopping it'));

    expect(stopping, 'the category it goes under').toMatch(/In Progress.{0,40}categor|categor.{0,40}In Progress/s);
    expect(stopping, 'where in Linear').toMatch(/workspace settings/i);
    expect(stopping, 'renaming it turns the halt off').toMatch(/rename.{0,80}(halt|silent)/is);
    expect(stopping, 'binding reports it rather than verifying it').toMatch(/cannot check|could not check/i);
  });
});
