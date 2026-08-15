# Workflow

jen is the workflow layer for automated, agentic software development — task-anchored, spec-driven, and git-reviewed. Any agent acting within this project must strictly adhere to this workflow.

jen is not a hub that points at separate project repos — a project installs jen into its own repository. Installing carries the workflow — this file and the skills — directly into the project.

# Source of truth

The task — tracked in project management software (Linear today, others later) — is the source of truth. OpenSpec changes, git branches, and PRs all trace back to a task and exist to serve it. Git accurately records the history of both code and specs — proposals, designs, and code are all reviewed and merged as PRs — but the task is still what everything reports back to, and the durable narrative of a project's work (the why, not just the what) lives there, not in git log.

# Projects are monorepos

A project installs jen into its own repository, and that repository *is* the project's monorepo. The root is jen's — this file, `.claude/`, `openspec/`, and `registry.yaml` — and `src/` holds what a repository root would conventionally hold: the project's own sources, tracked right there beside the workflow that governs them. Fill in `src/`, `openspec/`, and `.claude/skills` with what makes it that project. Source, specs, and history stay unified in one repo, however many things deploy out of it on however many different pipelines/cadences.

Linear projects and repositories aren't 1:1 — multiple Linear projects can, and probably will, point at the same repository.

# Artifact progression

OpenSpec drives spec-driven development through an ordered set of artifact stages, defined by whatever schema the project uses. A task's status mirrors its current stage, and moving a task to its next status is the trigger for an agent to do that stage's work.

Each task carries one branch and one PR from end to end. The PR opens during design, holding nothing but the OpenSpec artifacts; implementation, review fixes, and test fixes all land on that same PR; merging it is the pipeline's last act and what closes the task out. Specs and code are reviewed together, in one place.

# Stages

One skill per stage, each triggered by the task moving into that stage's status.

| Status | Skill | Work | Hands off |
|---|---|---|---|
| — | `refine-epic` | Turn an idea into an epic and its sub-issue tasks | tasks land in `Todo` |
| `In Design` | `design-task` | Create the OpenSpec artifacts, open the draft PR, sync each artifact to the issue | stays at `In Design` — the user promotes |
| `In Progress` | `implement-task` | Implement `tasks.md`, write unit tests, mark the PR ready for review | → `In Review` |
| `In Review` | `review-task` | Review the diff against its own design — correctness, security, quality | → `In Testing`, or back to `In Progress` |
| `In Testing` | `test-task` | Exercise the change for real beyond unit scope; route anything only a human can judge | → `In Delivery`, or back to `In Progress` |
| `In Delivery` | `deliver-task` | Sync specs, archive the change, merge the PR | → `Done` |

`Backlog` holds unrefined placeholders; `Todo` holds refined tasks, ready to design. Two transitions are the user's, and no stage makes either: `Todo` → `In Design`, which starts design, and `In Design` → `In Progress`, which starts implementation. Design leaves the task where it found it. The pipeline drives itself from `In Progress` onward.

Design confirms with the user before each artifact when confirmation is available to it. When it isn't, design writes the set without confirming and the draft PR carries the confirmation afterward. Which one applies is discovered from whether asking works, never read from a flag or an environment variable.

# Conventions

Shared by every stage, so no stage restates them.

- **Input.** A stage takes a Linear task, given directly or inferred from context — ask if it's unclear. If asking isn't available and no task can be identified, there's nothing to act on: say so and stop.
- **Read the record.** Before acting, read the task's status history, its comments, and its PR with the threads on it. That's what tells you whether you're resuming an interrupted run, picking up work a later stage routed back and why, what a human has already said, and whether the task has been circling the pipeline. It's context, never a gate — a stage doesn't decline its work over what it reads there, and it can say on the task that something looks stuck. Refusing to dispatch a task belongs to the dispatcher, not to you.
- **Resume, don't restart.** Assume you may be re-entering a task a killed run already worked. Every completion marker — a checked box in `tasks.md`, a status command reporting an artifact complete, a file that exists — records an intent that was true at some moment, so treat it as a claim and check it against the evidence: the commits on the branch, the state of the PR, the threads on it, the comments on the task. Where they disagree, the evidence wins. A run is a fresh checkout, discarded when it ends, so work that was never committed didn't survive the session that made it and a marker can outlive what it claims.
- **Naming.** A task's branch and its OpenSpec change name both derive from the issue's Linear-suggested branch name (`get_issue`): branch as-is, change name lowercased with any leading `<username>/` stripped. OpenSpec requires lowercase, and a slash left in the name nests the change directory and breaks every `--change` lookup.
- **One PR per task.** It opens during design as a draft and stays open until deliver-task merges it. Update it; never open a second. Linear's tools read, comment on, review, and merge a PR but can't create one — opening it is `gh pr create --draft`.
- **Artifact sync.** Each artifact uploads to the issue as a file attachment once it's finalized, never as a draft in progress. `prepare_attachment_upload` with the file's exact byte size, PUT the raw bytes to the signed URL replaying every header it hands back verbatim, then `create_attachment_from_upload` with the returned `assetUrl`, titled with the artifact's name. One artifact at a time — a signed URL expires in 60 seconds, so preparing several up front expires the early ones. There is no update call: a stage that revises a finalized artifact deletes the stale attachment and uploads the replacement in the same run, leaving exactly one copy of each and that copy current. Once the change is archived the task is the durable record of it, so a stale attachment is a lie about what shipped.
- **The issue's own text is the humans'.** No stage overwrites the description — it holds the original ask, and that's what the artifacts are answering. Comments carry the running narrative: blockers, handoffs, and whatever needs a person.
- **Commits.** Lead with the issue identifier — `ENG-135: add resource loader`. Any stage that writes files commits and pushes them before handing off.
- **Threads.** Push a fix before replying to and resolving its thread (`save_diff_comment` with `parentId`, then `resolve_diff_thread`). Never resolve against unpushed work — it tells the reviewer something untrue.
- **Notes as you work.** A convention this change establishes, or a gotcha a future session would otherwise rediscover the hard way, goes in the AGENTS.md nearest the code it applies to — written by the stage that learned it, at the point it learned it, so it rides in the diff and gets reviewed and tested like everything else. Never the root AGENTS.md: that's the workflow, and the next `jen update` replaces it wholesale — a note written there isn't impolite, it's lost. They live at or below `src/`, as deep as the thing they describe. Skip it when nothing clears the bar — a note nobody needed is worse than no note.
- **Comment at the end of every session.** Whatever the outcome — finished, stopped early, or blocked — comment on the issue before you exit. Never finish silently, including when nothing went wrong. Carry what the stage did, what it decided, where it stopped and why, and what the next stage picks up; a bare "done" satisfies the letter of this and is worth nothing. This is what makes a finished run distinguishable from a crashed one, since both leave the status untouched. Its absence is how the next stage knows a run died mid-work and every marker on the task is unverified.
- **No stage waits on a human.** A run may have nobody watching it, and a denied question is not a prompt you can wait out. What needs a human goes on the Linear issue or the PR, anchored to what it concerns, and the run stops cleanly — leaving the status truthful about where the work actually stands.

# Resources

All work happens in the context of resources defined in `registry.yaml`. A resource can be a project's repo, a project-management entry pointing at the repo it tracks, or anything else worth registering.

```
registry.yaml     # All registered resources with access and setup info
src/              # The project's own sources, tracked in this repository — whatever a skill acts on
```

Check `registry.yaml` for the resources relevant to the current task.
