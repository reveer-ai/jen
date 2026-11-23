# src/agent

Rules that apply only here. Everything else is in the root `AGENTS.md` and the project record.

- **Only an adapter in `model/` imports a model SDK**, and no SDK type crosses `model/port.ts`.
- **The instructions and tool descriptions in `delegation.ts`, `workspace.ts` and `ui.ts` are behavior.** Rewording them changes how agents act, and unit tests can't tell. After any change to them, evaluate the change against `main` on `openai/gpt-6-luna` with `npm run eval`, as `edda/conventions.md` says. After a change to `ui.ts`, also run the UI check (`src/runtime/ui.live.test.ts`), which runs on `openai/gpt-6-sol`.
