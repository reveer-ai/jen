## Context

See `proposal.md` — *Why*. The state this design starts from, in the terms the implementation needs:

`VARIABLES` in `cli/github.ts` is a flat record of the names a run reads, holding two shapes today — plain strings (`repo`, `tracker`, `model`) and functions of a role or a skill (`appId`, `installation`, `privateKey`, `stageScope`). `credentialsFor(role, env)` reads every one of them through `required(env, name, why)`, which treats a value that is absent or whitespace-only as missing and throws `CredentialError` naming it. `Credentials` is flat, and carries `modelKey: string`.

`childEnvironment(base, skill, credentials, token, configDir, askpass)` in `cli/exec.ts` copies `base`, skipping jen's namespace and any name another stage claimed, then assigns seven of jen's own values over the top — `ANTHROPIC_API_KEY` among them. It is called once, from `#session`, after `credentialsFor` has already resolved from the same environment.

Three constraints bound what can be done here.

**The refusal happens before a session starts, or it is worthless.** Everything `credentialsFor` reads is read before anything else happens, which is what makes a misconfigured run fail naming its cause rather than dying partway through work it cannot finish.

**A session is started by an environment variable and nothing else.** The Claude Code CLI reads `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN` from its environment; both names are live in the shipped 2.1.251 binary, and `claude setup-token` mints the latter. Nothing on the command line, in `--mcp-config`, or in `CLAUDE_CONFIG_DIR` participates, so no part of how `#session` spawns its child changes.

**jen cannot observe what either credential costs.** No usage limit, no balance, no expiry. An API key's spend and a subscription's shared window are both invisible from inside a run, which is why every statement about them in this change is documentation rather than a check.

**The subscription token is narrower than a login, not wider than a key.** Established from the shipped binary rather than assumed: a token minted by `claude setup-token`, and any value supplied as `CLAUDE_CODE_OAUTH_TOKEN`, carries inference-only authority — the CLI refuses it for Claude in Chrome and for Remote Control, both of which require a full login, and says so in those words. This corrects an earlier draft of this design and of the `adoption-docs` delta, which set the token against an API key that is "scoped and revocable per key"; the scope half was wrong, and wrong in the token's disfavour. What actually separates them is that the token is bound to a person and to their subscription's shared window where a key is issued independently of any one person, and that a managed installation's policy can refuse to mint one at all — a limit an adopter should meet in the documentation rather than at the terminal.

## Goals / Non-Goals

**Goals:**

- A run reaches a model under either credential, holding exactly one, with the choice the adopter's.
- An ambiguous configuration fails where a person is — at configuration time, naming both — rather than resolving itself into a spend the adopter did not choose.
- The session's environment carries exactly the credential the run holds, independent of what the runner's environment happened to contain.
- An adopter already running on `ANTHROPIC_API_KEY` observes nothing.

**Non-Goals:**

- Detecting that a credential has expired or a usage window is exhausted. Neither is visible to a run; see *Risks*.
- Any change to what stops a runner. The model credential is not in `impossible()` and does not move there — see `proposal.md`, *What this deliberately does not do*.
- Model selection, routing, or a per-stage credential. One run, one model credential, as today.

## Decisions

### `VARIABLES.model` becomes the list of accepted names, not a second key

```ts
model: ['ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN'],
```

One slot with two spellings, rather than `model` and `modelToken` as sibling keys. The deciding consumer is `test/adoption-docs.test.ts`, which asserts the README names every credential a runner needs and builds that list *from* `VARIABLES` rather than restating the names. A list spreads into that enumeration and keeps the assertion true; a second key does not, and would leave the test silently checking one name while the documentation carried two — the exact staleness deriving from `VARIABLES` was meant to prevent.

It also puts the two names in one place for the refusal to quote, which is what makes "name both" a property of the data rather than a sentence someone has to keep in sync.

*Alternative considered:* keeping `model` as the API key and treating the token as an override read separately. Rejected — it encodes a precedence in the shape of the code, and precedence is what this change refuses.

### `Credentials` carries the name beside the value, in one field

```ts
model: { variable: string; value: string };
```

replacing `modelKey: string`. The value alone is no longer actionable: `childEnvironment` has to write it back under the name it came from, so a run that carried only the value would have to re-derive which name it holds by re-reading the environment — the same read, done twice, in two places that can disagree.

One object rather than two flat fields (`modelKey` and `modelVariable`) because two fields can be constructed disagreeing with each other and one cannot. It is the only nested field on `Credentials`, and that is the point: it is the only one where the name is part of the value.

### The one-of-two read sits beside `required`, in `credentialsFor`

A small function next to `required`, reading both names under the same emptiness rule and returning the pair or throwing `CredentialError`:

