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

The team must carry every status the pipeline names: the status that triggers each stage, from the stage table in the workflow document (`AGENTS.md`), together with `Backlog`, `Todo`, and `Pending`. Today that is `Backlog`, `Todo`, `In Design`, `In Progress`, `In Review`, `In Testing`, `In Delivery`, `Pending`, and `Done` — enumerated here so you can read this without a second file open, but the table is the authority. If the two ever disagree, the table wins and this line is the bug.

`Pending` is where every stage parks a task that needs a person, and a project bound before it joined the pipeline will not have it. Report it absent like any other missing status rather than treating an already-bound project as settled — until it exists, a stage that needs a human has nowhere to put the task, and `jen run` refuses the project outright.

Compare by name, folding case and trimming surrounding whitespace, and nothing else. `in design` is `In Design`. `In-Design`, `Design`, and `Designing` are not, and neither is anything else a person would call obviously equivalent — every step past case folding is synonym matching, and synonym matching is the status map arriving through the back door.

Report exactly which statuses are absent, by the name the workflow uses. Create nothing, rename nothing, delete nothing, and leave a near-miss like `Code Review` exactly where it is. While any status is missing, do not report the project as ready for the pipeline.

A missing status does not end the run. Nothing else here depends on the statuses being complete, so do all of it anyway and report on every part. That is what makes the re-run cheap: the user adds the status in Linear, runs you again, and the second run finds the registry, the labels, and the identities already correct and the statuses now satisfied.

## The project's own status, which is the pipeline's halt

Those nine are the *team's issue* statuses. The **project** carries a status of its own, and one of them is how an operator stops the pipeline: a project status named exactly `On Pause`, filed under the `In Progress` category. `jen run` reads it before it polls and dispatches nothing while the project sits in it.

It is the tracker's shape like every other status here, so the same rule holds — report it, never create it — and here the tool surface agrees: it exposes the team's issue statuses (`list_issue_statuses`) and the workspace's project *labels*, and nothing at all for project statuses. There is no call to list them with and none to create one. Do not reach for `save_project`'s `state` as a substitute in either direction: it selects an existing status and no more, and a name that resolves to nothing is answered by the project's status not changing rather than by an error — so setting it creates nothing, and failing to set it proves nothing either.

That leaves you unable to check this one the way you check the nine, and the honest report says so rather than implying either answer. Tell the user what to create — **workspace settings → Projects → Statuses**, a status named `On Pause` under the `In Progress` category — and that you could not verify it from here.

Two things about it are worth stating rather than leaving the user to find out:

- **The name is matched, not the category.** `In Progress` is the category every working project sits in, so it carries no signal the halt could read; the name is what jen matches, folding case exactly as the issue statuses are folded. Renaming this status turns the halt off silently. Nothing else jen prescribes is renameable either, but this is the one where the symptom is a kill switch that quietly stops working.
- **Why not file it somewhere the category would do the work.** Under `Completed` or `Canceled` the category alone would halt, with no prescribed name to protect — but those already halt, and they mean the project is *over*. Pausing a live pipeline by marking its project cancelled makes the tracker say something untrue on every surface that reads the category. The halt is not worth that.

A project that has no `On Pause` status is not a project that fails to run — it is a project whose kill switch does not exist yet, which the user finds out at the moment they need it. Report it with the outstanding work at the end of the run.

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

Verify the tracker agent the same way — read the workspace back and confirm that **the project's** agent is there, by name and by the `agent_id` the registry records, and that it is an agent rather than a human account. Confirming only that *an* agent exists answers a different question on a workspace carrying agents from other products, which is the same gap as registering none because the workspace already had one.

If a read shows something you did not expect — a permission missing, an installation scoped to the whole organization, an agent that is really a human account — say exactly what you found and what it should be. Do not repair it yourself.

### Half-registered is a normal state, not a failure

Four identities across two hosts, each needing a browser, is more than one sitting for most people. A run that finds two applications registered and the third missing is the expected shape of the second sitting, not an error.

So: name precisely which identities are outstanding — by role and by surface, `dev`'s application and the tracker agent, never "some identities" — and leave the ones that exist entirely alone. Re-registering an application that is already there is worse than doing nothing: it strands the credential the user already stored.

Then **carry on with the rest of the run**. The tracker binding, the statuses, the labels, and the registry do not depend on the identities being complete. A run that stops at the first missing application makes the user pay for the whole run again to get the part they had already earned.

### Where the credentials go

