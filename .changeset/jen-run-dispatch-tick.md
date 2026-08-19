---
"@reveer/jen": minor
---

`jen run` — one dispatch pass over the tracker, and the `Pending` status that makes it possible.

The pipeline gains a status. Every stage now ends in one of exactly two ways: it hands the task to the next stage, or it parks it at `Pending` and says why. No stage finishes leaving a task in its own status, so a task found in a stage status is one a session is working or one a session died working — never one at rest. `design-task` ends at `Pending` rather than resting at `In Design`, and promotion to `In Progress` is still the user's. `Pending` has to exist on the tracker team before any of this works; binding reports it missing rather than creating it, and `jen run` refuses a team without it.

Every session now announces itself on the task before it produces anything, carrying a `jen:run` marker that its closing comment counterparts. That pairing is what tells a dispatcher a task is being worked, since the status alone stays actionable right up until the stage moves it.

`jen run` performs a single poll-map-gate-dispatch pass and exits. The loop belongs to whatever runner drives it, so a scheduled job and a long-running local process are both thin wrappers over the same entry point. It polls the tracker for issues sitting in a stage status, maps each to a skill and an identity role from a compiled table, declines anything a session has announced itself against or that would exceed the concurrency cap, prints a run request per dispatch to stdout as JSON, and writes its report to stderr — so `jen run | executor` works with no flag.

The tick writes nothing: not to the tracker, not to the git host, not to the filesystem. It is safe to run at any time, twice, and before anything exists to consume what it emits. Its credential and its project identity both arrive from the environment or as flags and are never read from a file, and a run leaves nothing behind on the host.

`init` and `update` are unchanged and stay filesystem-only.
