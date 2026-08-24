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
import { type SubstitutionName } from './payload.js';
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
  /**
   * Why the registry did not answer for a value that reached it and came back missing.
   *
   * Carried so a refusal can name the checkout it read rather than only the two places the
   * shared message knows about. Empty where the registry was never consulted, which is what
   * a value resolved from a flag or the environment means.
   */
  unresolved: Partial<Record<SubstitutionName, string>>;
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
): { team?: string; project?: string; sources: WatchInput['sources']; unresolved: WatchInput['unresolved'] } {
  const sources: WatchInput['sources'] = {};
  const unresolved: WatchInput['unresolved'] = {};
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
  if (team && project) return { team, project, sources, unresolved };

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

  // Kept only for what is still missing after all three: a `why` about a value some flag
  // supplied would be an explanation of nothing, and the reason a registry gives is only
  // worth reporting where its answer was the one being waited on.
  for (const { name, why } of registry.unresolved) {
    if (name === 'team' && !team) unresolved.team = why;
    if (name === 'project' && !project) unresolved.project = why;
  }

  return { team, project, sources, unresolved };
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
 * meant to be waited out. The guarantee is unconditional rather than a list: a fault the
 * tick could not name is caught here too and retried the same way, because the alternative
 * is a runner that ends on something it merely failed to recognise. What cannot resolve
 * while the process runs is checked once, before the first tick, because looping on it
 * would print the same message forever — and `impossible()` is the only way out of the
 * loop that isn't a signal.
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
  const { input, intervalSeconds, projectRoot, sources, unresolved } = invoked;

  const refusal = impossible(input, env);
  if (refusal) {
    io.err(`jen watch: ${refusal.why}`);

    // The shared message names the flag and the variable, because those are the two places
    // `jen run` has. This runner had a third, and it is the one an operator pointing it at a
    // checkout was relying on — so a refusal that stops at the other two describes a search
    // this runner did not perform. Said here rather than in `impossible()`, which `jen run`
    // shares and which must never learn that a registry exists.
    //
    // Gated on what the refusal is *about*, which is why `impossible()` says so. The registry
    // is an answer to a missing team or project and to nothing else: offered under the
    // credential refusal — the state an unbound checkout with nothing exported is in, and so
    // the first thing a new operator sees — it contradicts the line above it, which has just
    // said the credential never comes from a file.
    const missing =
      refusal.refused === 'team' ? unresolved.team : refusal.refused === 'project' ? unresolved.project : undefined;
    if (missing) io.err(`Or bind the checkout at ${projectRoot}, where ${missing}.`);

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
      try {
        await tick(input, io, env, { transport: options.transport, launch: sessions.launch });
      } catch (error) {
        // `tick()` reports the failures it can name and rethrows the rest, so what arrives
        // here is a fault nothing has classified — a connection lost mid-body, a bug, a
        // transport that threw where nobody expected one. None of that is a reason for the
        // runner to stop: `impossible()` already answered, before the first tick, the only
        // question whose answer cannot change while this process runs. Anything reaching
        // this line is a failed tick, and the next tick is its retry.
        //
        // Left uncaught it would leave `watch`, leave `run()` — whose own `try` is
        // synchronous and never sees a rejected promise — and end the process as an
        // unhandled rejection. That is also where the two runners would part: under the
        // scheduled runner the same fault is one red job and the next cron picks up, while
        // here it would be silence, which is the one state this pipeline must never be
        // mistaken for.
        io.err(`jen watch: the tick failed — ${error instanceof Error ? error.message : String(error)}`);
        // Not promised where a stop has already landed: the next tick is the retry only if
        // there is going to be one, and this line is the operator's evidence the runner is
        // still up.
        if (!stopping) io.err(`             the loop continues; the next tick, in ${intervalSeconds}s, is the retry.`);
      }
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
