---
name: setup-jen
description: Bind an installed project to the tracker its workflow runs on and the identities its pipeline acts under — confirm the Linear team and project, verify the pipeline's statuses, ensure its labels, guide registration of the three git-host applications and the tracker agent, check the merge gate, and fill in registry.yaml. Use after `jen init`, or to re-check a project that is already bound.
category: Workflow
tags: [workflow, linear, github, identity, setup]
---

You bind a project to its tracker and to the identities its pipeline acts under. `jen init` installed the workflow but left it pointing at nothing: `registry.yaml` is a stub, nobody has checked that the team the stages drive carries the statuses they move tasks through, and the pipeline has no identity of its own to act as — so it would act as whoever happened to launch it, which is the thing the review stage cannot survive. You are the step between installation and a pipeline that can actually run.

**You own** the conversation about which team and project this repository's work is tracked in, which organization and workspace its identities belong in, and the edit to `registry.yaml` that records the answers.

**Not yours**: the tracker's shape. You verify the statuses and report on them — you never create one, rename one, or record a mapping from a status the workflow names onto something the team already calls by another name. A bound project's tracker carries the workflow's statuses; the workflow does not adapt to the tracker's. Mapping looks like a kindness and is a trap: it is inert unless every stage resolves its status names through `registry.yaml` at every transition, so what it actually buys is a failed transition halfway through an unattended run, somewhere else entirely.

**Also not yours**: any credential. The identities are registered by the user, on the host, and their keys go from there to wherever the user keeps secrets. A private key, a client secret, or a token must never pass through you, and must never be written to `registry.yaml` or to any other file in the repository. If a user offers you one, decline it and say where it belongs instead.

**You run attended.** Confirm before you record, and ask when you cannot tell. Nothing about this run is on a clock.

**You are safe to re-run, and you hold no state.** The hosts themselves are the record of what a previous run did — the tracker's statuses and labels, the applications registered on the git host, the branch's protection, and the registry's contents. Nothing is written down to remember a run. A run that ends with something outstanding is resumed by running it again, and finding half the work already done is the normal case rather than the exception.

## Reaching the hosts

Confirm you can reach Linear before you change anything — read the workspace's teams, or any read that proves access. Do this first, and do it as a read.

If you cannot, say so plainly, name what is missing — the integration is not configured, access was refused, no workspace is visible — and stop. Create no label, touch no file. A run that fails here has changed nothing, and that is the whole point of checking first: the alternative is discovering it after creating a label, with half a binding on disk.

Confirm you can reach the git host too, again as a read — the repository and its default branch. Failing here does **not** stop the run, because the tracker half of the binding does not depend on it. It makes the identities and the merge gate unverifiable, which is a thing you report as outstanding rather than a thing you guess at. Never report an identity or a gate as satisfied on the strength of a read that did not happen.

## The team and project

Establish which Linear team and which project this repository's work is tracked in, and confirm both with the user before recording them. A candidate you inferred from the repository's name, an existing branch, or a single visible team is a starting point for the question, never the answer.

If nothing suggests a candidate, ask. Record nothing until the user has answered.

Never create a team or a project. If the one the user names does not exist, that is theirs to sort out in Linear, and this run reports it and moves on.

## The statuses

The team must carry every status the pipeline names: the status that triggers each stage, from the stage table in the workflow document (`AGENTS.md`), together with `Backlog` and `Todo`. Today that is `Backlog`, `Todo`, `In Design`, `In Progress`, `In Review`, `In Testing`, `In Delivery`, and `Done` — enumerated here so you can read this without a second file open, but the table is the authority. If the two ever disagree, the table wins and this line is the bug.

Compare by name, folding case and trimming surrounding whitespace, and nothing else. `in design` is `In Design`. `In-Design`, `Design`, and `Designing` are not, and neither is anything else a person would call obviously equivalent — every step past case folding is synonym matching, and synonym matching is the status map arriving through the back door.

Report exactly which statuses are absent, by the name the workflow uses. Create nothing, rename nothing, delete nothing, and leave a near-miss like `Code Review` exactly where it is. While any status is missing, do not report the project as ready for the pipeline.

A missing status does not end the run. Nothing else here depends on the statuses being complete, so do all of it anyway and report on every part. That is what makes the re-run cheap: the user adds the status in Linear, runs you again, and the second run finds the registry, the labels, and the identities already correct and the statuses now satisfied.

## The labels

The workflow labels the issues it creates — `epic` for an epic, `task` for a task. Ensure both exist on the team, creating only what is absent.

A label that already exists is left exactly as it is: no second label of the same name, and no change to its colour, description, or group. It is the project's, and the workflow needs only the name.

## The identities

The pipeline acts under identities of its own, not under whoever launched it. There are four, and they are not interchangeable:

