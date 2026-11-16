---
name: tend
description: Periodic upkeep of a project. Keep its project record and docs accurate and well shaped, keep its skills current, and propose code cleanups worth making. Use at the end of a cycle, or when asked to tend or tidy the project.
---

# Tend the project

This pass checks whether the project record, the docs and the code's organization still match what the code has become, and fixes them where they don't. It never changes what the project does or decides. Specs describe what the project does, so it never edits them either. Where a spec and the code disagree, ask.

**A pass that changes nothing is a good result.** Running this skill is not a reason to change anything. Make a change only when you can say what's wrong without it: a claim that's false, a reader who would be misled or slowed down, or a gap the evidence shows. Rewording for taste, or reorganizing something that still works, doesn't pass that test. If nothing passes it, the pass is done.

Survey everything first. List each change you'd make and why, drop the ones that don't pass, and only then edit.

Your scope is what changed since the last pass: by the project's conventions, the cycle that's ending.

## The project record

Keep it accurate, complete and well shaped, following its own rules. Check its claims against the code and the tools, and fix what's false. Add what the evidence shows was missing, such as something an agent had to rediscover, or a question a pull request had to answer. When its shape stops fitting, reorganize it. If your tool keeps private memory, move any project conventions you find there into the project record.

You keep the project record, but you don't decide for the maintainer. Never add, change or remove a decision, convention or direction on your own judgment. Where the project record contradicts itself and the evidence doesn't settle it, ask instead.

## The docs

For each view, find the commits that touched the paths in its `<meta name="describes">` since the view last changed: `git log $(git log -1 --format=%H -- <view>).. -- <paths>`. Make each affected view accurate, or bump its `<meta name="checked">` date if it still holds. Improve a view where a reader would understand the system better for it. A new view is a proposal, since each one is one more thing to keep in sync.

## The skills

Fix any skill that is out of date with how the project works now, or with the names it uses. A new skill, or a change to how a skill works, changes every agent's behavior, so propose it instead. The evidence for a new skill is in the friction notes of the briefings within scope: the same work done by hand more than once.

## The code

Look only at how the code is organized and how it reads: layout, naming, a module doing two jobs, duplication, and code a later change left redundant. Never look at what it does. Bugs, performance and tests are out of scope.

Propose; don't change anything. Each proposal says exactly what to change, where, and why the code is clearer for it. It changes no requirement and no test assertion. Propose only what's worth a change of its own and the maintainer's time to review it. Usually that's nothing.

## Output

Each pass is tracked by one issue in the project's tracker, titled `Tend: <date>` with the day the pass runs, written like `Tend: November 9th`. Label it `tend` and keep it outside any cycle or milestone. Create it before you start, even if the pass may find nothing. Findings get no issues of their own. An approved proposal that needs a design is the exception: it gets its own issue, and one that needs none lands in this pass's pull request.

Everything the pass produces goes in one pull request, done under the issue as the project's conventions say, with ` [tend]` at the end of its title. Its description lists what was changed, moved or removed, and why.

- **Fixes only.** Merge it as the project's conventions say.
- **Anything else.** Make each proposal to the project record, docs or skills in the same pull request. Write each code proposal and each question in its description. Then leave the whole pull request for the maintainer to review, and don't merge it.

A pass with questions or code proposals but nothing to change still opens its pull request, on an empty commit. If there's nothing at all, open no pull request, and close the issue as done with a comment saying so.
