## Why

`credentialsFor` in `cli/github.ts` requires `ANTHROPIC_API_KEY`, and `childEnvironment` in `cli/exec.ts` writes it into every session:

```ts
model: 'ANTHROPIC_API_KEY',
…
modelKey: required(env, VARIABLES.model, 'a session cannot run without model access'),
```

That is the only way a run reaches a model, so operating the pipeline means funding an API key — including for an adopter already paying for a Claude subscription, which is the case that prompted this.

**The CLI a session runs already accepts either.** `claude setup-token` is present in the shipped CLI, its help reading *requires Claude subscription*, and it mints a long-lived token the CLI reads from `CLAUDE_CODE_OAUTH_TOKEN`. Both names are live in the 2.1.251 binary. Neither mode is anything but an environment variable, so what changes here is which name jen demands — not how it starts a session, not what it passes on the command line, and nothing about the session itself.

**Both stay supported, because neither is the better one.** The subscription is not simply cheaper: its usage limits are shared with the operator's own interactive work, and a pipeline that polls every 30 minutes and launches several sessions per tick can exhaust the window they were about to work in. That surfaces as a stage dying mid-run rather than as a bill — the quiet, unattended failure this project keeps refusing elsewhere — so an adopter has to be able to pick either one knowingly rather than be defaulted into one.

## What Changes

**Model access becomes one slot with two accepted spellings.** `VARIABLES.model` stops being a single name and becomes the pair jen accepts. `credentialsFor` requires one of the two rather than a particular one, and `Credentials` carries *which* name the run holds alongside its value — the value alone is no longer enough to act on, because the session has to be given it back under the right name.

**Neither set is refused as it is today, and the message names both.** The existing refusal shape is unchanged and is the point: every credential is read before anything else happens, a misconfigured run fails naming what is absent, and no session is started. Only the condition widens, from *this name is missing* to *neither name is set*.

**Both set is refused too, and this is the decision the task left open.** The alternative was a documented precedence, and it is the worse one here. An `ANTHROPIC_API_KEY` exported in a shell profile is the ordinary state of a developer's machine — it is read by more than jen — so the operator who exports `CLAUDE_CODE_OAUTH_TOKEN` to run the pipeline off their subscription is precisely the operator who has both. Under a precedence they get whichever jen picked, silently, and the two ways of being wrong are: billing an API key they believed they had stopped using, or spending a subscription window they meant to keep for themselves. Under a stale OAuth token the failure moves later still — sessions that authenticate against an expired credential and die mid-run, unattended, which is the displaced failure `credentialsFor` exists to prevent.

A refusal costs an operator one `unset` and tells them exactly which. It fails at configuration time, where a person is, rather than at run time, where nobody is. The refusal is worded differently from the absent case rather than sharing its sentence: unlike a missing variable, the fix is not self-evident from the name, so the message says to hold one and unset the other.

Emptiness is decided the same way `required` already decides it — an unset repository secret expands to `""` in a workflow, and an empty value is not *set*. That is what lets the managed workflow pass both secrets through unconditionally without every adopter who set one being told they set two.

**The unheld name is deleted from the session's environment, not merely left unwritten.** `childEnvironment` copies the runner's environment wholesale and then writes jen's own over the top, which today makes an inherited `ANTHROPIC_API_KEY` harmless because jen overwrites that exact name. Once jen may write the *other* name instead, an overwrite no longer covers it. The delete makes the unit's own contract true — a session holds exactly one model credential, the one jen chose — without depending on its caller having refused the ambiguous case upstream.

**The count survives: eleven values, either way.** Three per role for three roles, the tracker key, and one model credential under one of two names. The adopter's documentation and `setup-jen` both say *eleven* and both enumerate the names, and `test/adoption-docs.test.ts` derives that enumeration from `VARIABLES` rather than restating it — so a `VARIABLES.model` that becomes a pair reaches the assertion rather than going stale behind it.

**The managed workflow passes both secrets through.** `payload/jen.yml` gains the second name beside the first. An adopter sets whichever they hold; the other arrives empty and reads as absent.

## What this deliberately does not do

**It does not choose between them for the adopter.** The documentation states what each costs — shared usage limits against a per-key bill, and a personal long-lived credential against one that is scoped and revocable per key — and the adopter decides. jen refusing one of them, or preferring one, would be jen making a spending decision on someone else's account.

**It does not move the model credential into `impossible()`.** A model credential that is absent — and now one that is ambiguous — fails each dispatched run inside the executor, is recorded in that run's failures, and leaves the local runner polling. That is exactly what a missing `ANTHROPIC_API_KEY` does today. `impossible()` holds the tracker credential, the team, the project, and the concurrency, and is the gate that stops `jen watch` before its first tick; moving the model credential up to sit beside them changes what stops a runner, which is a decision about `pipeline-runner` rather than about this credential, and it would be equally true of the nine role variables that are not there either.

**It does not introduce a per-stage or per-role model credential.** One run, one model credential, as today. A `JEN_ENV_<STAGE>` declaration can already withhold a name from a stage, and nothing here changes what that lever does.

**It tracks no spend and no usage limit.** jen cannot see either, and a warning it cannot ground is worse than the sentence in the documentation that says the limits are shared.

## Capabilities

### Modified Capabilities

- `stage-execution`: one requirement added — that a run reaches a model through either of two named credentials, holds exactly one, refuses before starting a session when it holds neither or both, and gives the session the one it holds under that credential's own name with the other absent.
- `adoption-docs`: one requirement revised — *The documentation says how autonomy is turned on, and what it does once it is*, which is where the values each runner needs are enumerated. The model slot now has two spellings, and which one an adopter should reach for is not answerable from the names.

`pipeline-identity` is **not** modified. It governs the three git-host roles and the one tracker agent; the model credential is neither, is shared by every role, and is not an identity the pipeline acts under.

## Impact

- `openspec/specs/stage-execution/spec.md` — one requirement added. The existing *A run holds exactly one role's credentials* requirement is about role credentials, is already name-agnostic, and is neither relaxed nor restated.
- `openspec/specs/adoption-docs/spec.md` — one requirement revised.
- `cli/github.ts` — `VARIABLES.model` becomes the pair of accepted names; `Credentials` carries the held name beside its value; `credentialsFor` requires exactly one of the two and refuses both.
- `cli/exec.ts` — `childEnvironment` writes the held name and deletes the other.
- `payload/jen.yml` — `CLAUDE_CODE_OAUTH_TOKEN` passed through beside `ANTHROPIC_API_KEY`.
- `README.md` — the *What both need* list carries both spellings, how to mint the subscription token, and what choosing it costs; the local runner's `export` line shows both.
- `.claude/skills/setup-jen/SKILL.md` — the same two names in the secrets it tells an adopter to store, still eleven.
- `test/github.test.ts` — one of two accepted, the refusal naming both when neither is set, the refusal when both are set, and an empty value counting as absent on both names.
- `test/exec.test.ts` — the session holding the name the run holds, and the other name absent from it.
- `test/adoption-docs.test.ts` — both names reachable from `VARIABLES`, and the count still stated as eleven.
- **No change for an adopter already running on `ANTHROPIC_API_KEY`.** The variable they set is one of the two accepted, and nothing about their runs differs.
