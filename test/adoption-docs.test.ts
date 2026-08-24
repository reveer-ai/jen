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

import { VARIABLES } from '../cli/github.js';
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
      VARIABLES.model,
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
  it('says where to create the pause status, and what renaming it costs', () => {
    const stopping = chapter.slice(chapter.indexOf('### Stopping it'));

    expect(stopping, 'the category it goes under').toMatch(/In Progress.{0,40}categor|categor.{0,40}In Progress/s);
    expect(stopping, 'where in Linear').toMatch(/workspace settings/i);
    expect(stopping, 'renaming it turns the halt off').toMatch(/rename.{0,80}(halt|silent)/is);
  });
});
