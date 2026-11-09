---
name: tend
description: Periodic upkeep of a project. Keep its project record lean and true, fix docs that drifted, sharpen its skills, and propose concrete refactors. Use at the end of a cycle, or when asked to tend, tidy or spring-clean the project.
---

# Tend the project

Change after change leaves a project less coherent than if it had been designed whole. The project record accretes, docs drift, workflows repeat by hand, and code grows by addition. This pass puts it back in shape, and adds no behavior.

Your scope is everything since the last pass. Find it with `git log --grep '^Tend '`; if there's none, the scope is the whole project. Read the project record first, starting from its index.

## 1. The project record

Read all of it as a fresh agent would, and fix what gets in that agent's way:

- **Copies.** If code, a spec, git history, a pull request or the issue tracker already holds it, link there or delete it.
- **Words.** Say the same thing in fewer.
- **Staleness.** Retire superseded content as the project record's rules say. Check each claim you doubt against the code and the tools; the evidence wins.
- **Shape.** Restructure a file read for two reasons, knowledge with no natural home, or anything a reader has to wade through. Update the index to match.
- **Stray conventions.** If your tool keeps private memory, look in it for project conventions the project record lacks and move them in. Personal and tool-specific notes stay where they are.

## 2. The docs

For each view, list the commits that touched the paths in its `<meta name="describes">` since the view itself last changed: `git log $(git log -1 --format=%H -- <view>).. -- <paths>`. Check each listed view against the code, then fix it, or bump its `<meta name="checked">` date if it still holds. Name any part of the system that has no view to explain it, as a proposal.

## 3. The skills

Read the friction notes in the briefings of pull requests merged within your scope. A workflow done by hand twice is a skill to write. A skill that no longer matches how the work is done is one to fix. Write or fix them in this pass.

## 4. The code

Survey the code for structure its history left behind, and propose specific changes. Don't make them. Agents carry out an exactly specified refactor well and an open-ended cleanup badly, so each proposal is carried out later as a change of its own.

Look for duplication across modules, a file or function doing several jobs, code a later change made redundant, names that no longer say what something does, wasteful paths, error handling that hides failures, flaky tests and their causes, and specs or tests that cover the same thing twice.

Each proposal states exactly what to change, the evidence (paths, lines, history) and what it buys: legibility, speed or reliability. It changes no requirement and no test's assertion. One that must is a behavior change, so mark it as a bug or a feature instead. Leave out anything you can't back with evidence. A few strong proposals are worth more than many weak ones.

## Output

One pull request titled `Tend <YYYY-MM-DD>`, holding the fixes to the project record, docs and skills. Its description summarizes what changed and why, and ends with the code proposals, ranked, for the maintainer to choose from. Create issues only for the ones they choose.
