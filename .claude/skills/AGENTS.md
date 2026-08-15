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
tracker carries issue work only. Several skills here still call the diff tools directly,
which works today only because a human's token drives them. ENG-166 owns moving them.

No workflow is involved in any of this — it bites a stage running on a laptop exactly as
hard — which is why the note lives beside the skills and not under `.github/`.
