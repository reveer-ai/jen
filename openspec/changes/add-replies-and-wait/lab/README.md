# Lab

The lab behind this design: the prototype the design follows, and the harness that ran it on Luna on 2026-11-06 and 2026-11-07. The behavior live check (design, "The behavior live check") is built from the harness. All of this is reference, not code to run as it is. Nothing here is compiled or tested.

- `bc10-instructions.md`: `bc10`'s system instructions for a root, for a sub-agent with `spawn`, and for one without. They're the starting point for the instructions.
- `bc10/`: `bc10`'s changed agent files, a copy of `src/agent/` from JEN-11 with lab changes marked `LAB`. Its tool descriptions and result texts are in `delegation.ts`, and `wait` is in `loop.ts`, with the inbox delivered as a wait's result in `store.ts`. It keeps its state in memory where the design uses the store, and counts who owes a reply from the conversation where the design uses an `owed` table. `variant.ts` held two switches, `VARIANT = "bc"` and `STYLE = "anon"`, which `bc10` always had on.
- `harness.ts`: runs owner tasks against a runtime of its own and writes each run's transcript and metrics.
- `tally.mjs`: scores result folders against each task's ideal reply and send counts.

To run the harness, build the agent image from a checkout with the change, then run `node harness.ts <repo> <outdir> <agent-image> [task...] [--runs N] --replies`. It reads `JEN_LIVE_API_KEY`, `JEN_LIVE_MODEL` and `JEN_LIVE_BASE_URL` from the repo's `.env`. Each runtime allows 50 agents, so run at most 18 roots per runtime. The tasks are `haiku`, `direct`, `fanout`, `clarify`, `followup`, `thanks` and `nested`. The empty-reply test also needs an image whose leaves drop their first reply. That was a one-line lab change, not kept here.
