## 1. Substitution in the payload engine

- [x] 1.1 Promote `yaml` from a devDependency to a dependency, and add a registry reader that returns the tracker team and project from the single `kind: project-management` resource — resolving to nothing when the file is absent, unparseable, or names zero or several such resources, and never throwing on a malformed file.
- [x] 1.2 Declare substitution as data on a managed file in `payload.ts`: a closed set of names (`team`, `project`), the `{{jen:name}}` placeholder form, and no way for a payload file to express anything else.
- [x] 1.3 Resolve substitutions in `plan.ts` so the planner still only reads, carry the rendered bytes and the unresolved names on the plan, and have `apply.ts` write what the plan already resolved. No filesystem write moves into the planner.
- [x] 1.4 Report unresolved values from `init` and `update`, naming each one and why it did not resolve — no registry, no tracker resource, or several.
- [x] 1.5 Tests in `test/plan.test.ts` and `test/install.test.ts`: a value resolves; an absent value renders empty and never leaves the placeholder in the output; a re-run after the registry changes rewrites the file; substitution does not change what paths are written, refreshed, or reconciled.

## 2. The scheduled workflow as a managed file

- [x] 2.1 Write the workflow template: `schedule` and `workflow_dispatch` triggers, a 30-minute cron, a `concurrency` group with `cancel-in-progress: false`, `timeout-minutes: 120`, no `actions/checkout`, and a job that installs the published CLI and runs `jen run`.
- [x] 2.2 Wire the environment: the substituted team and project, `LINEAR_API_KEY`, `ANTHROPIC_API_KEY`, and the nine `JEN_GH_*` secrets — app id, installation id, and private key for each of `DESIGN`, `DEV`, and `DELIVER`.
- [x] 2.3 Declare the workflow in `payload.ts` as a fixed path at `.github/workflows/jen.yml`, carrying substitution and no ownership stamp.
- [x] 2.4 Update `test/payload.test.ts` and `test/package.test.ts` for the new declared path and for its presence in the staged payload and the tarball.
- [x] 2.5 Tests that the shipped workflow parses as YAML, names only environment variables the CLI actually reads, and performs no checkout — the last as a source-level assertion, since it is the property that keeps the poll cheap.

## 3. The halt, and the project it halts

- [x] 3.1 Add the project lookup to `linear.ts` — resolve the named project to exactly one, asking for two so ambiguity is detectable, and read its status type. Name every field, and ask for `pageInfo` as every other bounded connection does.
- [x] 3.2 Refuse in `run.ts` when the name matches several projects or none, before polling, beside the existing credential and `Pending` refusals.
- [x] 3.3 Halt in `run.ts` when the project's status type is `paused`, `completed`, or `canceled` — reported, dispatching nothing, leaving running sessions alone. Halt on named types rather than on "not started".
- [x] 3.4 Tests in `test/dispatch.test.ts`: each halting type halts and reports; a backlog or planned project polls normally; two matching projects refuse; the halt leaves the tracker untouched, and the tick still imports nothing from `node:fs`.

## 4. Run records

- [x] 4.1 Add an `event` discriminator to the run request emitted on stdout, and emit a run record per finished dispatch carrying task, skill, role, outcome, cost, session id, terminated, whether the session started, and the transcript's disposition.
- [x] 4.2 Carry each run's cost into the human-readable report on stderr, beside its outcome line, distinguishing a session that reported no cost from one that reported zero.
- [x] 4.3 Tests: both kinds of line are emitted and distinguishable; neither carries a credential; a record is emitted for a failed, a terminated, and a never-started session; emitting a record writes nothing to the tracker.

## 5. Transcripts

- [x] 5.1 Add `--transcripts <dir>` to `jen run`, and write each session's stream there when it is set, outside the run directory that gets swept and never into the clone.
- [x] 5.2 Report a transcript that could not be written among the run's failures rather than over them, on the same terms as a failed cleanup, and never turn a successful session into a failed one.
- [x] 5.3 Tests in `test/exec.test.ts`: unset discards and the record says so; set writes the file and the record names it; the file outlives the swept run directory; an unwritable directory is reported without changing the outcome.

## 6. `jen watch`

- [x] 6.1 Add the `watch` command: a project path, `--interval` defaulting to 60 seconds, and `--team`/`--project` overriding what the registry says. It resolves the project identity from the checkout and passes it into the tick; `jen run` still reads no file.
- [x] 6.2 Loop: await the tick, then wait the interval, so the interval is a floor between ticks and two ticks never overlap.
- [x] 6.3 Continue after a tick that failed or halted, and exit non-zero on a refusal that cannot change while the process runs — a missing credential, or a team and project that could not be resolved.
- [x] 6.4 Own the signal handlers for the length of the process: stop scheduling, forward to the sessions in flight, wait, exit. Ensure `jen run`'s per-invocation handlers are not installed twice.
- [x] 6.5 Extend the usage text for `watch` and its flags, and state that the two runners' default intervals differ and why.
- [x] 6.6 Tests in `test/cli.test.ts`: the loop ticks repeatedly and stops on signal; the interval is honoured from the end of a tick; a failing tick does not end the loop; a missing credential does; the registry's values reach the tick and an override beats them; no lock file or state file is written anywhere.

## 7. Binding

- [ ] 7.1 Extend the `setup-jen` skill to finish by running `jen update`, confirm the substituted values reached the workflow, and report which resolved — naming what the registry is missing where none did.
- [ ] 7.2 Extend it to check whether the scheduled workflow has been disabled by the git host, since a re-run of binding is where an adopter would find out.

## 8. Documentation

- [ ] 8.1 Add the runner chapter to `README.md`: choosing between the two, what each needs configured, the eleven secrets by name, and starting each one.
- [ ] 8.2 State the conditions each runner carries — schedule dormancy on an inactive public repository and how to re-enable, and a local session dying with its process and what the task then reads.
- [ ] 8.3 Document the halt as the tracker's project status, under both runners, and what the pipeline does unsupervised: the transitions a human still owns, that a stage may park a task at `Pending`, and the concurrency cap.
- [ ] 8.4 Extend the ownership boundary ahead of the install instructions: the workflow is jen's, it is the one managed file outside `.claude/` and the root, and the registry — not the workflow file — is where its values are changed.

## 9. Notes

- [ ] 9.1 Record in `cli/AGENTS.md` what the next session would otherwise rediscover: that a job-level `if` cannot read the `env` context, which is why an unbound project fails rather than skipping; that substitution must never emit the placeholder; and that the local runner deliberately holds no lock.
