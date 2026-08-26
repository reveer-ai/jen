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

// The unattributed-changes bullet and the instruction beneath the list, sliced out so the
// assertions below land on them rather than anywhere in the section. The contradiction this
// guards against was two agreeing greps apart: the bullet asserted a reach the observation
// three paragraphs down refutes, and both matched a search of the whole section.
const unattributed = gate.slice(
  gate.indexOf('- **Requiring an extra approval'),
  gate.indexOf('- **Naming required reviewers'),
);
const breachInstruction = gate.slice(
  gate.indexOf('Report a branch carrying any of them'),
  gate.indexOf('### Where you cannot establish'),
);

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
    expect(unattributed, 'the setting').toMatch(/unattributed/i);
    expect(unattributed, 'on by default').toMatch(/on by default/i);
    expect(unattributed, 'inert at a count of zero').toMatch(/inert at an approving-review count of zero/i);
  });

  // It is listed here as an instance of the bound, and whether it breaches *your* branch
  // turns on a reach this section cannot read — which is exactly what the observation two
  // sections down settles, the other way. A bullet that asserts the reach instead of
  // conditioning on it contradicts the same page: the taxonomy there defines Breaching as
  // reach established *and* the bound exceeded, and this setting fails the second half.
  it('conditions the unattributed setting on a reach it does not assert', () => {
    expect(unattributed, 'its effect is conditional on reach').toMatch(/wherever it applies/i);
    expect(unattributed, 'and the reach is named as the unreadable part').toMatch(/cannot read off the setting/i);
  });

  // The instruction under the list is what a run acts on, and it is reached before the
  // observation is. Unqualified it tells every adopter — the setting is on by default, so
  // that is all of them — to report the gate unsatisfied and propose turning off a setting
  // this repository deliberately left on, on the strength of the bullet above it.
  it('does not tell a run to turn off a setting an observation has settled', () => {
    expect(breachInstruction, 'the instruction is on the breach, not on the name').toMatch(
      /on the breach, not on the name/i,
    );
    expect(breachInstruction, 'finding this one is not yet finding a breach').toMatch(
      /not yet finding a breach/i,
    );
    expect(breachInstruction, 'and a setting settled as not reaching stays on').toMatch(
      /leave the setting on and say so/i,
    );
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

describe('the recorded observation the section ships', () => {
  const observed = gate.slice(gate.indexOf('### One observation is already recorded'));

  // Without this section the rule above has no exit at binding time: the setting is on by
  // default, its reach is unreadable, what settles it is a pull request the pipeline opened,
  // and a project being bound has never opened one. Every adopter's first run would report
  // the gate unsatisfied with no move available that changes it. The section exists to say
  // so, so a later editor cannot delete it as redundant with the rule it qualifies.
  it('says why a project being bound cannot settle the question itself', () => {
    expect(gate, 'the section is present').toContain('### One observation is already recorded');
    expect(observed, 'a project being bound has no pull request to observe').toMatch(/project \*being bound\* has never had/i);
    expect(observed, 'and what that costs it without this section').toMatch(/no move available that changes it/i);
  });

  // The whole difference between this and the assumption the section refuses is the
  // provenance travelling with the answer. An observation stripped of when and against what
  // it was made is a conclusion, and a conclusion cannot be told from an assumption.
  it('carries its provenance: host, date, vehicle, and the state it was made against', () => {
    expect(observed, 'host and date on the face of it').toMatch(/GitHub, \d{1,2} \w+ \d{4}/);
    expect(observed, 'the vehicle was authored by an application acting as itself').toMatch(/application acting as itself/i);
    expect(observed, 'the repository state: the count had been raised off zero').toMatch(/count raised from `0` to `1`/);
    expect(observed, 'the setting was still on while it was observed').toMatch(/require_extra_approval_for_unattributed_changes` left `true`/);
    expect(observed, 'what actually flipped').toMatch(/on \*\*one\*\* approving review/);
  });

  // The instruction that keeps a shipped observation from ageing into the standing
  // assumption this task's own history is made of.
  it('instructs a run to cite it rather than restate it as a conclusion', () => {
    expect(observed, 'cite, do not conclude').toMatch(/[Cc]ite it; never restate it as a conclusion/);
    expect(observed, 'evidence about an implementation at a moment').toMatch(/evidence about an implementation at a moment/i);
  });

  // Three answers, not two and not one. Collapsing them either way is a defect: settled
  // where nothing was observed is the assumption; undetermined where something was blocks
  // every first binding.
  it('gives the report three shapes and keeps undetermined for what no observation covers', () => {
    expect(observed, 'settled by observation is a distinct answer').toMatch(/\*\*Settled by observation\.\*\*/);
    expect(observed, 'and it does not hold the gate open').toMatch(/does not hold the gate unsatisfied/i);
    expect(observed, 'undetermined survives for a setting nothing covers').toMatch(/no observation behind it/i);
    expect(observed, 'and that one still does hold the gate open').toMatch(/it does hold the gate unsatisfied/i);
    expect(observed, 'breaching stays the third').toMatch(/\*\*Breaching\.\*\*/);
  });

  // The observation is about one host's implementation. Carrying it to another host would be
  // the same promotion of evidence into assumption, one level out.
  it('does not transfer to a different git host', () => {
    expect(observed, 'a different host is a different implementation').toMatch(/different git host is a different implementation/i);
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
