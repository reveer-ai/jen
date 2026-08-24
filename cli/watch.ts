/**
 * The local runner: the same tick, on an interval, until it is stopped.
 *
 * A wrapper and nothing more. Every decision about what to dispatch belongs to `tick()`,
 * which this calls exactly as the scheduled workflow calls `jen run` — so a task's fate does
 * not depend on which runner happened to be pointed at the project.
 *
 * **It holds no state.** No lock file, no ledger, no queue, and no memory of what it
 * launched. Restarting it re-establishes everything from the tracker, and two instances on
 * one project behave exactly as two runners do, governed by the same in-flight test and the
 * same cap — both of which live in the tracker, which is the one place both runners look. A
 * lock here would be state one runner has and the other cannot see, which is the single rule
 * this whole change is built around.
 *
 * The one thing it does that the tick does not is read a file: the checkout it was pointed
 * at has a `registry.yaml`, and resolving the tracker team and project from it is the
 * runner's job. That resolution finishes before the first tick begins and cannot reach what
 * a tick decides, which is what keeps a runner that has a checkout and a runner that does not
 * from taking different paths through the deciding pass.
 */
import { resolveFromRegistry } from './registry.js';
import { impossible, tick, type Environment, type Launch, type TickInput } from './run.js';

import type { Io } from './cli.js';

/**
 * What the loop needs from an executor, and nothing more.
 *
 * Structural rather than the class itself, for the same reason the tick's launcher is: this
 * module has no business with what running a session involves, and the tests drive the loop
 * without one.
 */
export interface Sessions {
  launch: Launch;
  terminate(signal: NodeJS.Signals): void;
}

/** How long the local runner waits between ticks when nothing says otherwise, in seconds. */
export const DEFAULT_INTERVAL_SECONDS = 60;

/** Where each of the tick's two identifying values came from, for the line the runner opens with. */
export type Source = 'flag' | 'environment' | 'registry';

export interface WatchInput {
  input: TickInput;
  /** The floor between the end of one tick and the start of the next, in seconds. */
  intervalSeconds: number;
  /** The checkout whose registry supplied what no flag or variable did. */
  projectRoot: string;
  sources: { team?: Source; project?: Source };
}

export interface WatchOptions {
  transport?: typeof fetch;
  /** How the loop waits. Injected by tests; nothing else has reason to replace it. */
  wait?: (ms: number) => Promise<void>;
}

/**
 * The tracker team and project, from the first of the three places that has them.
 *
 * A flag beats a variable beats the registry. The registry is last because it is the
 * *fallback* — it answers for a runner that was given nothing, which is the ordinary case —
 * and every one of the three is named in the line the runner opens with, so a value coming
 * from somewhere other than where the operator expected is visible rather than silent.
 */
export function resolveIdentity(
  flags: { team?: string; project?: string },
  env: Environment,
  projectRoot: string,
): { team?: string; project?: string; sources: WatchInput['sources'] } {
  const sources: WatchInput['sources'] = {};
  let team = flags.team;
  let project = flags.project;

  if (team) sources.team = 'flag';
  if (project) sources.project = 'flag';

  if (!team && env.JEN_TEAM) {
    team = env.JEN_TEAM;
    sources.team = 'environment';
  }
  if (!project && env.JEN_PROJECT) {
    project = env.JEN_PROJECT;
    sources.project = 'environment';
  }
  if (team && project) return { team, project, sources };

  // Read once, and only for what is still missing. This is the parity with a person's own
  // working copy that makes the local runner worth having: pointed at a checkout, it polls
  // whatever that checkout says it is bound to.
  const registry = resolveFromRegistry(projectRoot);
  if (!team && registry.values.team) {
    team = registry.values.team;
    sources.team = 'registry';
  }
  if (!project && registry.values.project) {
    project = registry.values.project;
    sources.project = 'registry';
  }

  return { team, project, sources };
}

function describe(what: string, value: string | undefined, source: Source | undefined): string {
  return `${what} ${value ?? '—'}${source ? ` (${source})` : ''}`;
}

/**
 * Wait, interruptibly.
 *
 * A stop arriving mid-interval must not sit out the rest of it: the operator asked for the
 * process to end, and up to an interval of nothing is how a clean shutdown comes to look
 * like a hung one.
 */
function sleeper(): { wait: (ms: number) => Promise<void>; wake: () => void } {
  let wake = (): void => {};
  return {
    wait: (ms) =>
      new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          wake = () => {};
          resolve();
        }, ms);
        wake = () => {
          clearTimeout(timer);
          wake = () => {};
          resolve();
        };
      }),
    wake: () => wake(),
  };
}

/**
 * The loop.
 *
 * **A failed tick does not end it; an impossible one never starts it.** A tracker error, a
 * rate limit, a record it could not read to the end, and a paused project are all answered
 * by the next tick — each can resolve without anybody restarting anything, and a pause is
 * meant to be waited out. What cannot resolve while the process runs is checked once, before
 * the first tick, because looping on it would print the same message forever.
 *
 * **Signals belong to the loop rather than to any one tick.** `jen run` installs handlers per
 * invocation and removes them on the way out; this installs its own for the length of the
 * process and never routes through that path, so the two can never both be installed. A stop
 * ends the scheduling, reaches the sessions in flight, waits for them, and exits — leaving
 * each task exactly as its session left it, and writing nothing to the tracker on its behalf.
 */
export async function watch(
  invoked: WatchInput,
  io: Io,
  env: Environment,
  sessions: Sessions,
  options: WatchOptions = {},
): Promise<number> {
  const { input, intervalSeconds, sources } = invoked;

  const refusal = impossible(input, env);
  if (refusal) {
    io.err(`jen watch: ${refusal}`);
    io.err('This cannot change while the process runs, so the loop was not started.');
    return 1;
  }

  const { wait, wake } = sleeper();
  const waitFor = options.wait ?? wait;

  let stopping = false;
  const stop = (signal: NodeJS.Signals) => () => {
    stopping = true;
    io.err(`jen watch: ${signal} received — no further tick, and the sessions in flight are being stopped.`);
    sessions.terminate(signal);
    wake();
  };
  const onTerm = stop('SIGTERM');
  const onInt = stop('SIGINT');

  process.on('SIGTERM', onTerm);
  process.on('SIGINT', onInt);

  io.err(`jen watch — ${describe('team', input.team, sources.team)}, ${describe('project', input.project, sources.project)}`);
  io.err(`             a tick, then ${intervalSeconds}s, then the next — until this process is stopped.`);
  io.err('');

  try {
    while (!stopping) {
      // Awaited, so the interval is a floor between the *end* of one tick and the start of
      // the next and two ticks can never overlap. A tick waits for the sessions it launched,
      // so a long session delays the following poll — which is the cost of not overlapping.
      await tick(input, io, env, { transport: options.transport, launch: sessions.launch });
      if (stopping) break;
      await waitFor(intervalSeconds * 1000);
    }
  } finally {
    process.off('SIGTERM', onTerm);
    process.off('SIGINT', onInt);
  }

  // A runner that was asked to stop and did is not a failure. What the last tick made of its
  // sessions is on the record it already emitted, and the tasks are wherever their sessions
  // left them.
  return 0;
}
