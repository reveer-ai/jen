# Spec Delta

## REMOVED Requirements

### Requirement: Agents behave on the live check's tasks
**Reason**: How agents behave on a real model is measured by an evaluation, which reports rates and never fails, not by a live check that fails on any faulty run.
**Migration**: The tasks move to `agent-evaluation`'s "The defined tasks", run with `npm run eval`.

### Requirement: The behavior live check fails on any fault
**Reason**: A faulty run is now a failed run in an evaluation's rates, not a failing check.
**Migration**: The fault rules move to `agent-evaluation`'s "A run settles as the behavior check's did" and "Runs fail as the behavior check's did", each fault with a kind.
