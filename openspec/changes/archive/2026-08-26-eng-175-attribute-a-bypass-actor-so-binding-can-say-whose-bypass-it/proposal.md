## Why

`project-binding` says binding reads which actors may bypass the approving-review requirement and reports the gate as insufficient when any of the pipeline's roles holds one. The rule is absolute and correct — a role that can bypass the gate is a role the gate does not constrain — and the spec says nothing at all about how a role is recognised.

Nothing recognises one. A ruleset's `bypass_actors` carries `actor_id` and `actor_type` and no name, so an application arrives as a bare integer:

```json
[{"actor_id": 314685034, "actor_type": "User", "bypass_mode": "always"}]
```

That is jen's own `primary` ruleset, read on 26 August 2026 — one human, which the rule preserves. The case the rule exists for arrives as `{"actor_id": <integer>, "actor_type": "Integration"}` and nothing more. `reveer-ai` carries five installations and two of them — `reveer-release` and `linear-code` — are not pipeline roles. At the moment a run has to decide, that integer is indistinguishable from `dev`.

Both available readings are wrong. Treating every `Integration` as a role reports the gate unsatisfied on a branch that is fine, and proposes removing an actor that was never a hazard — an intrusion into a merge policy jen does not own. Treating none of them as a role reports the gate **satisfied** on a branch that hands `dev` the key: every check green, the requirement inert, and the pipeline unable to see it from the inside. That second failure is the one ENG-173 was about, arriving from a different direction, and it is worse than a gate that is merely too strict because a too-strict gate stops the pipeline visibly.

This survived two reviews without either judging it blocking, and both were right to — `setup-jen` runs attended, and its own rule to report what it found rather than repair it turns the ambiguity into a question to the user rather than a wrong conclusion. What that mitigation does not do is make the instruction sound. It survived as a comment on ENG-173, two `implement-task` comments, and a PR thread, none of which is a task anyone gets dispatched against.

## What Changes

**Binding attributes a bypass actor before reporting it.** The step between reading the list and judging it is new: an actor is resolved to the application it names, and the judgement is made against that rather than against `actor_type`. Reading correctly and attributing wrongly is the failure, so the read alone was never the whole obligation.

**Attribution goes through the organization's installation listing.** `/orgs/{org}/installations` returns every installation with its `app_id`, its installation `id`, and its `app_slug`, under an ordinary token — already established in `.claude/skills/AGENTS.md`, where it is the endpoint that works after the two named for the installation both answer `401`. Matching the integer against an installation yields a name, and that installation's `app_id` compares against the roles `registry.yaml` already records.

Resolving through the listing rather than straight against the registry is what lets binding **say whose bypass it found** — `reveer-release holds a bypass, which is not a pipeline role` is a different report from `an application holds a bypass`, and only the first tells the user whether to act. It also removes an assumption nothing here has verified: whether a ruleset's `Integration` `actor_id` carries an application id or an installation id. The listing carries both fields, so matching against either resolves the actor without the question needing an answer. No observation is owed, because nothing turns on which it is.

**An actor binding cannot attribute is `undetermined`, not not-a-role.** An `Integration` matching no installation in the listing — installed from outside the organization, or a listing binding could not read — leaves the gate unsatisfied and is named as unattributed. Reporting it as not-a-role is the unsafe default, and it is precisely the reading that produces green checks over an inert requirement. ENG-173 established `undetermined` as a real third answer for a question binding cannot settle; this is the same shape, and it inherits the same treatment: not a soft yes, and not grounds to report the gate satisfied on the strength of the count.

**The classic path needs none of this.** `bypass_pull_request_allowances.apps` hands back full application objects carrying `slug` alongside `id`, so an actor read that way is already named. The attribution step is scoped to where the payload is a bare id, which is the ruleset path — the same asymmetry the section already documents for where the bypass list lives at all.

**A human bypass is untouched by all of it.** `actor_type: "User"` needs no attribution to be judged, because the rule turns on it being a human rather than on which human. Somebody has to be able to break the glass.

## Capabilities

### Modified Capabilities

- `project-binding`: the gate requirement gains what it is silent on — that binding attributes a bypass actor to a named application before judging it, what it attributes against, and that an actor it cannot attribute is reported as undetermined and leaves the gate unsatisfied.

`pipeline-identity` is **not** modified. It states the invariant — no role may bypass, a human may — and that invariant is unchanged. What changes is how binding establishes whether it holds, which is `project-binding`'s to say.

## Impact

- `openspec/specs/project-binding/spec.md` — the merge-gate requirement's bypass paragraph and its scenarios.
- `.claude/skills/setup-jen/SKILL.md` — the gate section's *Read who is allowed to bypass it* subsection, which today tells a run where the list lives and stops short of telling it what the entries mean.
- `test/merge-gate.test.ts` — which already holds this section's load-bearing prose, and holds it for the same reason: nothing at runtime checks any of it, so a claim that goes quiet when the wording drifts takes the gate with it.
- No CLI code. Binding is a skill a session follows, not a command, and this changes what that session is instructed to read.
- Every later binding run reports a bypassing application by name, and a first run against an organization whose installations binding cannot list now reports the gate outstanding where it previously reported it satisfied.
