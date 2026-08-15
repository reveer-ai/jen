## 1. Register the identities

The tracker agent already exists — design registered the `jen` app user while probing, and it is the project's one agent. Do not create another.

- [x] 1.1 Register three applications on the git host in the project's own organization, each with the permissions design.md assigns its role, and install each on the repository
- [x] 1.2 Confirm the existing tracker agent is the one the project uses, rather than registering a second
- [x] 1.3 Place each role's credentials in the runner's secret store, and confirm none has been written anywhere in the repository. The operator's own copy of a key lives wherever they keep secrets, which is not the same thing as a *run* leaving one behind — the rule the specs state is about run residue

- [ ] 1.4 Amend the three registered applications to carry the permissions design.md now assigns — `Workflows: write` added to `dev` and to `deliver`, nothing added to `design`. All three were registered before that decision, so they are live and one permission short of the design. This is an operator action on the host, and the symptom of skipping it is deferred and misleading: everything works until the first task whose implementation touches `.github/workflows/`, which then fails at push naming a permission rather than a cause. **Still outstanding, and no unattended stage can close it.** The host exposes no API for amending an application's permissions — it is the application's settings page in a browser, under the owner's own session — so this waits on the operator rather than on the pipeline. The design that names the permission has landed (3.7); jen's own three applications have not been amended to carry it

**Verify the granted permissions, not just that the application exists.** All three were first created with no repository permissions at all — empty at the application level, not merely unapproved on the installation. An application in that state exists, looks configured, installs cleanly, and mints tokens that can do nothing, because the permissions section is a long collapsed list that is easy to save past. This is the check that catches it, and task 3.1 has to perform it too.

## 2. Record the identities

- [x] 2.1 Extend the documented resource shape in `scaffold/registry.yaml` with identity entries — a role's application, and the project's tracker agent — naming them and nothing that authenticates them
- [x] 2.2 Record jen's own identities in its `registry.yaml`, editing the entry in place rather than round-tripping the file, so the stub's documenting comments survive. jen had never had one — it is the tool rather than an installation of it — so the stub was written first and then filled in, which is the same two steps `jen init` and `setup-jen` perform
- [x] 2.3 Confirm `registry.yaml` holds no secret. Asserted rather than eyeballed: `test/registry.test.ts` rejects a credential-shaped field on any entry, and scans every tracked file for a PEM key block or a host token prefix

## 3. Teach the binding skill the identities

- [x] 3.1 Add identity establishment to `setup-jen`: guided registration per host, confirmation before registering anything, and verification of the result rather than assumed success
- [x] 3.2 Make a partially registered project a first-class state — name which identities are outstanding, complete the rest of the binding anyway, and recognise on re-run what already exists
- [x] 3.3 Add registry recording of the identities, with the prohibition on writing any credential stated where it will be read. Stated in three places, because each is read without the others: the skill's opening claim of what is not its to hold, the registry section it would be written from, and the stub itself
- [x] 3.4 Add merge gate handling: verify the default branch, present the exact change when it is absent or insufficient, apply it only on explicit confirmation, and report it outstanding when declined. **Reopened — the definition of "sufficient" changed under it.** The first implementation encoded a two-condition gate (a count *and* approval postdating the last push); the gate is now the count alone, because the second condition is unsatisfiable once delivery pushes before merging. Restate the section around one condition, and add the two settings that must stay off — last-push approval and dismissal of stale reviews on push — with what each does to delivery, so a future run reads them as hazards rather than as the obvious next tightening
- [x] 3.5 Ensure declining the gate or leaving an identity unregistered both withhold "ready for the pipeline" without ending the run
- [x] 3.6 Extend the skill's closing report to separate what was already correct from what this run did, for the identities and the gate as it already does for statuses and labels
- [x] 3.7 Update the skill's permission table with `Workflows: write` on `dev` and `deliver`, and say why it is not excessive: the refusal names the permission rather than the cause, and it must be granted even to a project with no `.github/workflows/` today, or the first task that adds one fails at push having done everything else right
- [x] 3.8 State in the skill, where the gate is reported, that one approval from anyone with write access is all the host can be asked for — and that which role approves is workflow convention, not configuration. A user who believes the branch enforces which identity approves will never look at the timeline, and looking is the only detection there is

## 4. Confirm the git-host half works

