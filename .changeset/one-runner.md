---
"@reveer/jen": minor
---

Remove the scheduled git-host runner. jen ships one runner: `jen watch`.

**Required action for anyone who installed an earlier version:** delete `.github/workflows/jen.yml` from your repository by hand. jen no longer writes or removes that path, so an installed copy keeps polling — and keeps billing a git-host runner for the whole life of every stage session it launches — until you delete it.

The workflow held a paid runner for the entire life of every session, not just the poll: at roughly five stages of about fifteen minutes, one task cost around 75 runner-minutes of agent sessions billed as CI compute. It could also be disabled silently by the git host after 60 days of repository inactivity, which is indistinguishable from a pipeline with nothing to do.

Anything that can invoke `jen run` on a schedule is still a runner, a scheduled git-host job included — jen simply ships no workflow file or template for one, so choosing that cost is explicit. `jen watch` is now called *the runner*, without the *local* qualifier; the command name is unchanged. Write-time substitution is gone with the file that used it: nothing jen writes carries a value from `registry.yaml`, and the runner reads the tracker team and project from its checkout when it starts, refusing to start rather than polling an unbound project.
