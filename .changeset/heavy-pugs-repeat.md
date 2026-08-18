---
"@reveer/jen": minor
---

Harden the stages for unattended runs.

Every stage is now re-enterable: each one states what a killed run can leave behind, and treats a completion marker as a claim to check against the commits, the PR, and the threads rather than as proof. Every session ends with a comment on the task, which is what makes a finished run distinguishable from a crashed one.

`design-task` no longer requires a user. It confirms before each artifact when confirmation is available and otherwise writes the set and lets the draft PR carry the confirmation, discovering which applies rather than reading a flag. It also stops advancing the task: design ends at `In Design`, and promoting to `In Progress` is the user's call, alongside `Todo` → `In Design`.

`test-task` no longer blocks on a missing staging routine. Staging leaves the stage entirely and gets its own task; what remains is the full suite, the integration and e2e checks the project defines beyond unit scope, and the spec's scenarios worth confirming end to end.

The churn ceiling leaves the skills for the dispatcher to enforce, replaced by reading the task's record on entry as context.

The scaffold's `.claude/settings.json` now permits the standard check-script names alongside `git`, `gh`, and `openspec`, and the README states which permissions an adopter has to add themselves — an existing install has to be edited by hand, since jen never rewrites that file.