Every credential — an application's private key, the agent's token — belongs in whatever secret store the runner reads from, and the run supplies them to a stage through its environment. Say that, once, to the user, and name what each role needs.

The names are not yours to choose: `JEN_GH_APP_ID_<ROLE>`, `JEN_GH_INSTALLATION_<ROLE>`, and `JEN_GH_PRIVATE_KEY_<ROLE>` for each of `DESIGN`, `DEV`, and `DELIVER`, plus `LINEAR_API_KEY` and one model credential. Eleven. `jen watch` reads them from the environment it was started in, and so does a runner an adopter drives from somewhere else — a secret stored under any other name reaches nothing.

**Model access is the one of the eleven the user chooses the form of, and this is where they are standing when they choose it.** It is accepted under two names — `ANTHROPIC_API_KEY`, an API key billed per token, or `CLAUDE_CODE_OAUTH_TOKEN`, minted from a Claude subscription by `claude setup-token`. Put both to the user rather than naming the first: someone already paying for a subscription, told only about the key, goes and funds a key they did not need. Two spellings of one value, so the count is still eleven.

Say which one they are storing, and say that a run holds **exactly one** — both set is refused before a session starts, not resolved by a precedence. If they choose the subscription, say that its usage limits are shared with their own interactive use of the same account, so the pipeline can spend a window they were about to work in. `README.md` carries the full comparison; do not restate it here, and do not go past what it says — the token's authority is inference-only by design, so never describe it as a broad or unscoped credential.

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

### Nothing may raise the effective requirement above one approval, and the settings that do look like the next step

What the branch may ask for is bounded at **one approving review from an identity other than the pull request's author**, because one approval from `deliver` is the most the pipeline can produce. A configuration that raises the *effective* requirement above that bound does not tighten the gate — it makes the gate unsatisfiable by any role the pipeline has. Every task parks in delivery waiting for an approval no stage can give, and the human bypass becomes the only way anything merges: a pipeline that looks like it is running while a person does all of the finishing.

Read that as the check. Not a list of setting names — the bound. The settings belong to the git host and the host adds to them, so any list written here is accurate when written and silently incomplete afterward, and every later reading of it stays perfectly correct about the settings it names while the branch has moved past them. A setting the host ships next year raises the effective count exactly as the ones below do, and breaches this on the same terms whether or not it is named here.

Four are known to breach it:

- **Requiring the approval to postdate the most recent push.** It removes the last pusher from the eligible set. `deliver-task` is a pusher and *then* a merger — it syncs the delta specs, moves the change under `openspec/changes/archive/`, pushes that, and only then merges — so `deliver` is the last pusher on every pull request the pipeline completes, and cannot approve its own push. `design` authored the pull request and the host refuses its review outright. `dev` is not running by then. Nothing is left that can approve.
- **Dismissing stale reviews on push.** The same dead end by another route: delivery's own archive push would dismiss the approval it is about to merge on.
- **Requiring an extra approval for a pull request the host treats as unattributed.** It raises the effective count to one *more* than configured **wherever it applies** — and whether *wherever it applies* reaches a pull request opened by an application acting as itself, which every pipeline pull request is, is the one thing about it you cannot read off the setting. It breaches the bound wherever it does reach them. Two things make this one easy to miss where the other three are not. It is **on by default**, on new rulesets and existing ones alike, so a project carries it without anyone choosing it. And it is **inert at an approving-review count of zero** — which is the state of every branch that has not yet been through this section, so a repository that has never raised its count holds no evidence about it either way, and raising the count is the act that makes it live for the first time.
- **Naming required reviewers by team.** An application cannot join a team, so every pipeline role sits outside a team-scoped requirement and nothing the pipeline has can satisfy it.

Report a branch carrying any of them as not satisfying the gate: present turning it off as part of the change you propose, with what it does to delivery, and apply nothing until the user agrees. Never turn one on.

That instruction is **on the breach, not on the name**. The two that delivery's own push walks into and the team-scoped one breach on sight: their reach is not in question, and a branch carrying any of the three is a branch the pipeline cannot merge on. The unattributed-changes setting is the one where finding it is not yet finding a breach, because its reach is the open question and *Breaching* below means reach established **and** the bound exceeded — so settle it by the two sections that follow before you report it. Where an observation settles it as not reaching the pipeline's pull requests, leave the setting on and say so. Proposing that a user turn off a setting that is not in fact holding their gate shut is the same class of error as reporting satisfied a gate that is: in both the report does not match the branch.

