# src/agent

Rules that apply only here. Everything else is in the root `AGENTS.md` and the project record.

- **Only an adapter in `model/` imports a model SDK**, and no SDK type crosses `model/port.ts`.
- **The instructions and tool descriptions in `delegation.ts` and `workspace.ts` are behavior.** Rewording them changes how agents act, and unit tests can't tell. After any change to them, run the behavior check (`src/runtime/behavior.live.test.ts`) on `openai/gpt-6-luna`.
