Every task here is a tree change. Nothing needs a host permission, nothing mutates jen's `primary` ruleset, and no task is a human's — the design deliberately avoids the one experiment that would have required it (see `design.md`, Decision 2).

The tests in section 3 are not a verification pass on sections 1 and 2; they are the only thing holding the prose in place. Nothing at runtime reads any of it, so a claim that goes quiet when the wording drifts takes the gate with it. Write them against the same slicing discipline `test/merge-gate.test.ts` already uses — assertions land on the subsection they are about, not anywhere in the section, because two agreeing greps across a long section is how the last contradiction survived.

## 1. The skill

- [ ] 1.1 In `.claude/skills/setup-jen/SKILL.md`, extend *Read who is allowed to bypass it, not only what it requires* with the attribution step: an actor carrying an identifier and no name is resolved before it is judged, and `actor_type` alone never decides whether it is a role. Keep the existing paragraph on where the bypass list lives — the attribution instruction follows the read, it does not replace it.
- [ ] 1.2 Name the resolution: `/orgs/{org}/installations`, matching the actor's identifier against **both** the `app_id` and the installation `id` of each row, then comparing the resolved installation's `app_id` against the roles in `registry.yaml`. State why both fields — whether a ruleset's `Integration` `actor_id` carries an application id or an installation id is not established, and matching both makes the answer unnecessary. Cross-reference `.claude/skills/AGENTS.md` for why this endpoint and not the two named for the installation.
- [ ] 1.3 State the three answers explicitly: resolves to a role → gate not satisfied, name the role; resolves to an application that is no role → not a breach, and **name it anyway**; resolves to nothing → unattributed, gate not satisfied, name the identifier. The middle one is the report the task is named for, and the one a run will be tempted to leave silent.
- [ ] 1.4 Scope the obligation: attribution is owed only where the bypass list actually carries an application. An empty or human-only list has nothing to attribute, and a listing binding could not read does not withhold the gate in that case. Without this the instruction blocks a first binding on most repositories for a question none of them pose.
- [ ] 1.5 State the classic-path exemption: `bypass_pull_request_allowances.apps` returns objects already carrying `slug`, so an actor read that way is judged on that name with no second resolution. Put it beside the existing sentence documenting the same asymmetry for where the bypass list lives.
- [ ] 1.6 Confirm `actor_type: "User"` still reads as needing no attribution and that the human bypass stays untouched. The existing wording is likely already right — check it against the new paragraphs rather than rewriting it.
- [ ] 1.7 Re-read the whole subsection end to end afterward. The failure mode is a paragraph that contradicts one three paragraphs down while both read correctly alone; this section has produced exactly that before.

## 2. The spec

- [ ] 2.1 Apply the delta in `specs/project-binding/spec.md` to `openspec/specs/project-binding/spec.md` — the four added paragraphs on the merge-gate requirement and the seven added scenarios. This is `deliver-task`'s sync, not implementation's; the task is here so implementation confirms the delta is a clean MODIFIED block that will apply, not so it applies it early.
- [ ] 2.2 Verify the modified requirement's header text still matches the one in `openspec/specs/project-binding/spec.md` exactly. A MODIFIED block whose header has drifted loses the whole requirement at archive time, silently.
- [ ] 2.3 `npx openspec validate eng-175-attribute-a-bypass-actor-so-binding-can-say-whose-bypass-it --strict` passes.

## 3. The tests

- [ ] 3.1 Add a `describe` to `test/merge-gate.test.ts` for the attribution rule, slicing the *Read who is allowed to bypass it* subsection out of `gate` the way the file already slices `unattributed` and `breachInstruction`, so the assertions land on that subsection rather than anywhere in the section.
- [ ] 3.2 Assert the actor arrives unnamed and that type alone does not decide it — the claim that makes attribution necessary at all. A reader who loses this reads the rest as defensive ceremony.
- [ ] 3.3 Assert the resolution names `/orgs/{org}/installations` and matches on both identifier fields. Assert the reason travels with it: a single-field match is the regression, because it looks like a simplification and is an unverified assumption.
- [ ] 3.4 Assert all three answers survive, and specifically that the non-role case is named rather than passed over in silence. Collapsing three answers into two is the other likely drift, and the direction matters: silence on a non-role is merely unhelpful, silence on unattributed is the failure this change exists to remove.
- [ ] 3.5 Assert that an unattributed actor does not leave the gate satisfied, and that it is not reported as not-a-role. Two assertions, not one — the second is the specific misreading, and a test that only checks the gate outcome passes on wording that reports the actor as harmless.
- [ ] 3.6 Assert the scoping from 1.4: a bypass list with no application on it owes no attribution. This is the assertion that stops a later editor "tightening" the rule into one that blocks every first binding.
- [ ] 3.7 Assert the classic path is exempt, with the reason attached.
- [ ] 3.8 `npm test` and `npm run typecheck` both pass. Run the typecheck rather than inferring it from a green suite — see `test/AGENTS.md`.

## 4. The note

- [ ] 4.1 Extend the `/orgs/{org}/installations` note in `.claude/skills/AGENTS.md` with what this change added to it: the listing is also the decoder ring for a ruleset's bypass actors, and it carries both identifier spaces, which is what lets attribution work without the ruleset's own space being established. The note already ends on matching by `app_id` being the difference between verifying a role and verifying its neighbour — this is the same point reached from the gate rather than from the permission check, so extend it rather than adding a second note.
- [ ] 4.2 Record that jen's own `primary` ruleset carries no `Integration` bypass actor, so this repository cannot exercise the path its own skill now instructs. That is why the identifier space is unverified and why nothing here should be read as having observed it. A future session finding this note is the one most likely to assume the shipped instruction was tested against a real actor.