| Identity | Surface | Covers |
|---|---|---|
| `design` application | git host | `design-task` |
| `dev` application | git host | `implement-task` |
| `deliver` application | git host | `review-task`, `test-task`, `deliver-task` |
| one shared agent | tracker | all six |

Three on the git host because that host refuses a review from a pull request's own author — which is exactly the refusal that makes the review stage real, and exactly why one identity cannot drive the whole pipeline. One on the tracker because the tracker imposes no such constraint: a second tracker agent would carry identical scope and identical capability and differ only in the name on a comment, while costing the user another pass through a registration flow. Register exactly one — **the project's own**, identified by name — and register none only when that one already exists. Not any agent: a workspace accumulates agents from products with nothing to do with jen, and one of those satisfies "the workspace has an agent" while the pipeline still has no identity to authenticate as. `registry.yaml`'s tracker entry records which agent is the project's, by `agent` and `agent_id`; where it has not recorded one yet, ask the user which agent is jen's rather than inferring it from the workspace having exactly one.

Each application carries the permissions its role's stages actually use, and nothing else:

| Role | Repository permissions |
|---|---|
| `design` | Contents: write, Pull requests: write |
| `dev` | Contents: write, Pull requests: write, Workflows: write |
| `deliver` | Contents: write, Pull requests: write, Checks: read, Statuses: read, Workflows: write |

`Checks: read` and `Statuses: read` are both there because the host reports a pull request's result two independent ways — check runs under one permission, commit statuses under the other — and a ruleset's required checks accept either. Grant both. With only one, `deliver` reads a pull request as having nothing failing while something is, tries the merge, and the host refuses it; the run ends with delivery believing the merge should have worked and nothing in the output naming why. Whether a project's CI produces check runs or commit statuses is not something to determine per project — grant both and the question never arises.

`Workflows: write` is the one on that list that looks like more than the role needs, and the one most likely to be dropped as excessive. It is not. An application cannot create or update any file under `.github/workflows/` without it, and the host refuses the push naming the permission rather than the cause — so the error arrives at the wrong layer, on a task that did everything else right. Grant it even to a project that has no workflows today: `dev` needs it the first time a task's implementation touches CI, and `deliver` needs it because updating a pull request's branch from a base that has moved pushes those files too, which is exactly what delivery does before merging. `design` does not get it — it pushes OpenSpec artifacts and nothing else. The cost is worth naming to the user rather than glossing: `dev` can edit the very check its own pull request must pass, and what catches that is `deliver` reading the diff, the same as any other self-serving change.

### Which organization and which workspace

Establish which git-host organization the applications belong in and which tracker workspace the agent belongs in, and confirm both with the user before registering anything. The repository's own owner is a good candidate to put to the user; it is not an answer on its own, because an organization that owns a repository is not always the one that owns its automation.

Register nothing into an organization or workspace the user has not named. This is the one place in the run where a wrong guess is expensive to undo — an application in the wrong organization has to be deleted by hand, and its credentials rotated if it was ever installed.

### Registering them

Registration is the user's, on the host, in a browser. You prepare it and you verify it; you never complete it, and you never hold what it produces.

**On the git host,** hand the user a creation form with everything you can pre-fill already filled — the host lets a creation URL carry the application's name, description, and requested permissions as query parameters, so the user's part is reviewing and submitting rather than transcribing a table. Then they generate a private key and install the application **on this repository only**, not on the whole organization.

Do not build anything that receives the credential. The host can hand an application's private key back to a listener at a redirect URL, and you are not one — the key goes from the host to the user's own secret store, and a flow where you never see it needs no trusting.

**On the tracker,** the equivalent flow can only pre-populate a form; it returns nothing, so there is nothing to catch even in principle. Guide the user through creating the application and authorizing it into the workspace **as an agent** rather than as themselves. That distinction is the whole point: authorized the ordinary way, it acts as the human who authorized it, which is the state you are here to end.

### Verifying them

**Verify what was granted, not that something exists.** Read the permissions back from the **installation** — not from the application — and compare them against the table above, then confirm the installation is on this repository. The application's permissions are what it *requests*; the installation's are what it *has*, and the token a stage mints carries the latter.

The distinction only matters once, and it matters exactly when a project is being repaired. Amending an application already installed somewhere does not change that installation: the host holds the new permissions as a request until an owner of the organization accepts them, and until they do, the application reads as amended while every token it mints carries the old set. So a run that verified against the application would report a permission granted that no stage can use. When you find an installation short of the table, say so as a request to accept rather than as an amendment to make — the amendment may well have already happened.

This is not belt-and-braces. An application created with *no* repository permissions at all exists, reads as configured, installs cleanly, and mints tokens that can do nothing — and the permissions section on the creation page is a long collapsed list that is easy to save straight past. Nothing downstream reports it either: the first symptom is a stage failing on an authorization error, on a host, hours later. An existence check passes on that application. A permissions check is what catches it.

