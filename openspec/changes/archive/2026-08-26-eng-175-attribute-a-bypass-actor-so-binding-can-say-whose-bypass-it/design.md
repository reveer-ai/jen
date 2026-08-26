## Context

`setup-jen`'s merge-gate section carries the rule that no pipeline role may hold a bypass, and gives a run nothing with which to establish whether the actor in front of it is one. The section already tells a run *where* the list lives — the asymmetry between the two mechanisms is documented at length, because a run that reads only the classic endpoint finds no bypass field and reports the gate satisfied on a branch that hands a role the key. What follows that read stops at `actor_type`.

The evidence this design is built on was read from the host on 26 August 2026:

```
$ gh api repos/reveer-ai/jen/rulesets/20589957 --jq '.bypass_actors'
[{"actor_id":314685034,"actor_type":"User","bypass_mode":"always"}]

$ gh api /orgs/reveer-ai/installations --jq '.installations[] | {id, app_id, app_slug}'
{"app_id":4540486,"app_slug":"reveer-release","id":152506589}
{"app_id":1658531,"app_slug":"linear-code","id":153330446}
{"app_id":4588648,"app_slug":"reveer-jen-design","id":153578675}
{"app_id":4588651,"app_slug":"reveer-jen-dev","id":153578694}
{"app_id":4588653,"app_slug":"reveer-jen-deliver","id":153578706}
```

Two things follow. jen's own ruleset carries exactly one bypass actor and it is a human, so **this repository holds no `Integration` entry to read the shape from** — the case the rule exists for has never occurred here, which is why the gap survived two reviews. And the organization carries five installations of which three are roles, so the population that makes attribution necessary is real rather than hypothetical.

`registry.yaml` records `app_id` and `installation` for each of `design`, `dev`, and `deliver`. `.claude/skills/AGENTS.md` already establishes that `/orgs/{org}/installations` is the endpoint that answers under an ordinary token, after both endpoints named for the installation refuse with `401 A JSON web token could not be decoded` — they want a JWT signed with the application's private key, which no session holds. That note ends on exactly this point: matching by `app_id` is the difference between verifying a role and verifying whatever was installed next to it.

Binding is prose a session follows, not code. Nothing in `cli/` reads a bypass list, and this change adds nothing there. What holds the design is `test/merge-gate.test.ts`, which asserts against the skill's text for the same reason the rest of that file does.

## Goals / Non-Goals

**Goals:**

- A run can turn an unnamed bypass actor into a named application, and judge that against the roles the registry records.
- The report says *which* application holds a bypass, including when it is not a role.
- An actor that cannot be attributed leaves the gate unsatisfied rather than being read as harmless.
- The instruction survives an identifier space nobody here has verified.
- The claims that carry all of this are held by tests, since nothing at runtime checks any of them.

**Non-Goals:**

- Changing `pipeline-identity`. It states the invariant — no role may bypass, a human may — and the invariant is untouched. Only how binding establishes whether it holds is in scope.
- Removing a bypass actor, or altering a merge policy, on binding's own initiative. Everything here feeds the report; the existing rule that the user confirms every change is unchanged.
- Teaching the CLI to read a ruleset. Binding stays a skill.
- Settling what GitHub puts in a ruleset's `actor_id`. Decision 2 makes the answer unnecessary rather than finding it.

## Decisions

### 1. Resolve through the organization's installation listing, not straight against the registry

The registry already records `app_id` per role, so the smallest possible fix is to compare `actor_id` against those three integers and treat a miss as not-a-role. That was rejected on two counts.

It cannot name anything. A miss tells a run only that the actor is not one of the three, so the report degrades to *an application holds a bypass* — which leaves the user to go find out which, with the same integer binding just gave up on. The task exists so binding can say whose bypass it found, and a comparison against three ids structurally cannot.

It also makes the miss carry the unsafe reading. Compare-and-miss produces a negative that looks conclusive and is not: an application installed from outside the organization misses in exactly the same way `reveer-release` does, and nothing in the result distinguishes them.

Resolving first inverts both. `/orgs/{org}/installations` yields a name, and the comparison against the registry then happens on an installation binding has actually identified. A miss at the *resolution* step is a genuine unknown and is reported as one; a miss at the *comparison* step is a real answer, because binding knows what the application is.

**Alternative considered:** searching the host for an application by id (`/app/installations/{id}`, `/repos/{owner}/{repo}/installation`). Both refuse a session, per the note in `.claude/skills/AGENTS.md`, and the org listing is the established way through.

### 2. Match against every identifier the listing carries, so the identifier space need not be known