### Where you cannot establish a setting's reach, say undetermined

A setting's documentation is evidence about the setting, not about your branch. The unattributed-changes one is the live example: the host documents it as scoped to its own assistant opening a pull request under its own app identity, while the API field is named for unattributed *changes* with no mention of that assistant, and the host calls the feature preview and subject to change. A setting documented for one application may be implemented against any application acting as itself — and the pipeline's three are exactly that.

So when you meet a setting that bears on the approving-review requirement and you cannot establish whether it reaches the pipeline's own pull requests, **report it as undetermined**, and do not report the gate as satisfied on the strength of the configured count alone. Undetermined is a third answer, not a soft yes: name the setting, say what you could not establish about it, and put it on the outstanding list with the rest.

What settles it is observation rather than reading — a pull request the pipeline itself opened, passing the gate on one approval. Where the user wants it settled, that is what to tell them it takes. Reporting a gate satisfied on a branch where delivery cannot merge is the one failure the pipeline cannot see from the inside: every check reads green, every task parks, and nothing in the output names why.

### One observation is already recorded, and it is why a first binding is not stuck

Undetermined has no exit on its own. The unattributed-changes setting is on by default, its reach cannot be read off the API, and what settles it is a pull request the pipeline itself opened — which a project *being bound* has never had, binding being the prerequisite for having one. On the rule above alone, every adopter's first run reports the gate unsatisfied and the project not ready, with no move available that changes it.

So the observation is recorded here rather than left for each adopter to buy:

> **GitHub, 25 August 2026.** On `reveer-ai/jen`, with `require_extra_approval_for_unattributed_changes` left `true` on the ruleset governing the default branch and the approving-review count raised from `0` to `1`, a pull request authored by `app/reveer-release` — an application acting as itself rather than on behalf of a person — went from `reviewDecision: REVIEW_REQUIRED` / `mergeStateStatus: BLOCKED` at zero approvals to `APPROVED` / `CLEAN` on **one** approving review. The setting is scoped as GitHub documents it and did not reach an application's pull request, on that host, on that date.

**Cite it; never restate it as a conclusion.** "That setting is fine" is exactly the assumption this section exists to refuse, and a conclusion cannot be told from an assumption once it is separated from what produced it. What carries is the observation with its host, its date, its vehicle, and the repository state it was made against, so the user can weigh whether it still holds. Documentation is evidence about a setting; an observation is evidence about an implementation at a moment — and the host calls this feature preview and subject to change.

That gives the report three shapes rather than two, and which one applies turns on whether an observation covers the setting in front of you:

- **Settled by observation.** The setting matches one recorded above — same host, same behaviour under test. Report it settled, quote the date, and say that the project's own first pipeline pull request re-settles it against their repository if they want it established there rather than borrowed from jen's. This does not hold the gate unsatisfied.
- **Undetermined.** A setting bearing on the requirement with no observation behind it — one the host has added since, or one whose behaviour differs from anything recorded here. This is the case the rule above is written for, and it does hold the gate unsatisfied.
- **Breaching.** Its reach is established and it raises the effective requirement above the bound. Report it as the section before this one says.

A different git host is a different implementation, and nothing recorded here transfers to one.

### The branch cannot be asked to name *which* role approves

The bound is one approval from a non-author, and it is not one approval from a *particular* non-author. The host's exclusions are subtractive — they take the author, and optionally the last pusher, out of the eligible set — and never name an approver; the one setting that comes close names teams, which is why it appears above as a breach rather than as an option. So there is no configuration in which the reviewing role is the one that has to approve, and nothing here to check for it: what you are verifying is one approval from anyone with write access.

Say that plainly when you report the gate. Which role approves and which merges is workflow convention, stated once in the workflow document (`AGENTS.md`) and honoured by the stages — not something the branch enforces. A user who believes otherwise will never look at the pull request timeline, and the timeline is the only place a breach is visible: the roles are distinct identities, so the approving identity is on the record even though nothing rejects the wrong one.

### Two mechanisms protect a branch, and one of them lies by omission

The git host guards a branch two independent ways — a **ruleset** targeting it, and **classic branch protection** on it — and a branch may carry either, both, or neither. Read both. The classic endpoint is the one you reach for first, and on a branch governed only by a ruleset it returns `404 Branch not protected`: a successful read whose answer is *no gate*, on a branch that is actively gated. jen's own repository is in exactly that state. Reporting a gate absent off one of two endpoints is the same failure as the application registered with no permissions two sections up — the call succeeds and the conclusion is wrong.