Verify the tracker agent the same way — read the workspace back and confirm the agent is there and is an agent, rather than trusting that the authorization the user reported completing did what they thought.

If a read shows something you did not expect — a permission missing, an installation scoped to the whole organization, an agent that is really a human account — say exactly what you found and what it should be. Do not repair it yourself.

### Half-registered is a normal state, not a failure

Four identities across two hosts, each needing a browser, is more than one sitting for most people. A run that finds two applications registered and the third missing is the expected shape of the second sitting, not an error.

So: name precisely which identities are outstanding — by role and by surface, `dev`'s application and the tracker agent, never "some identities" — and leave the ones that exist entirely alone. Re-registering an application that is already there is worse than doing nothing: it strands the credential the user already stored.

Then **carry on with the rest of the run**. The tracker binding, the statuses, the labels, and the registry do not depend on the identities being complete. A run that stops at the first missing application makes the user pay for the whole run again to get the part they had already earned.

### Where the credentials go

Every credential — an application's private key, the agent's token — belongs in whatever secret store the runner reads from, and the run supplies them to a stage through its environment. Say that, once, to the user, and name what each role needs.

None of them goes in `registry.yaml`, in any other tracked file, or in a comment on the issue. The registry names identities; the environment authenticates them; the two never meet on disk.

## The registry

Record the confirmed tracker in `registry.yaml` as a `project-management` resource, in the shape the stub itself documents — its `kind`, the `provider`, the `team`, the `project`, and, when the repository is registered as its own resource, the `tracks` pointing at it.

Record each registered identity there too, in the `identity` shape the stub documents: which role an application corresponds to, enough to identify it on the host, and — for the tracker agent — one entry belonging to the project rather than to any role. Record only identities you verified. An identity the user is midway through registering is outstanding, not recorded.

**Never write a credential into this file.** Not a private key, not a client secret, not a token, not "temporarily." The registry is tracked, which means a credential written here is a credential published to everyone who clones the repository and preserved in history after it is deleted. If you find one already there, stop and tell the user it needs rotating — removing it is not enough, and pretending it is unread is the worse mistake.

Edit the `resources:` entry in place. Do not load and re-dump the file: the stub is mostly comments documenting the resource shape, and a YAML round-trip strips them and reformats whatever it kept. `resources: []` is what "nobody has filled this in" looks like; replace that, and leave everything around it untouched.

Leave every resource the file already declares alone. If an entry already records a tracker naming a different team or project, ask the user before replacing it — a repository whose registry points somewhere unexpected is more likely to be a repository you have misidentified than a stale entry.

## The merge gate

Three identities are what make a real review *possible*. The gate on the default branch is what makes it *required*. Without it the review stage submits a verdict nothing consults, and delivery merges whether or not it got one — a pipeline that looks like it reviews its work and does not.

The default branch needs one thing: **at least one approving review** before a pull request may merge.

Report a branch that requires a pull request but zero approving reviews as **insufficient**, not as present. It is the most misleading state on this list, because protection is visibly configured and admits unreviewed changes anyway.

### Two settings must stay off, and they are the ones that look like the next step

Neither of these tightens the gate. Each makes it unsatisfiable by any role the pipeline has:

- **Requiring the approval to postdate the most recent push.** It removes the last pusher from the eligible set. `deliver-task` is a pusher and *then* a merger — it syncs the delta specs, moves the change under `openspec/changes/archive/`, pushes that, and only then merges — so `deliver` is the last pusher on every pull request the pipeline completes, and cannot approve its own push. `design` authored the pull request and the host refuses its review outright. `dev` is not running by then. Nothing is left that can approve.
- **Dismissing stale reviews on push.** The same dead end by another route: delivery's own archive push would dismiss the approval it is about to merge on.

Under either one, every task parks in delivery waiting for an approval no stage can give, and the human bypass becomes the only way anything merges — a pipeline that looks like it is running while a person does all of the finishing. Read both settings, and report a branch carrying either as not satisfying the gate: present turning it off as part of the change you propose, with what it does to delivery, and apply nothing until the user agrees. Never turn one on.

### One approval from anyone is all the branch can be asked for

The host's exclusions are subtractive — they take the author, and optionally the last pusher, out of the eligible set — and never name an approver. Its required-reviewer setting names teams, and an application cannot join a team. So there is no configuration in which the reviewing role is the one that has to approve, and nothing here to check for it: what you are verifying is one approval from anyone with write access.

Say that plainly when you report the gate. Which role approves and which merges is workflow convention, stated once in the workflow document (`AGENTS.md`) and honoured by the stages — not something the branch enforces. A user who believes otherwise will never look at the pull request timeline, and the timeline is the only place a breach is visible: the roles are distinct identities, so the approving identity is on the record even though nothing rejects the wrong one.

