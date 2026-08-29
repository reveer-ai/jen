## Why

`stage-execution` requires that a run hold exactly one role's credentials and that a session be unable to obtain another's. `cli/exec.ts`'s `childEnvironment` builds a session's environment by copying the runner's entire environment and stripping only `JEN_GH_*`:

```ts
for (const [key, value] of Object.entries(base)) {
  if (key.startsWith('JEN_GH_')) continue;
  env[key] = value;
}
```

The role requirement is in fact satisfied — `JEN_GH_*` covers the app id, installation, and private key of every role, so `design` cannot read `deliver`'s. What the spec never says is that anything *else* is passed through at all. The mechanism carrying a project's own variables into its stages exists, is load-bearing, and is described by nothing, so there is no statement anywhere of what a session receives or of what an operator can do about it.

**The spec is what is wrong, not the passthrough.** A project's own commands are exactly what the stages run, and `stage-execution` already requires that a project's grants be honoured for commands jen cannot know about. A suite that needs a test database URL is the same case arriving through the environment instead of through `.claude/settings.json`. Passing those variables through is correct and stays.

Two things are genuinely missing, and they are narrow:

**Nothing can be withheld from one stage.** Every stage receives the same set. `ENG-171` established the case this fails: a credential to a live environment is testing's and must not reach the stage that merges. It cannot be arranged by role — review, testing, and delivery all act as `deliver` (`cli/stages.ts`) — so a role-keyed rule hands testing's key to `deliver-task`. There has to be a lever that keys on the stage, and there is none.

**The strip is narrower than jen's own namespace.** `JEN_TEAM`, `JEN_PROJECT`, and `JEN_REPO` are the runner's configuration and reach every session. Nothing in `.claude/skills/` or `payload/` reads them, so nothing is served by their arriving.

## What Changes

**Project-supplied environment is named, and passed through by default.** `stage-execution` gains a requirement saying what today's code already does: a session inherits the environment the runner was given, because a project's checks need variables jen cannot enumerate. Writing it down is most of this change — an undescribed mechanism is one the next change breaks without knowing it did.

**The strip widens from `JEN_GH_*` to `JEN_*`.** jen owns that namespace, which is what makes withholding it by prefix exhaustive rather than a heuristic: the set is closed and jen defines it, so there is no unnamed member to miss. `LINEAR_API_KEY` and `ANTHROPIC_API_KEY` are already overwritten with the session's own and need nothing further.

**An operator can restrict a variable to one stage.** The new lever, named after the skill the way the credential variables are named after the role. Its value is a list of variable *names*, comma-separated — never a value:

```
JEN_ENV_TEST_TASK=STAGING_SSH_KEY,SMOKE_TARGET
```

`STAGING_SSH_KEY` and `SMOKE_TARGET` reach `test-task` under their own names and are stripped from every other stage. `deliver-task` and `review-task` do not receive them, and that they share `test-task`'s role does not change it. Opt-in and additive: an operator who declares nothing gets exactly today's behaviour.

Naming rather than carrying the values is what keeps a project's variables under the project's own names — a suite reads `DATABASE_URL`, not a jen-shaped alias of it — and keeps this a scoping instruction rather than a second place a secret is written down. The cost is that a list of one is indistinguishable at a glance from a plain value, which is a documentation obligation more than a design one.

**A restricted name that is not set is reported, not refused.** Declaring a variable stage-restricted when no such variable exists asks jen to withhold nothing from anyone. Nothing is at risk and no stage is short of anything it would otherwise have had, so the run proceeds and says what it found — the misspelling is worth surfacing, and stopping a pipeline over it is not proportionate to a declaration that had no effect either way.

## What this deliberately does not do

**It does not invert the passthrough.** Deny-by-default — inherit nothing but a jen-supplied list of operating variables plus what the operator declares — was designed and rejected, and the reason is worth not re-deriving. The list would be a guess: toolchains read `NODE_OPTIONS`, `npm_config_*`, `CARGO_HOME`, `VIRTUAL_ENV`, `ASDF_*`, `GOPATH`, proxy settings and more, no enumeration of them is ever complete, and every name missed surfaces as a stage failing at the first command that needed it — mid-run, unattended, presenting as a broken stage rather than as a list jen got wrong. That is precisely the late failure `stage-execution` already warns about for permissions, and inverting the default would manufacture it.

The invariant that motivated the inversion is narrower than the inversion: *some* variables must be withheld from *some* stages, which the restriction lever above satisfies exactly, without every project having to enumerate its own environment to keep working.

**It does not treat the operator's own machine as hostile.** What is in an operator's shell is the operator's, on a runner they chose, against their own repository. jen is a workflow tool and not a sandbox, and an operator who wants a variable narrowed now has the means to narrow it.

## Capabilities

### Modified Capabilities

- `stage-execution`: one requirement added, for the category the capability is silent on — that a session inherits the runner's environment so a project's own checks can run, that jen's own namespace is withheld from it, that an operator may restrict a named variable to a single stage, and that the restriction keys on the stage rather than on the role.
- `adoption-docs`: one requirement added beside the one already carried for permissions — that the documentation tells an adopter what the environment they set on a runner reaches, and how to narrow one variable to one stage.
- `task-dispatch`: one requirement revised — *Every finished dispatch is reported as a run record*, which enumerates what the record names and what the readable report carries. Reporting a declaration that scoped nothing puts a field in the record and a line in the report, and the enumeration is closed, so it is restated to name them. Added in review; see `design.md` under *Notes are a channel distinct from failures* for why the original judgement that this was purely additive was wrong.

`pipeline-identity` is **not** modified. It states that a run acts under exactly one role, which is untouched by naming a category that is not a role's credential.

## Impact

- `openspec/specs/stage-execution/spec.md` — one requirement added. The existing credentials requirement is unchanged and stays true.
- `openspec/specs/adoption-docs/spec.md` — one requirement added.
- `openspec/specs/task-dispatch/spec.md` — one requirement revised, to carry what a run had to say in the record and in the readable report.
- `cli/exec.ts` — `childEnvironment` takes the stage into account, widens its strip, and reports a restriction naming a variable that is not set.
- `test/exec.test.ts` — that a stage receives the runner's environment, that `JEN_*` does not survive, that a restricted variable reaches its stage and no other, that `deliver-task` does not receive `test-task`'s restricted set despite sharing its role, and that an unset restricted name is reported without failing the run.
- `README.md` — a subsection beside *Grant the permissions the stages need*, on the same terms: what you put on the runner reaches your stages, and here is how to narrow one.
- **No behaviour change for an operator who declares nothing**, beyond three `JEN_*` variables no longer reaching sessions that never read them. Existing local runners keep working.
- **A gap this does not close**, filed as its own task: the scheduled runner has no way to deliver project variables at all, because `.github/workflows/jen.yml` is a managed file and `jen update` rewrites it, so anything an adopter adds to its `env:` block is lost on the next version. Closing it means declaring the names in `registry.yaml` and having `jen update` resolve them into the workflow — the mechanism that already fills in the team and project — which touches `managed-payload` and `project-binding`, and is why it is not this change.