- [x] 4.1 Mint an installation token for one role from its application's private key and confirm it authenticates as that application rather than as a human. Done for all three: each mints, carries exactly the permissions design.md assigns it, is scoped to this repository alone, expires in an hour, and is refused by `/user` — which is what proves it is not a human's access under another name
- [x] 4.2 Confirm CI triggers on a pull request opened by the `design` application — a pull request whose checks never run can never merge, and the failure presents as a task silently stuck in delivery. Confirmed against a throwaway pull request authored by `reveer-jen-design[bot]`: the `CI` workflow ran on the `pull_request` event
- [x] 4.3 Confirm the tracker still links an application-opened pull request back to its issue. It does, by branch name. Note the application-opened pull request arrives at the tracker with a null creator, because the tracker cannot map a git-host application onto one of its own users — it is visible and unattributed there, while the git host attributes it correctly

## 5. The half of the gate that is not configuration

This lands with the change; group 6 is deferred. The branch can require an approval and cannot require *which identity* gives it, so the prohibition is stated in the workflow document instead — once, where every stage reads it, rather than copied into two skills.

- [x] 5.1 State in the root `AGENTS.md` conventions that only `review-task` approves and only `deliver-task` merges. Say why `implement-task` specifically is the one being restrained — `design-task` cannot approve in any case, since the host refuses a review from its own pull request's author, while `dev` holds `pull_requests:write` and is excluded by nothing on the branch — and say that this is the one workflow rule the host does not enforce for us
- [x] 5.2 Confirm the prohibition is stated in exactly one place. Two copies drift, and the copy a stage happens to read is then a coin toss: `grep -rn 'only review-task' .claude/skills/ AGENTS.md` should find the conventions entry and nothing under `.claude/skills/`. Run, and then kept: `test/workflow.test.ts` asserts both halves, because a one-time grep proves it today and a restatement added next month is exactly the kind of edit that looks like an improvement

## 6. The merge gate — only once the stages reach the git host directly

Ordering is load-bearing. Until the stages' pull-request calls go through `gh`, no stage can submit a verdict at all, so tightening the gate first blocks delivery on an approval nothing can give and leaves the human bypass as the only way to merge.

- [ ] 6.1 Confirm the stage skills issue their pull-request calls through `gh`: `grep -n 'submit_diff_review\|save_diff_comment\|resolve_diff_thread\|merge_diff' .claude/skills/*/SKILL.md AGENTS.md` returns nothing. Scoped to the skills' own text and the workflow document — the files that make the calls — rather than to the whole tree, because `.claude/skills/AGENTS.md` names the same tools in order to explain that they are inert, and a check that its own explanation trips is a check that can never pass. **Key on the capability, not on ENG-166's status** — ENG-166 merged as `1280f80` without moving those calls, so "confirm ENG-166 has landed" now passes while the capability it stands for does not exist, and a run trusting it would tighten the ruleset onto a pipeline that cannot submit a verdict at all. An issue's status is a claim about intent; the skills are the evidence. Checked during implementation: the calls are still there in `review-task`, `test-task`, and the root `AGENTS.md`, so the whole of this group stays untouched and the ruleset keeps its approving-review count of `0`
- [ ] 6.2 Raise jen's `primary` ruleset to an approving-review count of 1, leaving `require_last_push_approval` and `dismiss_stale_reviews_on_push` **off**, the `check` requirement and the human bypass in place, and adding no role to the bypass list. Both of those settings exclude the delivering role from approving after its own push, and `deliver-task` pushes the spec sync and archive before merging — so either one makes the gate unsatisfiable by any pipeline role rather than merely strict
- [ ] 6.3 Confirm a verdict submitted by `deliver` counts toward the approval requirement, rather than merely being recorded
- [ ] 6.4 Confirm the approval survives delivery's own push — approve as `deliver`, push the spec sync and archive, and confirm the pull request is still mergeable. This is the deadlock the eased gate exists to avoid, and it is the one check that would have caught the original design
- [ ] 6.5 Confirm the human bypass still works, since it is the only way to break the glass on an unattended pipeline

## 7. Record what a future session would otherwise rediscover

- [x] 7.1 Record in `.github/AGENTS.md` that the review verdict must never be submitted under the CI platform's default workflow credential, and that `GH_TOKEN` is named in preference to `GITHUB_TOKEN` because `gh` prefers it — the failure is a review that renders identically and satisfies nothing, and ENG-165 is where it would be introduced
- [x] 7.2 Record there too that the tracker's diff tools appear in `tools/list` for every token but return nothing under a non-human identity, so an empty `list_diffs` under an agent means the identity, not a disconnected integration — the two are indistinguishable from the output alone
