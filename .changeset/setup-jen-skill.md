---
"@reveer/jen": minor
---

Ship a `setup-jen` skill, installed into `.claude/skills/` alongside the six stage skills. It is the step between `jen init` and a pipeline that can run: it confirms which Linear team and project the repository's work is tracked in, checks the team for the eight statuses the stages move tasks through, creates the `epic` and `task` labels if they are missing, and fills in the `registry.yaml` stub `init` left behind.

Run it once after `jen init`. It is safe to run again — it reports what is already correct rather than redoing it, so a run that ends with a status still to add in Linear is resumed by running it again once you have added it. It verifies statuses and never creates, renames, or maps one; a missing status is reported by name for you to add.

Projects already on jen pick it up with `jen update`.
