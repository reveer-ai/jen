## 1. Parse what the operator declared

- [ ] 1.1 Add a parser in `cli/exec.ts` that reads every `JEN_ENV_*` key out of an environment and returns, per stage token, the list of variable names it declares — comma-separated, entries trimmed, empty entries dropped, names compared case-sensitively (`design.md` — *A list holds names, and the names are trimmed*).
- [ ] 1.2 Validate each token against `STAGES` from `cli/stages.ts`, deriving the expected token from each stage's `skill` the way `VARIABLES` in `cli/github.ts` derives its role tokens — uppercased, `-` to `_`. Keep the derivation in one place so `JEN_ENV_TEST_TASK` and `JEN_GH_APP_ID_DEV` cannot drift apart in how they are spelled.
- [ ] 1.3 Have the parser return unrecognized tokens separately from the valid declarations, so the caller can report them and discard their lists rather than letting their names reach `claimed`.

## 2. Scope what a session inherits

- [ ] 2.1 Give `childEnvironment` the request's skill — `#session` already holds the `RunRequest`, and it is the only caller — and derive this stage's token from it rather than from the role.
- [ ] 2.2 Widen the strip from `JEN_GH_` to `JEN_`, and confirm at the point of the change that nothing under `.claude/skills/` or `payload/` reads `JEN_TEAM`, `JEN_PROJECT`, or `JEN_REPO` from inside a session.
- [ ] 2.3 Implement the inheritance test: a key is inherited unless it is prefixed `JEN_`, or it appears in the union of every stage's declared names and not in this stage's own. Reading *every* stage's list, not just this one's, is what lets a stage know a name was spoken for (`design.md` — *Scoping requires reading every stage's list*).
- [ ] 2.4 Leave the seven variables jen assigns after the copy exactly where they are, so they continue to override anything inherited or restricted.

## 3. Report a declaration that did nothing

- [ ] 3.1 Add `notes: string[]` to `RunOutcome` in `cli/exec.ts`, kept out of the `ok` derivation so a note cannot fail a run the way a `failures` entry does.
- [ ] 3.2 Return `{ env, notes }` from `childEnvironment` and thread the notes through `#session` to where `launch` builds the outcome.
- [ ] 3.3 Emit a note naming an unrecognized stage token alongside the tokens that would have been valid, and a note naming a restricted variable the runner does not hold.
- [ ] 3.4 Carry `notes` into `RunRecord` and `runRecord` in `cli/run.ts`, and print them in the readable report beside the loop that prints `result.failures` — on every branch, for the reason the comment there already gives.
- [ ] 3.5 Add `notes` to `LaunchResult` in `cli/run.ts`, keeping it structurally satisfied by `RunOutcome` without `run.ts` importing from `exec.ts`.

## 4. Cover it in tests

- [ ] 4.1 Widen the stub's env filter in `test/exec.test.ts` — it currently records only `JEN*`, `GH*`, `GITHUB*`, `GIT_*`, `CLAUDE_CONFIG_DIR`, `LINEAR_API_KEY`, and `ANTHROPIC_API_KEY`, so a project variable like `DATABASE_URL` would be invisible to every assertion below.
- [ ] 4.2 A variable the operator set on the runner reaches a session under its own name.
- [ ] 4.3 No `JEN_*` variable survives into a session — `JEN_TEAM` and `JEN_PROJECT` as well as the `JEN_GH_*` keys the existing assertion covers.
- [ ] 4.4 A variable declared for `test-task` reaches `test-task` and reaches no other stage.
- [ ] 4.5 `deliver-task` does not receive `test-task`'s declared variable, despite both acting as `deliver` — the case a role-keyed rule would get wrong, and the reason this keys on the stage.
- [ ] 4.6 A name declared by two stages reaches both.
- [ ] 4.7 An unrecognized stage token is reported in the run's notes, its names are inherited as though undeclared, and the run still reports `ok`.
- [ ] 4.8 A declared name the runner does not hold is reported in the notes without failing the run.
- [ ] 4.9 With no declaration set, a session's environment is what it is today less the `JEN_*` keys.
- [ ] 4.10 `notes` appears in the emitted record — extend the existing record assertions in `test/exec.test.ts` or `test/dispatch.test.ts`, wherever `RunRecord`'s shape is currently pinned.

## 5. Tell the adopter

- [ ] 5.1 Add a subsection to `README.md` beside *4. Grant the permissions the stages need*: what an operator sets on the runner reaches the stages, and jen's own `JEN_*` namespace — the role credentials included — does not.
- [ ] 5.2 Document `JEN_ENV_<STAGE>` with an example naming **two** variables, never one, and say in the surrounding text that the value is a list of variable names rather than a value.
- [ ] 5.3 State that the narrowing keys on the stage, and that reviewing, testing, and delivering share the `deliver` role — so an adopter reasoning from roles does not expect the role to arrange it.
- [ ] 5.4 Add assertions to `test/adoption-docs.test.ts` for the claims above, in the style the file already uses: the section exists, the example names more than one variable, and the role-sharing caveat is present.

## 6. Close it out

- [ ] 6.1 Run `npm run typecheck`, `npm run lint`, and `npm test`.
- [ ] 6.2 Run `openspec validate eng-176-scope-a-sessions-inherited-environment-so-the-spec-and-the --strict`.
- [ ] 6.3 Consider a note in `cli/AGENTS.md` on why the scoping reads every stage's declaration rather than only the running stage's — the part of this that reads like a bug until the withholding case is in mind. Skip it if the code's own comments already carry it.