- neither set → refuse, naming both;
- exactly one set → return it;
- both set → refuse, naming both and stating that exactly one is to be held.

Beside `required` because it *is* `required`, over a slot with two spellings, and it must not drift from it on what counts as set. An empty value is what an unset repository secret expands to, and this is what allows `payload/jen.yml` to pass both names through unconditionally without telling every adopter who set one that they set two.

The two refusals read differently on purpose. `X is not set — a session cannot run without model access` tells an operator what to do by naming the variable. The both-set case does not: nothing in either name says which to drop, so the message says to hold exactly one and unset the other.

*Alternative considered:* hoisting the model credential into `impossible()` so `jen watch` stops rather than failing every dispatched run. Rejected as out of scope, and it is not a small change dressed as one — `impossible()` is the gate that decides a runner cannot proceed at all, currently holding the tracker credential, the team, the project, and the concurrency, and the nine role variables are not there either. Moving one of them changes what stops a runner, which is `pipeline-runner`'s question.

### `childEnvironment` writes the held name and deletes the other

```ts
env[credentials.model.variable] = credentials.model.value;
for (const name of VARIABLES.model) if (name !== credentials.model.variable) delete env[name];
```

after the copy loop, where jen's own values are already assigned so they win over anything inherited.

**The delete fires on a real runner, and what the upstream refusal makes unreachable is narrower than the whole of it.** The managed workflow passes every accepted name through unconditionally, so the name an adopter never stored arrives as an empty string; `credentialsFor` reads empty as absent and so refuses nothing; and `childEnvironment`'s copy loop filters on nothing. Without the delete the unheld name would reach the child as `''` on every tick of a correctly configured hosted runner — handing the CLI the empty-versus-unset judgment the both-set refusal exists to take away from it. What `credentialsFor` does rule out, reading the same environment, is a *non-empty* inherited value under the unheld name. That case is covered too: keeping the delete makes the unit's contract true on its own terms — *a session holds one model credential, the one the run holds* — rather than true only because a different function checked first. `childEnvironment` is unit-tested against constructed environments, so the property is directly assertable there, and the assertion is worth more than the line costs.

The stage-scoping lever cannot reintroduce the other name: a `JEN_ENV_<STAGE>` declaration only ever withholds a name from stages that did not claim it, and never adds one.

### The documentation keeps one number and gives the model slot two spellings

`README.md` says *Eleven values* and `test/adoption-docs.test.ts` asserts that phrase. Eleven is still right — three per role for three roles, the tracker key, and one model credential — and the model line grows to carry both names, how `claude setup-token` mints the second, and what each costs. Presenting them as twelve would send an adopter looking for a secret they were never meant to store, and would make a correct configuration indistinguishable from an incomplete one.

`.claude/skills/setup-jen/SKILL.md` carries the same list and the same count, and changes the same way. `project-binding` enumerates no variable names, so no delta follows from that file.

## Risks / Trade-offs

**An operator with a stray `ANTHROPIC_API_KEY` in their shell meets a refusal on every tick.** → This is the trade accepted deliberately, and it is the local runner's case specifically: the variable is read by more than jen and is ordinary to have exported. The refusal names both, says to hold one, and costs one `unset`. It behaves exactly as a missing model credential behaves today — the run fails, the failure is recorded, the runner keeps polling — so nothing new has to be understood about it.

**A subscription token expires, or its usage window is exhausted, and jen cannot see either.** → Sessions then fail at model access mid-run, with nothing in jen naming the cause. This is not introduced by the change so much as newly available to be chosen, and it has no cheap guard: unlike the installation token, which the git host reports an `expires_at` for, neither of these is observable from a run. Documentation is the whole mitigation, and it is the same shape as the note `cli/AGENTS.md` already carries for a run outliving the token it minted.

**Both secrets stored on the scheduled runner fail every tick until one is removed.** → Loudly: a failed scheduled run is emailed to the repository's owner, and the message names both secrets. Preferred over the silent alternative, which is spending the wrong one.

**A future third form of model access would touch this again.** → It would be a name added to one list, plus a documentation line. The list, not the branch, is what makes that true — which is why the accepted names live in `VARIABLES` rather than in `credentialsFor`'s control flow.

## Migration Plan

Nothing to migrate. `ANTHROPIC_API_KEY` remains accepted under its own name, so an adopter running on one today observes no difference and takes no action.

Adopters receive the managed workflow's second secret passthrough with `jen update`, as with any managed-file change. An adopter who never sets `CLAUDE_CODE_OAUTH_TOKEN` sees it arrive empty, which reads as absent — so taking the update changes nothing for them either.

Rollback is the revert: an adopter who had moved to a subscription token would need to restore an API key, which is why the documentation states the token's costs before an adopter chooses it rather than after.
