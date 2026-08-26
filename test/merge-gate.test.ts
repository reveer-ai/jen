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

// The bypass subsection, sliced for the same reason: its claims are about who may step
// around the gate, and a match anywhere in `gate` would let an assertion pass on the
// approving-review prose two subsections up.
const bypass = gate.slice(
  gate.indexOf('### Read who is allowed to bypass it'),
  gate.indexOf("### Changing it is the user's call"),
);

// The paragraph a run acts on when it decides whether to change anything. It is reached
// after the subsection above and states the satisfied case as three conditions holding, so
// it is where an attribution rule stated correctly upstream gets quietly undone.
const decision = gate.slice(
  gate.indexOf("### Changing it is the user's call"),
  gate.indexOf('If it does not, present the'),
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

describe('attributing a bypass actor', () => {
  // Why the step exists at all. A ruleset hands back an identifier and a type, and the type
  // says only that the actor is *an* application — so a run that judges on the type is
  // deciding the question on the one field that cannot answer it. A reader who loses this
  // reads everything below as defensive ceremony and simplifies it away.
  it('says the actor arrives unnamed, so its type cannot decide it', () => {
    expect(bypass, 'the entry carries an identifier and no name').toMatch(/and nothing more/i);
    expect(bypass, 'the type says an application, never which one').toMatch(/never tells you \*which\*/i);
    expect(bypass, 'so the type alone never settles it').toMatch(/never settle it on `actor_type` alone/i);
  });

  // Both misreadings are named because they fail in opposite directions and only one of
  // them is visible: too strict stops the pipeline where someone can see it, too loose
  // leaves every check green over a requirement that no longer binds.
  it('names both misreadings and which one is graver', () => {
    expect(bypass, 'reading every Integration as a role is an intrusion').toMatch(
      /never a hazard/i,
    );
    expect(bypass, 'reading none of them as a role hands a role the key').toMatch(
      /reports the gate \*\*satisfied\*\* on a branch that hands a role the key/i,
    );
    expect(bypass, 'and the silent one is the graver').toMatch(/the graver one/i);
  });

  // The resolution itself. Both identifier fields are load-bearing: the ruleset's identifier
  // space is not established here, and matching one field is an assumption that fails in the
  // direction nothing catches. The reason has to travel with the instruction, because
  // without it the two-field match reads as redundancy and gets collapsed.
  it('resolves through the org listing on both identifier fields, with the reason attached', () => {
    expect(bypass, 'the endpoint that answers a session').toMatch(/\/orgs\/\{org\}\/installations/);
    expect(bypass, 'matched against both fields, not one').toMatch(
      /\*\*both\*\*[^.]{0,60}`app_id`[^.]{0,60}installation `id`/i,
    );
    expect(bypass, 'then compared against the roles the registry records').toMatch(/registry\.yaml/);
    expect(bypass, 'why both: the identifier space is unverified').toMatch(/not established here/i);
    expect(bypass, 'and why one field is the regression, not a tidy-up').toMatch(
      /unverified assumption in the direction that fails silently/i,
    );
  });

  // Which organization `{org}` stands for. The skill establishes three sections up that the
  // organization owning a repository is not always the one owning its automation, so a bare
  // `{org}` has two candidates and no rule. The wrong one fails in the direction that looks
  // right: installations live on the organization they were installed into, so listing the
  // app-owning organization returns rows that cannot contain this repository's installation
  // and every actor resolves to nothing — the gate held open on a false reason, with nothing
  // the user can do to the actor that clears it. jen's own registry has one organization
  // owning both, which is why nothing here would catch it in use.
  it('names the repository as the organization the listing is read on', () => {
    expect(bypass, 'the organization is the repository\'s').toMatch(
      /organization that owns \*\*this repository\*\*/i,
    );
    expect(bypass, 'and explicitly not the one owning the applications').toMatch(
      /not the one that owns the applications/i,
    );
    expect(bypass, 'with the reason the wrong one cannot answer').toMatch(
      /cannot contain this repository's installation/i,
    );
  });

  // Three answers, not two. Collapsing them is the likely drift and the direction matters,
  // which is why the next two tests split the third answer out from this one.
  it('keeps all three answers, and names the application that is not a role', () => {
    expect(bypass, 'three answers are stated as three').toMatch(/three answers/i);
    expect(bypass, 'resolves to a role').toMatch(/It resolves to a role/);
    expect(bypass, 'resolves to something that is no role').toMatch(/no role records/i);
    expect(bypass, 'resolves to nothing').toMatch(/It resolves to nothing/);
    // The report the task is named for. Silence here is merely unhelpful rather than
    // dangerous, which is exactly why a later editor drops it as noise.
    expect(bypass, 'a non-role bypass is named, not passed over').toMatch(/name it anyway/i);
    expect(bypass, 'and why naming it is the whole point').toMatch(/is a different report from/i);
  });

  // Two assertions rather than one. A test that checked only the gate outcome would pass on
  // wording that reports the actor as harmless and withholds the gate for some other reason
  // — and reporting an unattributed actor as not-a-role is the specific misreading this
  // change exists to remove.
  //
  // The naming obligation is held here for a different reason: it is the kind of clause a
  // later tightening pass drops as wordy. Without it, a listing that came back without the
  // application and a listing that never came back produce the same line — and they are
  // cleared by different things, so the report would name an outstanding item with no way
  // to act on it. The precedent it inherits from, *Where you cannot establish a setting's
  // reach*, carries the same pairing: name it, and say what could not be established.
  it('does not let an unattributed actor leave the gate satisfied, or read as not-a-role', () => {
    expect(bypass, 'unattributed is the report').toMatch(/\*\*unattributed\*\*/i);
    expect(bypass, 'and it names the identifier it could not resolve').toMatch(
      /name the identifier you could not resolve/i,
    );
    expect(bypass, 'and says what it could not establish, not only which identifier').toMatch(
      /say what you could not establish about it/i,
    );
    expect(bypass, 'the two causes are distinguished, since they clear differently').toMatch(
      /absent from a listing you read and a listing you could not read/i,
    );
    expect(bypass, 'the gate does not stay satisfied while one stands').toMatch(
      /do not report the gate as satisfied while one stands/i,
    );
    expect(bypass, 'and not-a-role is called out as the unsafe default').toMatch(
      /not-a-role is the unsafe default/i,
    );
  });

  // The scoping that stops the rule from blocking every first binding. Without it the strict
  // reading — never report the gate satisfied without resolving the list — withholds the
  // gate on repositories whose list poses no question at all, which is most of them.
  it('owes an attribution only where the list carries an application', () => {
    expect(bypass, 'the obligation is scoped to a list with an application on it').toMatch(
      /only where the list actually carries an application/i,
    );
    expect(bypass, 'a human-only or empty list has nothing to attribute').toMatch(
      /carrying only humans, has nothing to attribute/i,
    );
    expect(bypass, 'so an unreadable listing does not withhold the gate there').toMatch(
      /changes nothing about the report/i,
    );
    expect(bypass, 'never withhold over a resolution that was not needed').toMatch(
      /never needed to make/i,
    );
  });

  // The exemption, with its reason. Instructing a resolution here would add a host call whose
  // answer binding already holds, and would read as though the name on the object were not
  // to be trusted.
  it('exempts the classic path because it hands back a name already', () => {
    expect(bypass, 'the classic path needs no attribution').toMatch(/classic path needs none of this/i);
    expect(bypass, 'because the objects carry a slug').toMatch(/`slug` beside `id`/);
    expect(bypass, 'so it is judged on that name with no second resolution').toMatch(
      /no second resolution/i,
    );
  });

  // Without this the subsection above is contradicted three paragraphs down: the satisfied
  // case reads "lists none of the three roles as a bypass actor", which a run reaches by
  // never resolving anything. An unattributed actor has to hold the gate here too, or the
  // attribution rule is stated in one place and spent in another.
  it('does not let the decision paragraph reach not-a-role without attributing', () => {
    expect(decision, 'an unattributed actor holds the gate open here too').toMatch(
      /bypass actor you could not attribute/i,
    );
    expect(decision, 'and none-of-the-three is a conclusion, not a default').toMatch(
      /only reached once every application on the list resolved to something/i,
    );
  });

  // The human bypass predates this change and has to survive it: the rule turns on the actor
  // being a human, so there is no "which human" to resolve and nothing to attribute.
  it('leaves the human bypass needing no attribution', () => {
    expect(bypass, 'a human bypass stays put').toMatch(/leave it exactly where it is/i);
    expect(bypass, 'and is judged on being a human, not on which human').toMatch(
      /not on which human/i,
    );
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
