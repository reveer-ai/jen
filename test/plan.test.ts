import { existsSync, lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

import { apply } from '../cli/apply.js';
import {
  PAYLOAD,
  SKILLS,
  STAMP_FRONTMATTER,
  memberShape,
  payloadFiles,
  type VariableSet,
} from '../cli/payload.js';
import { planInstall, reconcileCandidates, stagedPayloadDir, touchedPaths, type Plan } from '../cli/plan.js';
import { changed, link, messyProject, neighbours, project, snapshot, stamped } from './fixture.js';
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
      '.claude/skills/openspec-explore/SKILL.md',
    ]);
  });

  it('never considers a path deeper than the set writes, or beside it', () => {
    const root = messyProject(staged);
    const candidates = reconcileCandidates(root, skills);

    expect(candidates).not.toContain('.claude/skills/team/nested/SKILL.md');
    expect(candidates).not.toContain('.claude/skills/notes/README.md');
    expect(candidates).not.toContain('docs/SKILL.md');
  });

  // A member occupies a slot, so a file lying directly in the target directory is not one,
  // whatever it is called and whatever it carries. jen keeps its own notes for the stage
  // skills at `.claude/skills/AGENTS.md`, which puts a real file in that position, and an
  // adopter may keep their own there for the same reason. Deletion is the stamp intersected
  // with the slot enumeration; the danger is a future reconciliation that reaches for the
  // stamp alone — walking the target directory for stamped files is the obvious shortcut,
  // and it would take this one, because the stamp is genuinely there.
  it('spares a file lying directly in the target directory, stamp and all', () => {
    const root = messyProject(staged);
    expect(reconcileCandidates(root, skills)).not.toContain('.claude/skills/AGENTS.md');

    apply(planInstall(root, { scaffold: false, templates: staged }));
    expect(existsSync(join(root, '.claude/skills/AGENTS.md'))).toBe(true);
  });

  it('is empty when the target directory does not exist', () => {
    expect(reconcileCandidates(project({}, 'bare'), skills)).toEqual([]);
  });

  it('is empty when the target directory is a symlink — its contents are not the project\'s', () => {
    const { root, outside } = neighbours('linked-dir', {}, { 'skills/legacy-stage/SKILL.md': stamped('legacy-stage') });
    link(root, '.claude/skills', join(outside, 'skills'));

    expect(reconcileCandidates(root, skills)).toEqual([]);
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

    // the hand-edited skill and the project's own AGENTS.md differ; every other managed
    // path is absent, which is also a write
    expect(plan.writes.filter((write) => write.replaces).map((write) => write.target)).toEqual([
      'AGENTS.md',
      '.claude/skills/design-task/SKILL.md',
    ]);
    expect(plan.writes).toHaveLength(payloadFiles().length);
    expect(plan.current).toEqual([]);
  });

  it('reports nothing to do for a project that is already current', () => {
    const root = messyProject(staged);
    apply(planInstall(root, { scaffold: false, templates: staged }));

    const plan = planInstall(root, { scaffold: false, templates: staged });
    expect(plan.writes).toEqual([]);
    expect(plan.deletions).toEqual([]);
    expect(plan.current).toHaveLength(payloadFiles().length);
  });

  it('plans the deletion of a stamped file this version no longer ships, and only that', () => {
    const plan = planInstall(messyProject(staged), { scaffold: false, templates: staged });
    expect(plan.deletions).toEqual(['.claude/skills/legacy-stage/SKILL.md']);
  });

  // Deletion is the stamp intersected with the shipped payload. Anything that widened it
  // to "what the payload does not ship" would still pass the test above and would take
  // these with it, since `openspec init` writes them into the same directory jen does.
  it('spares the unstamped skills sharing the target directory, OpenSpec\'s included', () => {
    const root = messyProject(staged);
    apply(planInstall(root, { scaffold: false, templates: staged }));

    for (const path of ['.claude/skills/openspec-explore/SKILL.md', '.claude/skills/deploy-service/SKILL.md']) {
      expect(existsSync(join(root, path)), `${path} was not jen's to delete`).toBe(true);
    }
  });

  // The stamp gates deletion and nothing else, which is not what "ownership stamp" sounds
  // like it means. Unstamping a file the payload still ships buys an adopter nothing: it
  // is rewritten from the payload, stamp included. `README.md` tells adopters exactly this
  // — an adoption run caught draft text promising the opposite — so it is asserted rather
  // than left as a property of which branch happens to read `hasStamp`.
  it('rewrites a shipped skill whose stamp the project removed', () => {
    const shipped = readFileSync(join(staged, 'skills/design-task/SKILL.md'), 'utf8');
    const root = project(
      { '.claude/skills/design-task/SKILL.md': `${shipped.replace(STAMP_FRONTMATTER, '')}\nA local edit.\n` },
      'unstamped-shipped',
    );

    const plan = planInstall(root, { scaffold: false, templates: staged });
    expect(plan.writes.map((write) => write.target)).toContain('.claude/skills/design-task/SKILL.md');
    expect(plan.deletions).toEqual([]);

    apply(plan);
    const after = readFileSync(join(root, '.claude/skills/design-task/SKILL.md'), 'utf8');
    expect(after).toBe(shipped);
    expect(after, 'the stamp is restored along with the content').toContain(STAMP_FRONTMATTER);
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

  it('classifies a symlink at a managed path as something occupying it, not as absent', () => {
    const { root, outside } = neighbours('linked-leaf', {}, { 'notes.md': 'The neighbour wrote this.\n' });
    link(root, 'AGENTS.md', join(outside, 'notes.md'));

    const plan = planInstall(root, { scaffold: false, templates: staged });
    const agents = plan.writes.find((write) => write.target === 'AGENTS.md');

    expect(agents?.replaces).toBe(true);
    expect(agents?.symlink).toBe(true);
    // and therefore a conflict `init` has to surface, rather than a silent overwrite of
    // whatever sits at the other end
    expect(plan.conflicts).toEqual(['AGENTS.md']);
  });

  it('classifies a dangling symlink the same way — `existsSync` would call it absent', () => {
    const { root, outside } = neighbours('dangling');
    link(root, 'AGENTS.md', join(outside, 'never-created.md'));

    const plan = planInstall(root, { scaffold: false, templates: staged });

    expect(plan.writes.find((write) => write.target === 'AGENTS.md')?.symlink).toBe(true);
    expect(plan.conflicts).toEqual(['AGENTS.md']);
  });

  it('names a managed path behind a symlinked directory as an obstruction, and plans no write for it', () => {
    const { root, outside } = neighbours('linked-parent');
    link(root, '.claude', join(outside, 'dotclaude'));

    const plan = planInstall(root, { scaffold: true, templates: staged });

    expect(plan.obstructions.map(({ target }) => target)).toEqual([
      ...SKILLS.map((name) => `.claude/skills/${name}/SKILL.md`),
      '.claude/settings.json',
    ]);
    expect(plan.obstructions.every(({ ancestor }) => ancestor === '.claude')).toBe(true);
    expect(touchedPaths(plan)).toEqual(['AGENTS.md', '.github/workflows/jen.yml', 'registry.yaml']);
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

/**
 * A managed file carrying values the project owns, resolved when it is written.
 *
 * The substituted file is the pipeline's scheduled workflow, and what makes these worth
 * asserting is the failure they exclude: a value that did not resolve must come out *empty*
 * rather than as its own placeholder, because a literal `{{jen:team}}` in a runner's
 * configuration is a wrong project name that reads as a configured one.
 */
describe('substitution', () => {
  const workflow = payloadFiles().find(({ file }) => file.substituted)!.file;

  const BOUND = [
    'resources:',
    '  - name: acme-web',
    '    kind: repository',
    '  - name: acme-web-tracker',
    '    kind: project-management',
    '    provider: linear',
    '    team: ENG',
    '    project: Acme Web',
    '',
  ].join('\n');

  function written(root: string): string {
    apply(planInstall(root, { scaffold: false, templates: staged }));
    return readFileSync(join(root, workflow.target), 'utf8');
  }

  it("carries the registry's values into the file, and leaves the registry itself alone", () => {
    const root = project({ 'registry.yaml': BOUND }, 'bound');
    const plan = planInstall(root, { scaffold: false, templates: staged });

    expect(plan.unresolved).toEqual([]);
    apply(plan);

    const contents = readFileSync(join(root, workflow.target), 'utf8');
    expect(contents).toContain('JEN_TEAM: "ENG"');
    expect(contents).toContain('JEN_PROJECT: "Acme Web"');
    expect(readFileSync(join(root, 'registry.yaml'), 'utf8'), 'the registry is read, never written').toBe(BOUND);
  });

  // Four ways to supply nothing, and the report has to tell them apart: a person fixes each
  // one differently, and the file looks identical in all four.
  it('resolves to nothing rather than throwing, and says which nothing it was', () => {
    const cases: [string, Record<string, string>, RegExp][] = [
      ['absent', {}, /has no registry\.yaml/],
      ['unparseable', { 'registry.yaml': 'resources:\n  - name: [unclosed\n' }, /could not be parsed/],
      ['no tracker', { 'registry.yaml': 'resources:\n  - name: acme\n    kind: repository\n' }, /names no/],
      [
        'two trackers',
        { 'registry.yaml': `${BOUND}  - name: other\n    kind: project-management\n    team: OPS\n    project: Ops\n` },
        /names 2 /,
      ],
    ];

    for (const [label, files, why] of cases) {
      const root = project(files, `unresolved-${label.replace(/ /g, '-')}`);
      const plan = planInstall(root, { scaffold: false, templates: staged });

      expect(plan.unresolved.map((entry) => entry.name), label).toEqual(['team', 'project']);
      for (const entry of plan.unresolved) expect(entry.why, label).toMatch(why);

      const contents = written(root);
      expect(contents, label).not.toContain('{{jen:');
      expect(contents, label).toContain('JEN_TEAM: ""');
    }
  });

  it('names the field a tracker resource is missing, rather than the file', () => {
    const root = project(
      { 'registry.yaml': 'resources:\n  - name: acme-web-tracker\n    kind: project-management\n    team: ENG\n' },
      'half-bound',
    );
    const plan = planInstall(root, { scaffold: false, templates: staged });

    expect(plan.unresolved.map((entry) => entry.name)).toEqual(['project']);
    expect(plan.unresolved[0]!.why).toMatch(/names no `project`/);
    expect(written(root)).toContain('JEN_TEAM: "ENG"');
  });

  it('rewrites the file when the registry changes, and only that file', () => {
    const root = project({ 'registry.yaml': BOUND }, 'rebound');
    apply(planInstall(root, { scaffold: false, templates: staged }));

    writeFileSync(join(root, 'registry.yaml'), BOUND.replace('Acme Web', 'Acme API'));
    const second = planInstall(root, { scaffold: false, templates: staged });

    expect(second.writes.map((write) => write.target)).toEqual([workflow.target]);
    apply(second);
    expect(readFileSync(join(root, workflow.target), 'utf8')).toContain('JEN_PROJECT: "Acme API"');
  });

  // Substitution changes what a managed file says and nothing about which paths a run
  // touches: same writes, same refreshes, same reconciliation, bound or not.
  it('changes what a file says and not which paths a run touches', () => {
    const unbound = messyProject(staged);
    const bound = messyProject(staged);
    writeFileSync(join(bound, 'registry.yaml'), BOUND);

    const one = planInstall(unbound, { scaffold: true, templates: staged });
    const two = planInstall(bound, { scaffold: true, templates: staged });

    expect(touchedPaths(two)).toEqual(touchedPaths(one));
    expect(two.deletions).toEqual(one.deletions);
    expect(two.current).toEqual(one.current);
    expect(two.conflicts).toEqual(one.conflicts);
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
    expect(() => apply(handBuilt(root, '../escaped.md'))).toThrow(/outside/);
  });

  it('refuses a target that escapes through a symlinked directory', () => {
    const { root, outside } = neighbours('escape-link');
    link(root, 'shared', outside);

    expect(() => apply(handBuilt(root, 'shared/escaped.md'))).toThrow(/symlink/);
    expect(existsSync(join(outside, 'escaped.md'))).toBe(false);
  });

  it('replaces a symlink at a managed path rather than writing through it', () => {
    const { root, outside } = neighbours('replace-link', {}, { 'notes.md': 'The neighbour wrote this.\n' });
    link(root, 'AGENTS.md', join(outside, 'notes.md'));

    apply(planInstall(root, { scaffold: false, templates: staged }));

    expect(lstatSync(join(root, 'AGENTS.md')).isSymbolicLink()).toBe(false);
    expect(readFileSync(join(root, 'AGENTS.md'), 'utf8')).toBe(readFileSync(join(staged, 'AGENTS.md'), 'utf8'));
    expect(readFileSync(join(outside, 'notes.md'), 'utf8')).toBe('The neighbour wrote this.\n');
  });
});

/** A plan nobody planned — the executor's guards have to hold against one anyway. */
function handBuilt(projectRoot: string, target: string): Plan {
  return {
    projectRoot,
    writes: [{ target, contents: Buffer.from('nope'), replaces: false, symlink: false }],
    current: [],
    deletions: [],
    scaffold: [],
    conflicts: [],
    unresolved: [],
    obstructions: [],
  };
}
