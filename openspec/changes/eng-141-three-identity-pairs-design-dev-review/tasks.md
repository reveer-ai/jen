## 1. Verify what the design rests on

Nothing else in this change is safe to build before these pass. A failure here is a blocker to route back with, not something to work around — see design.md, Risks.

- [ ] 1.1 Register the tracker agent, authorizing it with `actor=app`, and confirm the resulting token authenticates against the tracker's MCP server by bearer header
- [ ] 1.2 Under that token, exercise every tracker tool the stages depend on against a scratch pull request: `get_diff`, `save_diff_comment`, `get_diff_threads`, `resolve_diff_thread`, `submit_diff_review`, and `merge_diff`
- [ ] 1.3 Confirm the probe's actions are attributed to the agent rather than to the human who authorized it, on both an issue comment and a diff comment
- [ ] 1.4 If 1.1–1.3 fail, stop: record what failed on the issue and route the task back to `In Design`, because the alternative changes this change's scope entirely

## 2. Register the identities

- [ ] 2.1 Register three applications on the git host in the project's own organization, each with the permissions design.md assigns its role, and install each on the repository
- [ ] 2.2 Keep the tracker agent registered in 1.1 as the project's one agent rather than registering another
- [ ] 2.3 Place each role's credentials in the runner's secret store, and confirm no private key, client secret, or token has been written anywhere in the repository or left on the host

## 3. Record the identities

- [ ] 3.1 Extend the documented resource shape in `scaffold/registry.yaml` with identity entries, naming a role's application and agent and nothing that authenticates them
- [ ] 3.2 Record jen's own three roles in its `registry.yaml`, editing the entry in place rather than round-tripping the file, so the stub's documenting comments survive
- [ ] 3.3 Confirm `registry.yaml` holds no secret

## 4. Teach the binding skill the identities

- [ ] 4.1 Add identity establishment to `setup-jen`: guided registration per host, confirmation before registering anything, and verification of the result rather than assumed success
- [ ] 4.2 Make a partially registered project a first-class state — name which roles and which halves are outstanding, complete the rest of the binding anyway, and recognise on re-run what is already registered
- [ ] 4.3 Add registry recording of the identities, with the prohibition on writing any credential stated where it will be read
- [ ] 4.4 Add merge gate handling: verify the default branch, present the exact change when it is absent or insufficient, apply it only on explicit confirmation, and report it outstanding when declined
- [ ] 4.5 Ensure declining the gate or leaving a role unregistered both withhold "ready for the pipeline" without ending the run
- [ ] 4.6 Extend the skill's closing report to separate what was already correct from what this run did, for the identities and the gate as it already does for statuses and labels

## 5. Apply the gate and confirm it holds

Ordered after 2 deliberately: raising the approval count before the roles exist blocks merges nobody can yet approve.

- [ ] 5.1 Raise jen's `primary` ruleset to an approving-review count of 1 with approval of the most recent push required, leaving the `check` requirement and the human bypass in place and adding no role to the bypass list
- [ ] 5.2 Confirm CI triggers on a pull request opened by the `design` application — a pull request whose checks never run can never merge, and the failure presents as a task silently stuck in delivery
- [ ] 5.3 Confirm the tracker still links an application-opened pull request back to its issue
- [ ] 5.4 Confirm a verdict submitted by `deliver` counts toward the approval requirement, rather than merely being recorded
- [ ] 5.5 Confirm `dev` cannot approve a pull request it pushed last, which is the exclusion the count alone does not provide
- [ ] 5.6 Confirm the human bypass still works, since it is the only way to break the glass on an unattended pipeline

## 6. Record what a future session would otherwise rediscover

- [ ] 6.1 Record in `.github/AGENTS.md` that the review verdict must never be submitted under the CI platform's default workflow credential, and that `GH_TOKEN` is named in preference to `GITHUB_TOKEN` because `gh` prefers it — the failure is a review that renders identically and satisfies nothing, and ENG-165 is where it would be introduced
