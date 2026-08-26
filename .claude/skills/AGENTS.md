# The stage skills

What a session needs when it is working on the skills in this directory, rather than on
what they orchestrate. jen ships each `SKILL.md` here into every project it manages; this
file is jen's own and is not shipped, so it can say things an adopter has no use for.

## An empty `list_diffs` under the tracker agent means the identity, not a broken integration

Linear's diff tools — `list_diffs`, `get_diff`, `get_diff_threads`, `save_diff_comment`,
`submit_diff_review`, `merge_diff` — appear in `tools/list` for every token, including an
`actor=app` one. Under an app user they return nothing: `list_diffs` is empty and
`get_diff` reports `Diff not found` for pull requests a human token reads fine. Linear's
diffs link a Linear *user* to a *GitHub account*, and an app user has neither, so the tools
are present and inert. No scope widens this.

The trap is that a disconnected GitHub integration looks identical from the output alone,
and it is the cause anyone will suspect first — it was in fact broken here once, and fixing
it was real. Check which identity the token belongs to before checking the integration.

The consequence for these skills: pull-request work goes to GitHub through `gh`; the
tracker carries issue work only. Several skills here used to call the diff tools directly,
and worked only because a human's token drove them; `e43bc91` moved those calls. That is
why this note is here rather than nowhere — the calls read as correct for as long as a
human ran them, and the day a stage ran as its own identity they would have returned
nothing instead of failing.

No workflow is involved in any of this — it bites a stage running on a laptop exactly as
hard — which is why the note lives beside the skills and not under `.github/`.

## Reading an installation's granted permissions needs the org listing, not the installation

`setup-jen` tells a run to read a role's permissions back from the **installation** rather
than from the application, which is right — but the two endpoints whose names say
"installation" both refuse a run that is not the application itself:
`/app/installations/{id}` and `/repos/{owner}/{repo}/installation` each answer `401 A JSON
web token could not be decoded`, because both want a JWT signed with the application's
private key. A run does not hold that key; the operator does, and the whole point of the
design is that it never reaches a session.

What works under an ordinary token with organization access is
`/orgs/{org}/installations`, which returns every installation with its `permissions` and
`repository_selection` — the two fields the verification step compares against the table.
Select the one whose `app_id` matches the registry rather than the one whose name looks
right.

The 401 is worth naming because of how it reads: it arrives as an authentication failure,
so the first guess is a bad token or a missing scope, and the actual answer is that the
endpoint was never reachable this way at all. It also matters that the org listing returns
*everything* installed — `reveer-ai` carries five, of which two are not pipeline roles —
so matching by `app_id` is the difference between verifying a role and verifying whatever
was installed next to it.

The same listing is also the decoder ring for a ruleset's **bypass actors**, which is the
other place a bare integer has to be turned into a role. `bypass_actors` carries `actor_id`
and `actor_type` and no name, so an application on a bypass list is indistinguishable from
`dev` at the moment binding has to judge it. The listing resolves it — and because each row
carries *both* `app_id` and the installation `id`, matching an actor against both fields
attributes it without anyone having to establish which of the two spaces a ruleset reports
in. That question is deliberately left open rather than answered; see ENG-175.

It is left open because **jen's own `primary` ruleset carries no `Integration` bypass
actor** — one human, and nothing else — so this repository cannot exercise the path its own
skill now instructs. Nothing here has been observed against a real application on a bypass
list, and nothing in the gate section should be read as though it had. Settling it would
mean adding an application to the live ruleset that gates every task in this repository,
reading it back, and removing it; if a future task genuinely needs the answer, make that
observation on a scratch repository with its own ruleset instead.
