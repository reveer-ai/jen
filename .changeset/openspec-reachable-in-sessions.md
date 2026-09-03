---
"@reveer/jen": patch
---

Make the OpenSpec CLI reachable inside dispatched stage sessions.

A stage session runs `claude` in a bare clone with no dependency install, so neither `openspec` (a dependency's bin, never linked by a global install of jen) nor `npx openspec` (which then reaches the registry) resolved — blocking every stage, on both runners. The run now writes an `openspec` shim into a per-run `bin/` and prepends it to the session `PATH`, invoking the same entrypoint jen resolves from its own dependency tree: no separate install, network fetch, or version pin.
