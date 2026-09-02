---
"@reveer/jen": minor
---

Accept a Claude subscription token as model access, alongside an API key.

A run reaches a model under either `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN` — the latter minted by `claude setup-token`, which requires a Claude subscription. The two are peers: neither is the default and neither is the fallback, and the choice is the adopter's. **Nothing changes for an adopter running on an API key today.**

A runner holds exactly one. Setting both is refused before a session starts, naming both, rather than resolved by a precedence: one form bills a key and the other spends a usage window shared with the adopter's own interactive work, so choosing silently would be wrong in both directions and wrong invisibly. Setting neither is refused the same way it always was, except that the message now names both accepted forms. The session receives only the name its run holds; the other is removed from its environment.

The managed workflow passes both secrets through, so `jen update` is what carries this to a scheduled runner. An unset secret expands to an empty value, which reads as absent — an adopter who never stores a token sees no difference.

`README.md` states what choosing the subscription costs before an adopter chooses it: its usage limits are shared with their own interactive use of the same account, so a polling pipeline can exhaust a window they were about to work in — surfacing as a stage dying mid-run rather than as a bill, since jen can observe neither credential's limit. It also states that the token is long-lived and bound to the person who minted it, that its authority is inference-only by design, and that a managed installation's policy may refuse to mint one at all.
