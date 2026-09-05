## REMOVED Requirements

### Requirement: Binding refreshes what jen derives from the registry

**Reason**: Nothing jen writes is derived from the registry any more. The scheduled workflow was the only managed file carrying resolved values, and with it deleted there is no file for binding to refresh, no value to confirm reached one, and nothing for a refresh to report.

**Migration**: None is needed, and the state this requirement guarded against no longer exists. It existed because an installation wrote the workflow before the registry could answer it, leaving a bound project whose runner polled nothing until the next update. The runner now reads the registry from its checkout when it starts, so a project bound after installation is configured by the act of recording the tracker — binding ends there, and `pipeline-runner` governs what the runner does when the registry answers nothing.
