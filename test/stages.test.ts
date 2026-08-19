/**
 * The compiled stage table against the one the workflow document states.
 *
 * `cli/stages.ts` restates `AGENTS.md`'s stage table, and it has to: the tick reads no
 * files by requirement, and the scheduled runner never checks the repository out, so the
 * table cannot be read at runtime. Two statements of one fact drift, and this is the only
 * thing standing between them — the same job `payload.test.ts` does for the scaffold's
 * skill references, in the same place, since both statements live in this repository.
 */
import { describe, expect, it } from 'vitest';

import { MARKER } from '../cli/run.js';
import { PENDING, stageFor, STAGES } from '../cli/stages.js';
import { SKILLS } from '../cli/payload.js';
import { readRepoFile } from './helpers.js';

const workflow = readRepoFile('AGENTS.md');

/** The stage table, read out of the workflow document as a reader of it would. */
function documentedStages(): { status: string; skill: string }[] {
  const rows = workflow
    .split('\n')
    .filter((line) => line.startsWith('|'))
    .map((line) =>
      line
        .split('|')
        .slice(1, -1)
        .map((cell) => cell.trim()),
    )
    .filter((cells) => cells.length === 4);

  const backticked = (cell: string): string | undefined => /^`([^`]+)`$/.exec(cell)?.[1];

  return rows.flatMap(([status, skill]) => {
    const name = backticked(status ?? '');
    const runs = backticked(skill ?? '');
    // The refinement row's status cell is an em dash: no status triggers it, which is
    // exactly why it is not a dispatchable stage and not in the compiled table.
    return name && runs ? [{ status: name, skill: runs }] : [];
  });
}

describe('the compiled stage table', () => {
  it('names the same statuses and skills the workflow document does', () => {
    const documented = documentedStages();
    expect(documented.length, 'the stage table was not found in AGENTS.md').toBe(STAGES.length);
    expect(STAGES.map(({ status, skill }) => ({ status, skill }))).toEqual(documented);
  });

  it('leaves refinement out, because no status triggers it', () => {
    expect(workflow).toContain('`refine-epic`');
    expect(STAGES.map((stage) => stage.skill)).not.toContain('refine-epic');
  });

  it('runs only skills jen actually ships', () => {
    for (const stage of STAGES) expect(SKILLS, `${stage.status} runs ${stage.skill}`).toContain(stage.skill);
  });

  // The identity split that matters is the one keeping whoever implemented a change from
  // being whoever approves it. Everything else is attribution.
  it('gives implementation a role of its own, separate from the reviewing stages', () => {
    const roles = new Map<string, string>(STAGES.map((stage) => [stage.skill, stage.role]));
    expect(roles.get('design-task')).toBe('design');
    expect(roles.get('implement-task')).toBe('dev');
    for (const skill of ['review-task', 'test-task', 'deliver-task']) expect(roles.get(skill)).toBe('deliver');
    expect(roles.get('implement-task')).not.toBe(roles.get('review-task'));
  });

  it('folds case, because a team names its own statuses', () => {
    expect(stageFor('in design')?.skill).toBe('design-task');
    expect(stageFor('  IN DELIVERY  ')?.skill).toBe('deliver-task');
  });

  it('is an allow list, so a status it does not name triggers nothing', () => {
    for (const status of ['Todo', 'Backlog', 'Done', 'Canceled', PENDING, 'Code Review', 'Blocked on Legal']) {
      expect(stageFor(status), `${status} must not map to a stage`).toBeUndefined();
    }
  });

  it('states `Pending` the way the workflow document writes it', () => {
    expect(workflow).toContain(`\`${PENDING}\``);
  });
});

describe('the session announcement', () => {
  // Seven statements of one string — six skills and the dispatcher — and the pipeline's
  // whole concurrency control rests on them matching byte-for-byte. The document is where
  // the form is stated; this holds the pattern against it.
  it('matches the form the workflow document tells every stage to write', () => {
    const stated = /<!--\s*jen:run\s+stage=<skill>\s+event=start\s*-->/.exec(workflow);
    expect(stated, 'AGENTS.md must state the marker exactly once, for the skills to copy').not.toBeNull();

    for (const skill of ['design-task', 'implement-task', 'review-task', 'test-task', 'deliver-task']) {
      const start = stated![0].replace('<skill>', skill);
      expect(MARKER.exec(start)?.slice(1)).toEqual([skill, 'start']);
      expect(MARKER.exec(start.replace('event=start', 'event=end'))?.slice(1)).toEqual([skill, 'end']);
    }
  });

  it('is stated in the workflow document rather than restated by each skill', () => {
    const restating = SKILLS.filter((skill) =>
      readRepoFile(`.claude/skills/${skill}/SKILL.md`).includes('jen:run'),
    );
    expect(restating, 'the marker belongs in AGENTS.md once, not in every skill').toEqual([]);
  });

  it('ignores a comment carrying no marker at all', () => {
    expect(MARKER.test('Design complete. Artifacts on the PR.')).toBe(false);
    expect(MARKER.test('<!-- some other html comment -->')).toBe(false);
  });
});