Either mechanism carrying the approval requirement satisfies the gate; you need one of them, not both. The configuration that raises the effective requirement is read the same way — on whichever mechanism is in force, and on both when both are.

Confirm any ruleset you read actually **targets the default branch**. The repository's ruleset list returns every ruleset it has, including ones targeting other branches or tags, so an active ruleset in that list is not evidence that this branch is governed by it — the same shape of mistake as the `404`, arriving from the opposite direction. Asking the host which rules apply to the branch answers directly; reading the list and assuming answers something else.

When you apply, **extend the ruleset already governing the branch** rather than adding a second mechanism beside it. Two overlapping mechanisms have to be kept in sync from then on, and a ruleset left at an approving-review count of `0` next to a new classic rule is a gate the next run will read inconsistently depending on which endpoint it asks. Only when nothing governs the branch at all do you choose which to create, and then say which one you created.

### Read who is allowed to bypass it, not only what it requires

A gate the pipeline's own roles can step around is not a gate, and the requirement is absolute: no role may hold a bypass, while a human may keep one. That distinction is the whole rule.

So read the bypass list as part of reading the gate — and where it lives depends on which mechanism is in force. Classic protection hands it back on the read you have already made: `bypass_pull_request_allowances.apps`, nested inside `required_pull_request_reviews` beside the count and the settings that bear on it. A ruleset does not. Asking the host which rules apply to the branch answers the count and the settings beside it and carries no bypass actors at all — those live on the ruleset itself, so follow the `ruleset_id` that the pull-request rule already carries and read `/repos/{owner}/{repo}/rulesets/{id}`, where an application appears in `bypass_actors` with `actor_type: "Integration"`. The ruleset path costs that second read and the classic path does not, and a run that skips it finds no bypass field, reads the absence as nobody, and reports the gate satisfied on a branch that hands a role the key. Read both when both govern the branch.

**The actor arrives with no name, and its type cannot decide it.** A ruleset's entry is `{"actor_id": <integer>, "actor_type": "Integration"}` and nothing more. That tells you the actor is *an* application; it never tells you *which*, and which is the whole question — `reveer-ai` carries five installations and two of them are not pipeline roles. So attribute the actor before you judge it, and never settle it on `actor_type` alone. Both shortcuts fail: reading every `Integration` as a role reports a correctly configured branch as insufficient and proposes removing an actor that was never a hazard, which is an intrusion into a merge policy jen does not own; reading none of them as a role reports the gate **satisfied** on a branch that hands a role the key. The second is the graver one and the reason this step exists — every check green, the requirement inert, and the pipeline unable to see it from the inside.

**Resolve the identifier against the installations on the repository's organization.** `/orgs/{org}/installations` returns every installation with its `app_id`, its installation `id`, and its `app_slug` — and `{org}` is the organization that owns **this repository**, not the one that owns the applications. *Which organization and which workspace* above has you establish those separately because they can differ, and an installation lives on the organization it was installed *into*: on a project where the applications are owned elsewhere, listing the app-owning organization returns rows that cannot contain this repository's installation at all. Every application actor then resolves to nothing and is reported unattributed — the safe direction, and permanently so, because the gate is held open on a reason that is false and nothing the user does to the actor clears it. Match the actor's `actor_id` against **both** the `app_id` and the installation `id` of each row, then compare the resolved installation's `app_id` against the `app_id` that `registry.yaml` records for each of the three roles. Match both fields rather than one: whether a ruleset's `Integration` `actor_id` carries an application id or an installation id is not established here, and matching both resolves the actor whichever space the value came from — the question is made unnecessary rather than answered. Collapsing this to a single field reads like a simplification and is an unverified assumption in the direction that fails silently. This is also the endpoint that answers a session at all — `/app/installations/{id}` and `/repos/{owner}/{repo}/installation` both refuse with `401 A JSON web token could not be decoded`, for the reason `.claude/skills/AGENTS.md` records.

**Resolution has three answers, and each of them is reported:**

