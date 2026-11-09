---
name: tend
description: Periodic upkeep of a project. Keep its project record and docs accurate and well shaped, keep its skills current, and propose code cleanups worth making. Use at the end of a cycle, or when asked to tend or tidy the project.
---

# Tend the project

Change after change, a project drifts. The project record and docs fall behind the code, and the code's organization falls behind what the code has become. This pass catches that drift. It never changes what the project does or decides.

**Most passes should change little or nothing.** Running this skill is not a reason to change anything. Make a change only when you can say what's wrong without it: a claim that's false, a reader who would be misled or slowed down, or a gap the evidence shows. Rewording for taste, or reorganizing something that still works, doesn't pass that test. If nothing passes it, the pass is done.

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

If you changed anything, open one pull request titled `Tend <YYYY-MM-DD>` with the fixes to the project record, docs and skills, and merge it as the project's conventions say. Its description lists what was changed, moved or removed, and why. It then lists any questions and proposals for the maintainer: new views, new or changed skills, and code cleanups.

If you changed nothing, open nothing. Report any questions and proposals to the maintainer directly.
