# Workflow

jen is the workflow layer for automated, agentic software development — task-anchored, spec-driven, and git-reviewed. Any agent acting within this project must strictly adhere to this workflow.

jen is not a hub that points at separate project repos — it's the template every project forks from. Forking carries the workflow (this file, agents, skills) directly into the project.

# Source of truth

The task — tracked in project management software (Linear today, others later) — is the source of truth. OpenSpec changes, git branches, and PRs all trace back to a task and exist to serve it. Git accurately records the history of both code and specs — proposals, designs, and code are all reviewed and merged as PRs — but the task is still what everything reports back to, and the durable narrative of a project's work (the why, not just the what) lives there, not in git log.

# Projects are monorepos

A project's repo is a fork of jen — not something separate that jen references. The fork is filled in with everything that makes up the project and its resources, alongside a single `openspec/` at its root. Source, specs, and history stay unified in one repo, however many things deploy out of it on however many different pipelines/cadences.

Linear projects and monorepos aren't 1:1 — multiple Linear projects can, and probably will, point at the same monorepo fork.

# Artifact progression

OpenSpec drives spec-driven development through an ordered set of artifact stages, defined by whatever schema the project uses. A task's status mirrors its current stage. Moving a task to its next status is the trigger for an agent to do that stage's work and open a PR; merging that PR is what advances the task to the next status.

# Resources

All work happens in the context of resources defined in `registry.yaml`. A resource can be a project's repo, a project-management entry pointing at the repo it tracks, or anything else worth registering.

```
registry.yaml     # All registered resources with access and setup info
src/              # .gitignored — live checkouts land here
```

Check `registry.yaml` for the resources relevant to the current task.