- **It resolves to a role.** The gate is not satisfied, and the report says *which* role holds the bypass rather than that one does. Report it the way the bypassing-role paragraph below describes.
- **It resolves to an application no role records.** Not a breach — and **name it anyway**. `reveer-release holds a bypass, which is not a pipeline role` is a different report from `an application holds a bypass`, and only the first tells the user whether to act. This is the answer you will be tempted to pass over in silence; don't.
- **It resolves to nothing.** Report the actor as **unattributed**, name the identifier you could not resolve, **say what you could not establish about it**, and do not report the gate as satisfied while one stands. An application absent from a listing you read and a listing you could not read are two different facts reaching the same dead end, and they are cleared by different things — the first by finding out what that application is, the second by granting the binding token organization access. A report that says only *unattributed: 4588651* names neither, and the reader a week later cannot tell which one they are holding. This is the same third answer as an undetermined setting above and it behaves the same way, down to what it owes the report: not a soft yes, never grounds for calling the gate satisfied on the strength of the rest of the read, and named with what could not be established rather than named alone. Reporting an unattributed actor as not-a-role is the unsafe default, and it is precisely the reading that produces green checks over an inert requirement.

**You owe an attribution only where the list actually carries an application.** An empty bypass list, or one carrying only humans, has nothing to attribute — and there, a `/orgs/{org}/installations` you could not read changes nothing about the report. Never withhold the gate over a resolution you never needed to make: most repositories being bound for the first time pose no such question, and jen's own is one of them, with a single human on its list and nothing to resolve.

**The classic path needs none of this**, along the same seam as the read above. `bypass_pull_request_allowances.apps` hands back full application objects carrying `slug` beside `id`, so an actor read that way is already named and is judged on that name with no second resolution. The ruleset path costs the second read *and* the attribution; the classic path costs neither.

**One of the three roles on a bypass list means the gate is not satisfied**, however correct the count is. Report it the way you report a branch that raises the effective requirement above the bound: say what you found, present removing that actor as part of the change you propose, and apply nothing until the user agrees. This is worse than any of those settings rather than comparable — they make the gate unsatisfiable, which at least stops a pipeline visibly, while a bypassing role leaves every check reading green and the requirement inert.

A team that adds its bot to the bypass list is not doing anything strange: it is what you do the first time your own protection blocks your automation, and it is a checkbox in the ruleset's UI. Expect to find it.

**A human bypass is not this** — leave it exactly where it is, and attribute nothing: `actor_type: "User"` is judged on the actor being a human, not on which human. Somebody has to be able to break the glass on a pipeline that runs with nobody watching.

### Changing it is the user's call, every time

Read the default branch's protection — both mechanisms — and report what you find. If it already requires an approving review, carries nothing that raises the effective requirement above one approval from a non-author, and lists none of the three roles as a bypass actor, say so and change nothing. All three have to hold: the count alone is the condition that looks sufficient and is not. A setting you had to report as undetermined leaves the gate unsatisfied for this purpose — it is not one of the three holding. So does a bypass actor you could not attribute: *lists none of the three roles* is a conclusion you have only reached once every application on the list resolved to something. A setting settled by the recorded observation above is not that, and does not hold the gate open.

If it does not, present the **exact** change you would make — the settings and the values, not "tighten the branch protection" — and apply it only after the user explicitly agrees. A merge policy governs a repository jen does not own; the user may have reasons you cannot see, and a silent tightening is an intrusion whichever way it turns out.

If they decline, apply nothing, report the gate as outstanding, and state plainly what would satisfy it so the next run — or the user, by hand — can finish it. Declining is an answer, not a failure, and it does not end the run.

**Change nothing beyond what the gate requires.** Leave every other protection the branch carries exactly as it is, and leave an existing human bypass in place — somebody has to be able to break the glass on a pipeline that runs with nobody watching. Never add one of the three roles to a bypass list: a role that can bypass the gate is a role the gate does not constrain, which is the whole gate.

## The report

End with what the run found, separating what was already correct from what this run did. "`task` already exists" and "created `task`" are different facts about the project, and collapsing them costs the user the only signal that says whether anything actually changed. Hold to that split across all of it — the statuses, the labels, the identities, the registry, and the gate. "`dev`'s application was already registered" and "guided registration of `dev`'s application" are as different as the labels are, and so are a gate that was already correct and a gate this run tightened.

Say plainly whether the project is ready for the pipeline. It is not, while any status is missing, any identity is unregistered, or the gate is unsatisfied — including when the user declined it, and including when you could not reach a host to check. Withholding "ready" is not a judgement about the user's choice; it is the honest reading of a pipeline that would not yet run correctly, and it is the reason a later run knows there is something to resume.

Close with what is still outstanding and what would resolve it — the statuses to add in Linear, the applications still to register and where, the gate the user declined, a project the user needs to create, a question they never answered. That list is what the next run resumes from, so write it for someone who will read it a week later with none of this conversation in mind.
