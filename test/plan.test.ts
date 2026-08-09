import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

import { apply } from '../cli/apply.js';
import { PAYLOAD, memberShape, type VariableSet } from '../cli/payload.js';
import { planInstall, reconcileCandidates, stagedPayloadDir, touchedPaths } from '../cli/plan.js';
import { changed, messyProject, project, snapshot, stamped } from './fixture.js';
import { stageInto } from './helpers.js';

const skills = PAYLOAD.find((group): group is VariableSet => group.kind === 'variable-set')!;

let staged: string;

beforeAll(() => {
  staged = stageInto('plan');
});

describe('the staged payload', () => {
  it('is located relative to the module, and says so when it is missing', () => {
    // Running from source there is no `templates/` beside the module — the same shape as
    // an install straight from a git URL, where `prepack` never ran.
    expect(() => stagedPayloadDir()).toThrow(/staged payload/);
    expect(() => stagedPayloadDir()).toThrow(/registry/);
  });
});

describe('reconciliation candidates', () => {
  it('derives the shape from the declaration rather than hardcoding it', () => {
    expect(memberShape(skills)).toBe('SKILL.md');
  });

  it('finds every location the set could have written, and nothing else', () => {
    const root = messyProject(staged);
    expect(reconcileCandidates(root, skills)).toEqual([
      '.claude/skills/deploy-service/SKILL.md',
      '.claude/skills/design-task-copy/SKILL.md',
      '.claude/skills/design-task/SKILL.md',
      '.claude/skills/legacy-stage/SKILL.md',
    ]);
  });

  it('never considers a path deeper than the set writes, or beside it', () => {
    const root = messyProject(staged);
    const candidates = reconcileCandidates(root, skills);

    expect(candidates).not.toContain('.claude/skills/team/nested/SKILL.md');
    expect(candidates).not.toContain('.claude/skills/notes/README.md');
    expect(candidates).not.toContain('docs/SKILL.md');
  });

  it('is empty when the target directory does not exist', () => {
    expect(reconcileCandidates(project({}, 'bare'), skills)).toEqual([]);
  });
});

describe('the planner', () => {
  it('writes nothing — the tree is byte-identical afterward', () => {
    const root = messyProject(staged);
    const before = snapshot(root);

    planInstall(root, { scaffold: true, templates: staged });

    expect(changed(before, snapshot(root))).toEqual([]);
  });

  it('classifies each managed path as a write or already current', () => {
    const root = messyProject(staged);
    const plan = planInstall(root, { scaffold: false, templates: staged });

    // the hand-edited skill and the project's own AGENTS.md differ; the other five
    // skills are absent, which is also a write
    expect(plan.writes.filter((write) => write.replaces).map((write) => write.target)).toEqual([
      'AGENTS.md',
      '.claude/skills/design-task/SKILL.md',
    ]);
    expect(plan.writes).toHaveLength(7);
    expect(plan.current).toEqual([]);
  });

  it('reports nothing to do for a project that is already current', () => {
    const root = messyProject(staged);
    apply(planInstall(root, { scaffold: false, templates: staged }));

    const plan = planInstall(root, { scaffold: false, templates: staged });
    expect(plan.writes).toEqual([]);
    expect(plan.deletions).toEqual([]);
    expect(plan.current).toHaveLength(7);
  });

  it('plans the deletion of a stamped file this version no longer ships, and only that', () => {
    const plan = planInstall(messyProject(staged), { scaffold: false, templates: staged });
    expect(plan.deletions).toEqual(['.claude/skills/legacy-stage/SKILL.md']);
  });

  it('names an existing, differing fixed path as a conflict', () => {
    const plan = planInstall(messyProject(staged), { scaffold: false, templates: staged });
    expect(plan.conflicts).toEqual(['AGENTS.md']);
  });

  it('does not call an identical fixed path a conflict', () => {
    const root = project({ 'AGENTS.md': readFileSync(join(staged, 'AGENTS.md'), 'utf8') }, 'same-agents');
    const plan = planInstall(root, { scaffold: true, templates: staged });

    expect(plan.conflicts).toEqual([]);
    expect(plan.current).toEqual(['AGENTS.md']);
  });

  it('plans the scaffold only for absent paths, and only when asked', () => {
    const empty = project({}, 'empty');
    expect(planInstall(empty, { scaffold: true, templates: staged }).scaffold.map((w) => w.target)).toEqual([
      'registry.yaml',
      '.claude/settings.json',
    ]);
    expect(planInstall(empty, { scaffold: false, templates: staged }).scaffold).toEqual([]);

    const filled = messyProject(staged);
    expect(planInstall(filled, { scaffold: true, templates: staged }).scaffold).toEqual([]);
  });
});

describe('the executor', () => {
  it('touches exactly the paths the plan named', () => {
    const root = messyProject(staged);
    const before = snapshot(root);
    const plan = planInstall(root, { scaffold: true, templates: staged });

    apply(plan);

    expect(changed(before, snapshot(root)).sort()).toEqual(touchedPaths(plan).sort());
  });

  it('leaves an emptied slot directory in place — it may hold the project\'s own files', () => {
    const root = project(
      {
        '.claude/skills/legacy-stage/SKILL.md': stamped('legacy-stage'),
        '.claude/skills/legacy-stage/reference.md': 'Notes the project keeps here.\n',
      },
      'emptied',
    );
    const plan = planInstall(root, { scaffold: false, templates: staged });
    apply(plan);

    const after = snapshot(root);
    expect(after.has('.claude/skills/legacy-stage/SKILL.md')).toBe(false);
    expect(after.get('.claude/skills/legacy-stage/reference.md')?.content).toBe('Notes the project keeps here.\n');
  });

  it('refuses a target that escapes the project root', () => {
    const root = project({}, 'escape');
    expect(() =>
      apply({
        projectRoot: root,
        writes: [{ target: '../escaped.md', contents: Buffer.from('nope'), replaces: false }],
        current: [],
        deletions: [],
        scaffold: [],
        conflicts: [],
      }),
    ).toThrow(/outside/);
  });
});
