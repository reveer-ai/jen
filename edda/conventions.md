# Conventions

How work is done on this project. These apply to anyone working on it.

## Planning (Linear)

- **The structure.** The `jen` team is the product. A project is a bounded effort with an end state. A milestone is one deliverable inside a project, and issues are the tasks. Don't create epic-style parent issues unless a milestone holds several separate pieces of work that need grouping. Use a Linear initiative, not a project, for a long-running umbrella.
- **Refinement stays light.** When scoping a project or milestone, say what each deliverable is and stop there. Don't specify behavior, don't list what's out of scope, and don't settle design questions. Design happens inside the tasks, once the person doing the work is deep in the problem.
- **Scope as you go.** Each milestone starts with one issue, "Design and scope <subject>". That issue is done when its decisions are written down and the milestone's remaining issues exist. Put each follow-up issue in the same cycle as its milestone. Start the opening issue from a clean slate: re-check the milestone against what earlier milestones actually delivered, not the assumptions it was written under. Decide only what you need to split the milestone into issues.
- **Wording.** Titles describe the work, not Linear's structure. Write "Design and scope the UI engine", not "...and scope the UI engine milestone". Don't call the work a "proof of concept" or a "skeleton". It's the real thing, designed in depth.
- **Cycles** are one week, starting Monday. Plan conservatively and pull work in if it moves faster.
- **Estimates measure the maintainer's time, not the agents'.** Agents write the code, or nearly all of it. The maintainer's time goes to everything else the task needs, and that is what a point sizes. 1 point is about 4 hours of the maintainer's time. Capacity is about 8–9 points a week: 4 hours each weekday plus 12–16 hours over the weekend. Check estimates against actuals at the end of each cycle and recalibrate.
- **Each cycle ends with upkeep.** Run the `tend` skill at the end of each cycle. Each pass is tracked by one Linear issue labeled `tend`, outside cycles and milestones, and puts everything it finds in one pull request. Its findings get no Linear issues of their own. Once the maintainer approves a proposal, it lands in the pass's pull request if it needs no design. If it needs one, it gets an issue of its own and goes through the usual workflow. If the pull request holds only fixes to the project record, docs and skills, the agent squash-merges it without review, since those decide nothing. If it holds anything else, such as a new view, a skill change, a code proposal or a question, the whole pull request waits for the maintainer's review.
- **Split by deliverable, and lean toward fewer, larger tasks.** A task is something shippable and reviewable on its own, not a file or an artifact. Every task pays a fixed cost (its OpenSpec change, pull request and reviews), so merge work that runs through the same code or whose only output feeds another task. Keep a task separate when it can run in parallel. A 1-point task rarely stands alone.

## Feature work (OpenSpec)

- **Virtually all feature work goes through an OpenSpec change.** Write the proposal first and align on it with the maintainer before writing anything else. Then write the design, specs and tasks, and only then implement. Name the change for what it builds. Its Linear issue goes in the proposal.
- **The maintainer opens the proposal discussion.** Before drafting, ask for the maintainer's view of the problem and what needs doing. Then discuss it: compare it with your own view, and disagree where you see it differently. Their view goes first to check you're on the same page, not because it wins. Draft the proposal only once you've aligned.
- **A bug fix trims its artifacts, not its review.** Write a spec delta unless a requirement already forbade what the code did; requirements that were silent are the bug. Write a proposal only if the fix had a real alternative to reject. Skip the design and put the mechanism in `tasks.md`. A change with no delta needs `skip_specs: true` in its `.openspec.yaml`.
- **Keep `docs/` current.** A change that alters what a view in `docs/` describes updates that view in the same pull request.
- **The pull request opens as a draft once the design is written.** Commit the proposal and design, push the task's branch and open a draft pull request titled with the Linear issue ID, so the maintainer can review the artifacts with inline comments. Later artifacts and the implementation land on the same pull request.
- **Every apply ends with a commit and push to the pull request**, without asking. Stop and ask instead if implementation paused, a task was narrowed or deferred, a check failed, or a question is still open.
- **A fresh agent reviews the implementation before the maintainer does.** Once the implementation is verified, run `flo-review`. Its handoff is `deliver-change`, which marks the pull request ready for review. Until then it stays a draft. Designs go to the maintainer with no agent review. Once the maintainer approves, `deliver-change` archives the change and merges it.

## Design

- **One complete mechanism.** Choose the simplest mechanism that fully solves the problem, and commit to it. Don't stack mechanisms that each cover part of the case. Judge each candidate by what it fails to catch. A safety bound is a fixed constant, not a setting an agent could turn off.
- **Design a feature as it should be, not around what jen lacks.** If the right design depends on something jen doesn't have yet, that becomes its own task, and the design builds on it. Something a later feature might want is different: don't build it, but don't rule it out.
- **No machinery for a case that doesn't exist.** If nothing a mechanism would serve exists yet, a line in the docs covers it until something does. The same goes for guarding something transient: remove it when it's done rather than adding configuration around it.
- **A prompted convention can beat costly enforcement.** When enforcing a rule would take new infrastructure, identities or configuration to keep in sync, state it as a convention instead. Unenforced is acceptable; undetectable isn't, so say how a breach would show.

## Skills and prompts

- **Say only what's specific to this project, or what a capable model wouldn't do on its own.** Generic advice, such as an API's contract, a list of common failure modes or a severity scale, costs every run tokens and pulls the model toward it.
- **State nothing more certainly than it holds.** Phrase a claim as a check or an outcome ("This pass checks whether…") rather than as a fact that may not hold. Hedging with "may" isn't the fix.

## Git and verification

- **Every push carries the record.** Commit any pending `edda/` changes with the task's own files.
- **Pull requests are squash-merged.** The `main` ruleset allows nothing else, and refuses any push to `main` that isn't a merged pull request (see `environment.md`).
- **An outside pull request gets the maintainer's review.** Its CI runs only once the maintainer approves its workflows, after reading what it changes. Agents review it when the maintainer asks.
- **Git history should read the way the work should have happened.** Rewriting a branch's history to fix it is acceptable, and `main`'s can't be rewritten: take a backup ref first and confirm with the maintainer before force-pushing. Linear's history is an audit trail, so never replay statuses on it; add a comment or attachment instead.
- **Nothing is done until the check that could prove it wrong has run.** If a live check is still outstanding, say the work is unverified and name what that check could still find. A command handed forward by earlier work is a claim too: run its read-only half and compare before repeating it.