### Two mechanisms protect a branch, and one of them lies by omission

The git host guards a branch two independent ways — a **ruleset** targeting it, and **classic branch protection** on it — and a branch may carry either, both, or neither. Read both. The classic endpoint is the one you reach for first, and on a branch governed only by a ruleset it returns `404 Branch not protected`: a successful read whose answer is *no gate*, on a branch that is actively gated. jen's own repository is in exactly that state. Reporting a gate absent off one of two endpoints is the same failure as the application registered with no permissions two sections up — the call succeeds and the conclusion is wrong.

Either mechanism carrying the approval requirement satisfies the gate; you need one of them, not both. The two settings that must stay off are read the same way — on whichever mechanism is in force, and on both when both are.

Confirm any ruleset you read actually **targets the default branch**. The repository's ruleset list returns every ruleset it has, including ones targeting other branches or tags, so an active ruleset in that list is not evidence that this branch is governed by it — the same shape of mistake as the `404`, arriving from the opposite direction. Asking the host which rules apply to the branch answers directly; reading the list and assuming answers something else.

When you apply, **extend the ruleset already governing the branch** rather than adding a second mechanism beside it. Two overlapping mechanisms have to be kept in sync from then on, and a ruleset left at an approving-review count of `0` next to a new classic rule is a gate the next run will read inconsistently depending on which endpoint it asks. Only when nothing governs the branch at all do you choose which to create, and then say which one you created.

### Read who is allowed to bypass it, not only what it requires

A gate the pipeline's own roles can step around is not a gate, and the requirement is absolute: no role may hold a bypass, while a human may keep one. That distinction is the whole rule.

So read the bypass list as part of reading the gate. The actors come back on the same read that answers the approving-review count and the two settings above, on whichever mechanism is in force — a ruleset's `bypass_actors`, where an application appears with `actor_type: "Integration"`, and classic protection's `bypass_pull_request_allowances.apps`. Read both when both govern the branch.

**One of the three roles on a bypass list means the gate is not satisfied**, however correct the count is. Report it the way you report a branch carrying one of the two forbidden settings: say what you found, present removing that actor as part of the change you propose, and apply nothing until the user agrees. This is worse than either of those settings rather than comparable — they make the gate unsatisfiable, which at least stops a pipeline visibly, while a bypassing role leaves every check reading green and the requirement inert.

A team that adds its bot to the bypass list is not doing anything strange: it is what you do the first time your own protection blocks your automation, and it is a checkbox in the ruleset's UI. Expect to find it.

**A human bypass is not this** — leave it exactly where it is. Somebody has to be able to break the glass on a pipeline that runs with nobody watching.

### Changing it is the user's call, every time

Read the default branch's protection — both mechanisms — and report what you find. If it already requires an approving review, carries neither of the two settings above, and lists none of the three roles as a bypass actor, say so and change nothing. All three have to hold: the count alone is the condition that looks sufficient and is not.

If it does not, present the **exact** change you would make — the settings and the values, not "tighten the branch protection" — and apply it only after the user explicitly agrees. A merge policy governs a repository jen does not own; the user may have reasons you cannot see, and a silent tightening is an intrusion whichever way it turns out.

If they decline, apply nothing, report the gate as outstanding, and state plainly what would satisfy it so the next run — or the user, by hand — can finish it. Declining is an answer, not a failure, and it does not end the run.

**Change nothing beyond what the gate requires.** Leave every other protection the branch carries exactly as it is, and leave an existing human bypass in place — somebody has to be able to break the glass on a pipeline that runs with nobody watching. Never add one of the three roles to a bypass list: a role that can bypass the gate is a role the gate does not constrain, which is the whole gate.

## The report

End with what the run found, separating what was already correct from what this run did. "`task` already exists" and "created `task`" are different facts about the project, and collapsing them costs the user the only signal that says whether anything actually changed. Hold to that split across all of it — the statuses, the labels, the identities, and the gate. "`dev`'s application was already registered" and "guided registration of `dev`'s application" are as different as the labels are, and so are a gate that was already correct and a gate this run tightened.

Say plainly whether the project is ready for the pipeline. It is not, while any status is missing, any identity is unregistered, or the gate is unsatisfied — including when the user declined it, and including when you could not reach a host to check. Withholding "ready" is not a judgement about the user's choice; it is the honest reading of a pipeline that would not yet run correctly, and it is the reason a later run knows there is something to resume.

Close with what is still outstanding and what would resolve it — the statuses to add in Linear, the applications still to register and where, the gate the user declined, a project the user needs to create, a question they never answered. That list is what the next run resumes from, so write it for someone who will read it a week later with none of this conversation in mind.