A ruleset's `bypass_actors` entry carries `actor_id` with `actor_type: "Integration"`. Whether that integer is an application id (`4588651`) or an installation id (`153578694`) is not established here, and jen's own ruleset carries no `Integration` entry to check it against. GitHub documents it as the application's id; documentation is evidence about the host's intent, and the merge-gate section's own standing rule — established by ENG-173 — is that a reach like this is settled by observation rather than by reading.

Making the observation would mean adding an application to jen's live `primary` ruleset bypass list, reading it back, and removing it: mutating the gate this repository just raised, on the repository that gates every task, to learn something the design can be built not to need.

The listing returns both `app_id` and `id` on every row. Matching the actor's identifier against both fields resolves the installation whichever space the value came from, because the two spaces do not collide across the rows of one listing. The question is not answered; it is made not to matter, which is the stronger position — an observation would have to be re-made if GitHub changed the field, and this does not.

The spec states this as a requirement rather than leaving it to the skill, because it is the part a later editor would most naturally "simplify" back into a single-field match.

**Trade-off:** a contrived collision — one installation's `app_id` equalling another's installation `id` within the same organization — would attribute to whichever matched first. Both are host-assigned from unrelated sequences and the listing is a handful of rows; against that, the alternative is an unverified assumption in the load-bearing direction.

### 3. `undetermined` is inherited, not invented

ENG-173 established a third answer for a setting whose reach binding cannot establish: not satisfied, not breaching, reported as undetermined, and not grounds for calling the gate satisfied on the strength of the count. An unattributable actor is the same shape of question — binding has read the branch correctly and cannot say what one entry means — so it takes the same answer rather than a new vocabulary.

Consistency here is worth more than the naming. The gate report already has a place for "I could not establish this", the section already tells a run that such an answer leaves the gate unsatisfied, and a second half-answer with different words would invite a reader to treat them as different kinds of doubt.

### 4. The obligation is scoped to a list that actually carries an application

The strict reading — *binding cannot report the gate satisfied unless it resolved the bypass list* — would make an unreadable installations listing block a first binding on a repository whose bypass list is empty or human-only, which is most of them. That is strictness with nothing behind it: there is no actor whose identity is in doubt.

So the requirement arises only where an application is on the list. `setup-jen` already says never to report a gate satisfied on the strength of a read that did not happen; this scopes that to the read that was actually needed. jen's own repository is the worked example — one human on the list, nothing to attribute, and a failure to reach `/orgs/{org}/installations` would change nothing about the report.

### 5. The classic path is exempt because it is already named

`bypass_pull_request_allowances.apps` returns full application objects carrying `slug` beside `id`. An actor read that way needs no resolution, and instructing one anyway would add a host call whose answer binding already holds — and would read, to a later editor, as though the name on the object were untrustworthy.

The section already documents this asymmetry for where the bypass list lives at all (classic hands it back on a read already made; a ruleset costs a second read against `/repos/{owner}/{repo}/rulesets/{id}`). Attribution follows the same seam, which makes it one asymmetry to hold rather than two.

## Risks / Trade-offs

**A ruleset's `Integration` `actor_id` is neither an application id nor an installation id** → Attribution misses, and the actor is reported unattributed with its identifier named. The failure lands on the safe side — gate unsatisfied, actor named, user asked — rather than on the silent one. This is the direct payoff of Decision 3 sharing Decision 2's fallback.

**An application is installed on the repository from outside the organization** → It resolves to nothing in the org listing and is reported unattributed. Correct but noisy: a user in that position gets a gate held open by an actor binding cannot name. Accepted, because the alternative reading is the failure this change exists to remove, and `setup-jen` is attended — the user can answer.

**The listing needs organization-level access the binding token may lack** → Reported unattributed under Decision 4's scoping, so it bites only when an application is genuinely on the bypass list. The report names the read that failed, so the user can see it is a permission problem rather than a hazard.

**The prose grows in a section that is already the longest in the skill** → Real cost, and the section is load-bearing precisely because people read it. Mitigated by keeping the attribution instruction inside the existing *Read who is allowed to bypass it* subsection rather than opening a new one, and by leaning on the vocabulary ENG-173 already established instead of introducing more.

**A later editor collapses the two-field match, or the three answers back into two** → The most likely regression, because both look like redundancy. This is what the tests in `test/merge-gate.test.ts` are for: each claim that would go quiet on a drift gets an assertion, in the style the file already uses.

## Migration Plan

None. Nothing is stored, no format changes, and binding is re-runnable by construction. A project bound before this change is re-bound by running the skill again, and the first run under the new instruction is the one that resolves the bypass list. A project whose gate was reported satisfied on an unattributed actor will now report it outstanding — which is the point, and is the only user-visible change in the report's shape.

## Open Questions

None blocking. One worth recording rather than resolving: if a future task ever needs the identifier space settled for its own reasons, the observation is cheap to make on a scratch repository with its own ruleset — which is where it belongs, rather than on the ruleset that gates this one.
