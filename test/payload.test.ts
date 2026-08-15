import { describe, expect, it } from 'vitest';

import {
  isStampable,
  memberShape,
  PAYLOAD,
  payloadFiles,
  SCAFFOLD,
  stagedFiles,
  SKILLS,
  STAMP,
  STAMP_FRONTMATTER,
  type VariableSet,
} from '../cli/payload.js';
import { readRepoFile } from './helpers.js';

const variableSets = PAYLOAD.filter((group): group is VariableSet => group.kind === 'variable-set');
const skills = variableSets.find((set) => set.name === 'skills');

describe('the payload declaration', () => {
  it('declares root AGENTS.md as a fixed path', () => {
    const fixed = PAYLOAD.filter((group) => group.kind === 'fixed');
    expect(fixed.map((group) => group.file.target)).toContain('AGENTS.md');
  });

  it('declares the skills it ships as a variable set targeting .claude/skills', () => {
    expect(skills).toBeDefined();
    expect(skills!.targetDir).toBe('.claude/skills');
    expect(SKILLS).toEqual([
      'refine-epic',
      'design-task',
      'implement-task',
      'review-task',
      'test-task',
      'deliver-task',
      'setup-jen',
    ]);
    expect(skills!.members).toHaveLength(SKILLS.length);
  });

  // The set is the skills jen ships, not the pipeline's stages. `setup-jen` is triggered
  // by no status and appears in no stage table, and is a member on exactly the terms the
  // other six are — a payload addition needs no migration, so the next `jen update`
  // writes it into an already-adopted project.
  it('holds a shipped skill that no pipeline status triggers', () => {
    expect(SKILLS).toContain('setup-jen');
    expect(payloadFiles().find((entry) => entry.file.target.includes('setup-jen'))).toEqual({
      file: {
        source: '.claude/skills/setup-jen/SKILL.md',
        staged: 'skills/setup-jen/SKILL.md',
        target: '.claude/skills/setup-jen/SKILL.md',
        format: 'markdown',
      },
      stamped: true,
    });
  });

  // Two sets over one directory would derive the same member shape and search the same
  // locations, so a single stamped orphan would land in `plan.deletions` once per set:
  // a duplicated line in the report and a second `unlink` of a path already gone.
  it('gives each variable set a target directory of its own', () => {
    const directories = variableSets.map((set) => set.targetDir);
    expect(new Set(directories).size).toBe(directories.length);
  });

  it('names every managed file explicitly, with no glob or wildcard', () => {
    for (const { file } of payloadFiles()) {
      for (const path of [file.source, file.staged, file.target]) {
        expect(path, `${path} must be a literal path`).not.toMatch(/[*?[\]{}]/);
        expect(path).not.toContain('..');
      }
    }
  });

  it('only puts stamp-carrying formats in a variable set', () => {
    for (const set of variableSets) {
      for (const member of set.members) {
        expect(member.format, `${member.source} must be able to carry the stamp`).not.toBe('json');
        expect(isStampable(member.format)).toBe(true);
      }
    }
  });

  it('stamps variable-set members and leaves fixed paths unstamped', () => {
    const stamped = payloadFiles().filter((entry) => entry.stamped);
    expect(stamped).toHaveLength(SKILLS.length);
    expect(payloadFiles().filter((entry) => !entry.stamped).map((entry) => entry.file.target)).toEqual([
      'AGENTS.md',
    ]);
  });

  it('is a single namespaced key carrying no version', () => {
    expect(STAMP).toEqual({ section: 'metadata', key: 'jen', value: true });
    expect(STAMP_FRONTMATTER).toBe('metadata:\n  jen: true\n');
  });

  it('stages to tool-neutral paths', () => {
    for (const { file } of stagedFiles()) {
      expect(file.staged.split('/')).not.toContain('.claude');
      expect(file.staged).not.toMatch(/^\./);
    }
  });

  it('exposes each variable set\'s member shape, one slot below its target directory', () => {
    expect(memberShape(skills!)).toBe('SKILL.md');
    expect(skills!.members.map((member) => member.target)).toEqual(
      SKILLS.map((name) => `.claude/skills/${name}/SKILL.md`),
    );
  });

  it('will not guess a shape it cannot derive', () => {
    const empty: VariableSet = { kind: 'variable-set', name: 'nothing', targetDir: '.claude/skills', members: [] };
    expect(() => memberShape(empty)).toThrow(/no members/);

    const slotless: VariableSet = {
      ...empty,
      members: [
        { source: 'a/SKILL.md', staged: 'a/SKILL.md', target: '.claude/skills/SKILL.md', format: 'markdown' },
      ],
    };
    expect(() => memberShape(slotless)).toThrow(/live in a slot below it/);

    const mixed: VariableSet = {
      ...empty,
      members: [
        { source: 'a/one/SKILL.md', staged: 'a/one/SKILL.md', target: '.claude/skills/one/SKILL.md', format: 'markdown' },
        { source: 'a/two/GUIDE.md', staged: 'a/two/GUIDE.md', target: '.claude/skills/two/GUIDE.md', format: 'markdown' },
      ],
    };
    expect(() => memberShape(mixed)).toThrow(/mixes member shapes/);
  });
});

describe('the scaffold declaration', () => {
  it('is beside the payload, never inside it', () => {
    const managed = new Set(payloadFiles().map((entry) => entry.file.target));
    for (const file of SCAFFOLD) {
      expect(managed, `${file.target} must not be a managed path`).not.toContain(file.target);
    }
    expect(SCAFFOLD.map((file) => file.target)).toEqual(['registry.yaml', '.claude/settings.json']);
  });

  it('ships unstamped, even where the format could carry a stamp', () => {
    for (const { file, stamped } of stagedFiles()) {
      if (SCAFFOLD.some((entry) => entry.target === file.target)) expect(stamped).toBe(false);
    }
  });

  // A stage told to run something the harness denies cannot do its work, and an unattended
  // run has nobody to grant the permission when it asks. The workflow's own tooling is the
  // part jen can grant for every project — the adopter's own check commands are theirs to add,
  // which is why this asserts the shared floor rather than the whole list.
  it('grants the tooling every stage is told to run', () => {
    const settings = SCAFFOLD.find((file) => file.target === '.claude/settings.json');
    expect(settings, 'the scaffold must carry assistant settings to grant anything in').toBeDefined();

    const allow = JSON.parse(readRepoFile(settings!.source)).permissions?.allow;
    for (const tool of ['git', 'gh', 'openspec']) {
      expect(allow, `every stage runs ${tool}`).toContain(`Bash(${tool}:*)`);
    }
  });

  // The scaffold is the first thing an adopter reads after `jen init`, and it is written
  // long before the skills it points at settle on their names. A dead pointer here is
  // invisible in this repo and only shows up in an installed project.
  it('points only at skills jen actually ships', () => {
    for (const file of SCAFFOLD) {
      for (const [reference, name] of readRepoFile(file.source).matchAll(/`([^`]+)` skill/g)) {
        expect(SKILLS, `${file.source} says "${reference}"`).toContain(name);
      }
    }
  });
});
