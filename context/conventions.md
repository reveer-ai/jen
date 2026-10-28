# Conventions

How work is done on this project. These apply to anyone working on it.

## Planning (Linear)

- **The structure.** The `jen` team is the product. A project is a bounded effort with an end state. A milestone is one deliverable inside a project, and issues are the tasks. Don't create epic-style parent issues unless a milestone holds several separate pieces of work that need grouping. Use a Linear initiative, not a project, for a long-running umbrella.
- **Refinement stays light.** When scoping a project or milestone, say what each deliverable is and stop there. Don't specify behavior, don't list what's out of scope, and don't settle design questions. Design happens inside the tasks, once the person doing the work is deep in the problem.
- **Scope as you go.** Each milestone starts with one issue, "Design and scope <subject>". That issue is done when its decisions are written down and the milestone's remaining issues exist. Put each follow-up issue in the same cycle as its milestone.
- **Wording.** Titles describe the work, not Linear's structure. Write "Design and scope the UI engine", not "...and scope the UI engine milestone". Don't call the work a "proof of concept" or a "skeleton". It's the real thing, designed in depth.
- **Cycles** are one week, starting Monday. Plan conservatively and pull work in if it moves faster.
- **Estimates measure the maintainer's time, not the agents'.** Agents write the code, or nearly all of it. The maintainer's time goes to everything else the task needs, and that is what a point sizes. 1 point is about 4 hours of the maintainer's time. Capacity is about 8–9 points a week: 4 hours each weekday plus 12–16 hours over the weekend. Check estimates against actuals at the end of each cycle and recalibrate.

## Feature work (OpenSpec)

- **Virtually all feature work goes through an OpenSpec change.** Write the proposal first and align on it with the maintainer before writing anything else. Then write the design, specs and tasks, and only then implement. Name the change for what it builds. Its Linear issue goes in the proposal.
- **The maintainer opens the proposal discussion.** Before drafting, ask for the maintainer's view of the problem and what needs doing. Then discuss it: compare it with your own view, and disagree where you see it differently. Their view goes first to check you're on the same page, not because it wins. Draft the proposal only once you've aligned.
