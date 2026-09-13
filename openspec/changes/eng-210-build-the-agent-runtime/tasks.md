## 1. The record, and the sandbox's narrowing

- [x] 1.1 Add `agent/record.ts` with the one `AgentRecord` and `CredentialReference`, moving the reference type out of `agent/sandbox/index.ts`. Owned by neither sandbox nor runtime, so neither imports the other.
- [x] 1.2 Remove `AgentRecord` from `agent/sandbox/index.ts` and replace `create`'s parameter with a `SandboxRequest` derived from the record, carrying only the fields provisioning reads.
- [x] 1.3 Update `agent/sandbox/docker.ts` and both sandbox test files for the rename. Behaviour is unchanged; this is the type moving, not the driver.
- [x] 1.4 Test that the derived form carries no indication of an agent's parent, and that renaming a record field fails to resolve rather than leaving two shapes agreeing by coincidence.
- [x] 1.5 Test that a serialized record carries every credential as a reference and no value, and that a credential named for a use names one the record already carries.
- [x] 1.6 Run `npx tsc -p agent/tsconfig.json` and `npx vitest run --config agent/vitest.config.ts`. Nothing automated covers `agent/`, so this is the only thing that catches a break in the sandbox from 1.2.

## 2. The substrate's manifest

- [x] 2.1 Add `agent/package.json` declaring the substrate's own dependencies and its entry point. Pin every dependency exactly.
- [x] 2.2 Add the model client as a dependency there, pinned. Nothing enters the repository's manifest.
- [x] 2.3 Test that the repository's manifest is unchanged, that nothing the substrate depends on resolves into the published package, and that no path under `agent/` appears in the tarball.
- [x] 2.4 Test that the CLI's import graph reaches no module under `agent/`, so the entry point stays the substrate's own.

## 3. Events and the projection

- [x] 3.1 Define the event log: the event types, their ordering, and the fields that make it a verification surface — when a step occurred, tokens consumed, and each invocation's duration and outcome.
- [x] 3.2 Implement the projection from event log to the provider's message array. This is the only projection; it serves the working path and the resumed path alike.
- [x] 3.3 Carry provider-specific reasoning content in a form the projection replays without interpreting.
- [x] 3.4 Test that projecting the same log twice is byte-identical, including a log carrying reasoning content.
- [x] 3.5 Test that a log ending in a capability call with no result projects to a valid array — the synthesized result is appended as a real event, and projecting again does not add a second one.

## 4. The capability surface

- [x] 4.1 Define the capability interface: name, description, input schema, invocation, optional progress.
- [x] 4.2 Build the registry from `record.tools`, failing construction with an error naming any capability that cannot be resolved.
- [x] 4.3 Project the registry into the model request's tool declarations, and dispatch a returned call by name.
- [x] 4.4 Record an invocation's failure as that invocation's result and continue the loop, rather than letting it end the run.
- [x] 4.5 Test with a trivial capability defined in the suite — nothing else exercises this interface in this change, which is the sandbox's one-driver problem again.
- [x] 4.6 Test that a runtime constructed with no capabilities is valid, and that a record naming an unresolvable capability fails construction rather than starting with a reduced set.
- [x] 4.7 Test that a capability invoked in-process and one that goes out over the channel dispatch through the same path, with nothing in the dispatch distinguishing them.

## 5. The model client and the loop

- [x] 5.1 Wrap the client behind a seam narrow enough to substitute: a streamed step in, an assistant message with accumulated tool calls and usage out. The seam exists for the test double, not as an abstraction layer.
- [x] 5.2 Configure it from the record — `baseURL`, model, and the credential the record names — reading the value from the delivered environment, never from the record.
- [x] 5.3 Implement the loop: stream a step, dispatch any capability calls, append results, repeat; end the turn on content with nothing outstanding, and emit that content as the message to the parent.
- [x] 5.4 Add a source-level guard that the client's own loop-running facilities are not used, in the same spirit as the sandbox's no-`node:fs` guard. This failure would look like working code.
- [x] 5.5 Build the scripted client double: canned responses in, captured request bodies out. Every loop and resume test runs against this, never a live model.
- [x] 5.6 Test the turn boundary in both directions — content with no calls ends the turn, content with calls takes another step.

## 6. Boot, and the entry point

- [ ] 6.1 Read the boot frame from standard input and construct the runtime from the record and log it carries. Nothing in argv.
- [ ] 6.2 Fail construction on a malformed boot frame with an error naming what could not be read, before any model call is made.
- [ ] 6.3 Add the entry point the manifest declares.
- [ ] 6.4 Test that the boot frame arrives intact after the sandbox's credential delivery on the same pipe. The failure mode is a truncated frame that reads as a malformed record, so this test is what names the real cause.
- [ ] 6.5 Test that an empty log is valid and denotes an agent that has not yet run.

## 7. The property the design rests on

- [ ] 7.1 Write the indistinguishability test: run a sequence of turns in one runtime capturing every request body; run the same sequence destroying and reconstructing the runtime from the emitted log at every turn boundary; assert the two sequences are byte-identical and in the same order.
- [ ] 7.2 Include a turn carrying capability calls and results, so the comparison covers a log with more in it than plain messages.
- [ ] 7.3 Include a reconstruction across an interrupted capability call, so the synthesized result is covered by the same comparison.
- [ ] 7.4 Test that the runtime constructed for an agent with no parent is the same runtime as one constructed at depth, with no branch distinguishing them.

## 8. Closing out

- [ ] 8.1 Record in `agent/AGENTS.md` what a future session would otherwise rediscover the hard way — the shared pipe between credential delivery and the boot frame, why the client's loop is unused and how that is guarded, and why the projection lives in the runtime rather than the supervisor. Skip anything that does not clear the bar.
- [ ] 8.2 Run `npx tsc -p agent/tsconfig.json` and `npx vitest run --config agent/vitest.config.ts` and confirm both clean. No automated check covers this directory.
- [ ] 8.3 Run `npx openspec validate eng-210-build-the-agent-runtime --strict`.
