## 1. Accept either credential

- [ ] 1.1 Turn `VARIABLES.model` in `cli/github.ts` into the list of accepted names — `ANTHROPIC_API_KEY` and `CLAUDE_CODE_OAUTH_TOKEN` — keeping it a single slot rather than adding a sibling key, so `test/adoption-docs.test.ts` continues to derive the documented names from it (`design.md` — *`VARIABLES.model` becomes the list of accepted names*).
- [ ] 1.2 Replace `modelKey: string` on `Credentials` with `model: { variable: string; value: string }`, so the run carries which name it holds and nothing has to re-derive it from the environment a second time.
- [ ] 1.3 Add a one-of-two read beside `required` in `cli/github.ts`, using the same emptiness rule — absent or whitespace-only is not set — and returning the held name with its value.
- [ ] 1.4 Refuse with `CredentialError` naming **both** accepted names when neither is set. Naming only one would point an operator at the form they chose not to use.
- [ ] 1.5 Refuse with `CredentialError` when both are set, naming both and stating that a run holds exactly one and the other is to be unset. Word it differently from the absent case deliberately: unlike a missing variable, the name does not say what to do about it (`design.md` — *The one-of-two read sits beside `required`*).
- [ ] 1.6 Call it from `credentialsFor` in the position `VARIABLES.model` is read today, so the refusal still happens before anything else and before any session starts.

## 2. Give the session exactly the one it holds

- [ ] 2.1 In `childEnvironment` in `cli/exec.ts`, write `credentials.model.value` under `credentials.model.variable` in place of the fixed `ANTHROPIC_API_KEY` assignment, leaving it after the copy loop where jen's own values already override anything inherited.
- [ ] 2.2 Delete every other name in `VARIABLES.model` from the child environment. It is unreachable while `credentialsFor` refuses the both-set case upstream, and it is what makes `childEnvironment`'s own contract true rather than true by a caller's grace — the property the unit tests assert directly (`design.md` — *`childEnvironment` writes the held name and deletes the other*).
- [ ] 2.3 Confirm at the point of the change that nothing else in `cli/` reads `ANTHROPIC_API_KEY` by name, and that no part of how `#session` spawns its child — command line, `--mcp-config`, `CLAUDE_CONFIG_DIR` — participates in model access.

## 3. Carry it to the runners

- [ ] 3.1 Pass `CLAUDE_CODE_OAUTH_TOKEN` through `payload/jen.yml` beside `ANTHROPIC_API_KEY`. An unset secret expands to an empty value, which the read in 1.3 already treats as absent, so both may be declared unconditionally.
- [ ] 3.2 Check that no other managed file or scaffolded file names the model credential, so the workflow is the only passthrough to change.

## 4. Tell the adopter what they are choosing

- [ ] 4.1 In `README.md` — *What both need* — give the model slot both spellings as one value, keeping the count at **eleven**. Three per role for three roles, the tracker key, and one model credential.
- [ ] 4.2 Say how the subscription token is obtained (`claude setup-token`, which requires a Claude subscription), and what choosing it costs: usage limits shared with the adopter's own interactive work on the same account — a polling pipeline can exhaust a window they were about to work in, surfacing as a stage dying mid-run rather than as a bill — and a long-lived personal credential where an API key is scoped and revocable per key.
- [ ] 4.3 State that a runner holds exactly one and that setting both is refused rather than resolved by a precedence, so an adopter meets that refusal as a stated rule rather than as a malfunction.
- [ ] 4.4 Update the local runner's `export` line so it does not read as requiring the API key specifically.
- [ ] 4.5 Make the same changes in `.claude/skills/setup-jen/SKILL.md`, which carries the same list and the same count of secrets an adopter stores.
- [ ] 4.6 Add a note to `cli/AGENTS.md` beside the existing one on a run outliving its minted token: neither model credential's expiry or usage window is observable from a run, so a token that has expired or a window that is exhausted surfaces as a session dying at model access with nothing naming the cause — and that is why the both-set case is refused rather than resolved.

## 5. Cover it in tests

- [ ] 5.1 `test/github.test.ts` — `credentialsFor` accepts an environment holding only `ANTHROPIC_API_KEY`, and one holding only `CLAUDE_CODE_OAUTH_TOKEN`, reporting the held name in each.
- [ ] 5.2 Refuses when neither is set, and the message names both.
- [ ] 5.3 Refuses when both are set, the message names both, and neither is silently preferred.
- [ ] 5.4 An empty or whitespace-only value counts as absent under either name — including the case that matters, one name holding a value while the other is empty, which is what an unset repository secret produces.
- [ ] 5.5 Fold the model credential into the existing `it.each` refusal table rather than leaving it asserting a single name, so the table stays the one place a required credential's refusal is described.
- [ ] 5.6 `test/exec.test.ts` — a session started for a run holding a subscription token receives `CLAUDE_CODE_OAUTH_TOKEN`, and `ANTHROPIC_API_KEY` is absent from its environment; and the mirror case for a run holding an API key.
- [ ] 5.7 `test/exec.test.ts` — `childEnvironment` deletes the unheld name even when the base environment carries it, asserting the unit's own contract rather than relying on the upstream refusal.
- [ ] 5.8 `test/adoption-docs.test.ts` — the README names every accepted model credential, derived from `VARIABLES.model` rather than restated, and still states the count as eleven.
- [ ] 5.9 Run the full suite, the typecheck, and `openspec validate <change> --strict`.

## 6. Ship it

- [ ] 6.1 Add a changeset carrying the change to adopters — a new accepted credential name and a managed workflow that passes it through, with no action required of an adopter running on an API key today.
