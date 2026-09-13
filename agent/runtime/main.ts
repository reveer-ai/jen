#!/usr/bin/env node
/**
 * The substrate's entry point: the executable a sandbox starts, and the only way a runtime
 * is launched.
 *
 * **It is not a subcommand of `jen`.** `agent-substrate` forbids any module under `cli/`
 * importing one under `agent/`, and a `jen agent` subcommand would have to import this to
 * launch it. So the substrate declares its own executable in its own manifest, which is
 * also the shape it needs independently: this is installed into an agent's sandbox image
 * rather than delivered through the CLI's published package.
 *
 * **Nothing is read from argv.** The record and the log arrive together on standard input —
 * see `boot.ts` for why neither could travel any other way.
 *
 * What happens after the turn is deliberately not here. Persisting the log, routing the
 * message to the parent, and the rest of the line protocol are the supervisor's, and the
 * supervisor is a component this one must not grow into.
 */
import { readBootFrame } from './boot.ts';
import { Runtime } from './index.ts';
import { openAIClient } from './model.ts';

try {
  const frame = await readBootFrame(process.stdin);

  const runtime = new Runtime({
    record: frame.record,
    events: frame.events,
    // No capability ships in this change, so an agent here reasons and does nothing else. A
    // record naming one therefore fails construction rather than starting reduced — which is
    // the behaviour the specification asks for, arriving earlier than it eventually will.
    capabilities: [],
    client: openAIClient(frame.record),
  });

  const message = await runtime.run();

  // One line out, as one line came in. The agent's message to its parent is the content it
  // produced with nothing outstanding; there is no status field beside it because there is
  // no other way for a turn to end.
  process.stdout.write(`${JSON.stringify({ message, events: runtime.events })}\n`);
} catch (error) {
  // The message, not the stack. Every failure that can reach here already names what it
  // could not read or could not resolve, and a stack trace above it buries that under
  // frames from inside this file. What reads these is a supervisor collecting stderr from a
  // process it started.
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
