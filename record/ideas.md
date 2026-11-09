# Ideas

Ideas the maintainer wants kept, not yet planned or decided. An idea isn't a commitment and doesn't constrain design. When one is scoped into an issue, move it to Linear and delete it here. When one is rejected, delete it and, if the reason matters, log it in [decisions.md](decisions.md).

## Agents

- **Grants that change after spawning, so agents can negotiate them.** *Raised 2026-11-03, in [JEN-11](https://linear.app/reveer/issue/JEN-11).* A sub-agent asks its parent for a capability, such as `spawn`, and the parent's model decides whether to grant it. The negotiation is only messages. What's missing is an operation that changes a grant, open to any ancestor: it widens only as far as the caller's own grant, and narrowing applies to everything under the agent. Grants are stored in labels on agents' volumes, which Docker can't change after creation, so they'd need a record that can change. The agent learns of the change and its tools update at its next step. It would make a good live check, since it exercises messages in both directions, grants and tools that follow the grant.
- **Mail-style delivery.** *Raised 2026-11-03, in JEN-11.* Messages that wait in an inbox until the receiver chooses to read them, unlike JEN-11's delivery at the next step. Not for parent and child, since a sub-agent is an extension of its parent's work. It fits the later milestone on communication between agents that aren't parent and child (see [plan.md](plan.md)). The inbox is a durable queue either way, so this would add a delivery policy and a tool to read the inbox, not a redesign.

## Workflow

- **The briefing as an OpenSpec artifact.** *Raised 2026-11-09, in [JEN-15](https://linear.app/reveer/issue/JEN-15).* A custom OpenSpec schema could make `deliver-change`'s briefing an artifact of the change, so it's archived in the repo with the change instead of living only in the pull request's description. As of OpenSpec 1.15.0, a schema's artifacts can depend only on other artifacts, and `apply` isn't one. So a `briefing` artifact can be declared, but OpenSpec can't order it after implementation; only a convention or the skill could. `openspec schema fork spec-driven` is the starting point.
- **A skill for uncovering bugs.** *Raised 2026-11-09, in JEN-15.* `tend` looks at code only for how it's organized and reads. Hunting for bugs, flaky tests, failure handling and performance would be a separate skill.
