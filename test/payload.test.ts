import { describe, expect, it } from 'vitest';

import {
  isStampable,
  memberShape,
  memberSlot,
  PAYLOAD,
  payloadFiles,
  SCAFFOLD,
  stagedFiles,
  STAGE_SKILLS,
  STAMP,
  STAMP_FRONTMATTER,
  type VariableSet,
} from '../cli/payload.js';

const variableSets = PAYLOAD.filter((group): group is VariableSet => group.kind === 'variable-set');
const stageSkills = variableSets.find((set) => set.name === 'stage-skills');

describe('the payload declaration', () => {
  it('declares root AGENTS.md as a fixed path', () => {
    const fixed = PAYLOAD.filter((group) => group.kind === 'fixed');
    expect(fixed.map((group) => group.file.target)).toContain('AGENTS.md');
  });

  it('declares the six stage skills as a variable set targeting .claude/skills', () => {
    expect(stageSkills).toBeDefined();
    expect(stageSkills!.targetDir).toBe('.claude/skills');
    expect(stageSkills!.members).toHaveLength(6);
    expect(STAGE_SKILLS).toEqual([
      'refine-epic',
      'design-task',
      'implement-task',
      'review-task',
      'test-task',
      'deliver-task',
    ]);
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
    expect(stamped).toHaveLength(6);
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

  it('exposes each variable set\'s member shape and slot', () => {
    expect(memberShape(stageSkills!)).toBe('SKILL.md');
    expect(stageSkills!.members.map((member) => memberSlot(stageSkills!, member))).toEqual([...STAGE_SKILLS]);
  });

  it('will not guess a shape it cannot derive', () => {
    const empty: VariableSet = { kind: 'variable-set', name: 'nothing', targetDir: '.claude/skills', members: [] };
    expect(() => memberShape(empty)).toThrow(/no members/);

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
});
