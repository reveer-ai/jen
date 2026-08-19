/**
 * The pipeline's stages, as the dispatcher needs them: which tracker status triggers a
 * stage, which skill that stage runs, and which identity role it acts under.
 *
 * This restates the stage table in the root `AGENTS.md`, and restating a fact is how two
 * statements of it drift. It cannot be read from that document at runtime — the tick
 * reads no files by requirement, and the scheduled runner never checks the repository out
 * — so what holds the two together is `test/stages.test.ts`, which parses the table out
 * of `AGENTS.md` and asserts this matches. Change one and the other fails in CI, which is
 * where both statements live.
 */

/** The identity a stage acts under on the git host, per the `pipeline-identity` capability. */
export type Role = 'design' | 'dev' | 'deliver';

export interface Stage {
  /** The tracker status that triggers the stage, written as the workflow document writes it. */
  status: string;
  /** The skill the stage runs, named explicitly in the run request. */
  skill: string;
  role: Role;
}

/**
 * The status a stage parks a task in when it needs a person.
 *
 * Never a candidate, and deliberately not a member of {@link STAGES}: candidacy is the
 * allow list below, so `Pending` is excluded by not appearing rather than by being
 * enumerated as an exception. The tick still needs the name, because it refuses to run
 * against a team that carries no such status.
 */
export const PENDING = 'Pending';

/**
 * Every dispatchable stage, in pipeline order.
 *
 * `refine-epic` is absent because no status triggers it — it runs before the pipeline and
 * leaves its output in `Todo`. `Todo` itself is absent for the same reason it is not a
 * candidate: promoting out of it is the user's decision and no dispatcher makes it.
 *
 * Reviewing, testing, and delivering all act as `deliver` rather than as three roles: the
 * split that matters is the one keeping the identity that implements a change from being
 * the identity that approves it.
 */
export const STAGES = [
  { status: 'In Design', skill: 'design-task', role: 'design' },
  { status: 'In Progress', skill: 'implement-task', role: 'dev' },
  { status: 'In Review', skill: 'review-task', role: 'deliver' },
  { status: 'In Testing', skill: 'test-task', role: 'deliver' },
  { status: 'In Delivery', skill: 'deliver-task', role: 'deliver' },
] as const satisfies readonly Stage[];

/**
 * The stage a status triggers, or `undefined` where the status triggers none.
 *
 * Case-insensitive, because a team's status names are its own — jen's team writes them
 * `in design` while the workflow document writes `In Design` — and `project-binding`
 * already settles that the two are the same status. Every step past folding case would be
 * synonym matching, which is the status map arriving through the back door.
 *
 * An allow list, so a status jen has never heard of is a non-candidate by the same rule
 * that excludes `Todo` and `Pending`. The failure mode of the opposite arrangement is
 * dispatching a stage against a task in a status nobody intended.
 */
export function stageFor(status: string): Stage | undefined {
  const wanted = fold(status);
  return STAGES.find((stage) => fold(stage.status) === wanted);
}

/** How every status comparison in the dispatcher is made: trimmed, case-folded, nothing else. */
export function fold(status: string): string {
  return status.trim().toLowerCase();
}
