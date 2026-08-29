---
"@reveer/jen": minor
---

Scope what a stage session inherits from the runner.

**What you set on the runner reaches your stages, and that is now the documented mechanism rather than a side effect of how a session is started.** A suite that connects to `DATABASE_URL` finds `DATABASE_URL`; an integration test that reads `API_BASE_URL` finds that. Inverting this into a list of the variables jen can name was considered and rejected: no such list is complete for an arbitrary toolchain, and every name left out of one surfaces as a stage failing at the first command that needed it — mid-run, with nobody watching, presenting as a broken stage rather than as a list jen got wrong.

**jen's own `JEN_*` namespace is withheld from every session, and the strip has widened to cover all of it** rather than the role credentials alone. jen defines that namespace, so withholding it by prefix is exhaustive rather than a guess at what a name might mean. The requirement that a run hold exactly one role's credentials and that a session be unable to obtain another's is unchanged — this is the category around it that the spec had never named.

**A variable can now be narrowed to a single stage.** `JEN_ENV_TEST_TASK=STAGING_SSH_KEY,SMOKE_TARGET` gives those two variables to `test-task` and to no other stage. The value is a list of variable *names*, not values, so your secret stays written down in one place and reaches your commands under its own name. The narrowing keys on the **stage**, not the role — reviewing, testing, and delivering all act under the one `deliver` role, so nothing about the roles keeps testing's variable from the stage that merges, and keying on the role would hand it over. Declare nothing and nothing changes: an unnamed variable reaches every stage.

**A declaration that scoped nothing is reported and does not fail the run.** A misspelt stage name, or a variable the runner never held, leaves every stage holding exactly what it would have held anyway — so the run says what it found, in the record and in the readable report, and carries on. Run records gained a field for this that is always present and may be empty, and it names a variable rather than carrying its value. Failing an unattended pipeline over a typo that changed nothing would be the worse trade.

**This is the local runner's today.** `jen watch` reads the environment of the shell you started it in. The scheduled runner cannot carry your variables at all — Actions secrets are not ambient and `jen run` is handed a closed list of names in the managed `.github/workflows/jen.yml` — so a secret you store as `DATABASE_URL` was never on that runner to withhold. Giving the scheduled runner a way to carry your own configuration is its own piece of work, and nothing here changes when it lands.
