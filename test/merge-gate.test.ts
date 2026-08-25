/**
 * The merge gate section of `setup-jen`, held to the claims a project's gate depends on.
 *
 * This section is the only thing standing between an adopter and a branch that reads
 * correctly and cannot be merged by the pipeline that reads it. Nothing at runtime checks
 * any of it: the skill is prose a session follows, the settings belong to the git host, and
 * a gate reported satisfied on a branch where delivery cannot merge produces green checks
 * and parked tasks rather than an error.
 *
 * The claims below are the ones with that property — each was learned by a repository being
 * wrong about its own gate, and each would go quiet if the wording drifted back.
 */
import { describe, expect, it } from 'vitest';

import { readRepoFile } from './helpers.js';

const skill = readRepoFile('.claude/skills/setup-jen/SKILL.md');
const gate = skill.slice(skill.indexOf('## The merge gate'));

describe('the gate requirement', () => {
  // The defect this change exists to fix. An enumeration of another party's settings is
  // correct when written and silently incomplete afterward — every later reading stays
  // accurate about the settings it names while the branch has moved past them, which is how
  // this repository came to carry a third breaching setting nobody had noticed. Stating the
  // bound is what makes a setting the host adds next year fail the check on arrival.
  it('is a bound on the effective requirement, not a list of setting names', () => {
    expect(gate, 'the bound itself').toMatch(/effective.{0,80}(above|more than).{0,40}one approv/is);
    expect(gate, 'the author exclusion is part of the bound').toMatch(/one approv[^.]{0,80}(non-author|other than the pull request)/is);
  });

  // Without this clause the section is a list of four rather than a bound with four
  // instances, and a reader meeting a fifth setting has no instruction covering it.
  it('binds settings it does not name', () => {
    expect(gate, 'an unnamed setting breaches on the same terms').toMatch(/whether or not it is named/i);
  });

  // The two that make the gate unsatisfiable by way of delivery's own push. They are the
  // reason the bound exists rather than merely examples of it, so they keep their reasoning.
  it("keeps the two settings delivery's own push walks into", () => {
    expect(gate, 'approval must postdate the last push').toMatch(/postdate the most recent push/i);
    expect(gate, 'why that one bites: deliver pushes, then merges').toMatch(/is a pusher and \*then\* a merger/i);
    expect(gate, 'stale reviews dismissed on push').toMatch(/[Dd]ismissing stale reviews on push/);
  });

  // The third instance, and the one a project carries without choosing it. Both properties
  // are load-bearing and neither implies the other: on by default is why it is present, and
  // inert at zero is why no repository holds evidence about it until the count goes up. A
  // reader told only that it exists will look for it, find it off, and conclude wrongly.
  it('names the unattributed-changes setting with both reasons it goes unnoticed', () => {
    expect(gate, 'the setting').toMatch(/unattributed/i);
    expect(gate, 'on by default').toMatch(/on by default/i);
    expect(gate, 'inert at a count of zero').toMatch(/inert at an approving-review count of zero/i);
  });

  // An application cannot join a team, so a team-scoped requirement is unsatisfiable by
  // every role at once — the same failure as the other three, arriving from a setting that
  // looks like the ordinary way to ask for a reviewer.
  it('names team-scoped required reviewers as a breach', () => {
    expect(gate, 'required reviewers by team').toMatch(/[Nn]aming required reviewers by team/);
    expect(gate, 'why: an application cannot join a team').toMatch(/application cannot join a team/i);
  });
});

describe('a setting whose reach binding cannot establish', () => {
  // The honest third answer. A run that collapses "I could not tell" into "the count reads
  // correct" reports the gate satisfied on a branch that may deadlock delivery, and that is
  // the one failure the pipeline cannot see from the inside.
  it('is reported as undetermined rather than resolved either way', () => {
    expect(gate, 'undetermined is the report').toMatch(/report it as undetermined/i);
    expect(gate, 'and is not a soft yes').toMatch(/undetermined is a third answer/i);
  });

  it('does not leave the gate satisfied on the configured count alone', () => {
    expect(gate, 'the count alone does not satisfy it').toMatch(/not report the gate as satisfied on the strength of the configured count alone/i);
    expect(gate, 'an undetermined setting is not one of the conditions holding').toMatch(/undetermined leaves the gate unsatisfied/i);
  });

  // Documentation is evidence about the setting, not about your branch — a setting
  // documented for one application may be implemented against any application acting as
  // itself, which every pipeline role is.
  it('is settled by observing a pull request the pipeline opened, not by reading the docs', () => {
    expect(gate, 'observation over reading').toMatch(/observation rather than reading/i);
    expect(gate, "the vehicle is the pipeline's own pull request").toMatch(/pull request the pipeline itself opened/i);
  });
});

describe("deliver's permission table", () => {
  // The table is what a project is registered against, and jen's own installation diverged
  // from it unnoticed because nothing gated on a pull request's result until this change.
  // Both permissions are here because the host reports that result two independent ways.
  it('asks for both ways the host reports a result', () => {
    const table = skill.slice(skill.indexOf('| `deliver` |'));
    expect(table.slice(0, table.indexOf('\n')), 'checks and statuses both').toMatch(/Checks: read.*Statuses: read/);
  });
});
