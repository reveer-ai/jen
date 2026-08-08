/**
 * The declaration of every file jen owns in a project it manages.
 *
 * This is data, not logic — readable without running anything, and the single source
 * consumed by both `scripts/stage-payload.js` at pack time and the CLI at install time.
 * Skills are one kind of managed file, not the only kind; nothing below assumes one.
 */

/** The file formats jen can ship. */
export type ManagedFileFormat = 'markdown' | 'yaml' | 'json';

/**
 * The formats with somewhere to put the stamp — frontmatter for markdown, `#` comments
 * for YAML. JSON has neither, so a JSON file can never be recognised as jen's, and can
 * therefore never be a variable-set member.
 */
export const STAMPABLE_FORMATS = ['markdown', 'yaml'] as const satisfies readonly ManagedFileFormat[];

export function isStampable(format: ManagedFileFormat): boolean {
  return (STAMPABLE_FORMATS as readonly ManagedFileFormat[]).includes(format);
}

/** One file, at its three locations: jen's checkout, the staged payload, the project. */
export interface ManagedFile {
  /** Path in jen's own repository, relative to the repository root. */
  source: string;
  /** Path within the staged payload, relative to {@link STAGED_PAYLOAD_DIR}. Tool-neutral. */
  staged: string;
  /** Path in a managed project, relative to the project root. */
  target: string;
  format: ManagedFileFormat;
}

/**
 * A single known location jen always writes. It can never be left orphaned by a later
 * version, so it is never a deletion candidate and carries no stamp.
 */
export interface FixedPath {
  kind: 'fixed';
  file: ManagedFile;
}

/**
 * A group of files jen writes into a directory it shares with the project, where the
 * membership of the group can change between versions. Members are stamped so that a
 * member dropped from a later payload can be told apart from the project's own files.
 */
export interface VariableSet {
  kind: 'variable-set';
  /** Identifier for the set itself, for diagnostics. */
  name: string;
  /** The directory in a managed project the set writes into, shared with the project. */
  targetDir: string;
  members: readonly ManagedFile[];
}

export type PayloadGroup = FixedPath | VariableSet;

/** Where `prepack` stages the payload, relative to the package root. */
export const STAGED_PAYLOAD_DIR = 'dist/templates';

/**
 * The ownership stamp: one namespaced key whose presence — not its value — denotes that
 * jen wrote the file. Constant across releases, because a value that moved per version
 * would rewrite every managed file in every project on every release.
 */
export const STAMP = {
  section: 'metadata',
  key: 'jen',
  value: true,
} as const;

/** The stamp rendered for insertion into YAML frontmatter, trailing newline included. */
export const STAMP_FRONTMATTER = `${STAMP.section}:\n  ${STAMP.key}: ${STAMP.value}\n`;

/** The six workflow stages, one skill each. */
export const STAGE_SKILLS = [
  'refine-epic',
  'design-task',
  'implement-task',
  'review-task',
  'test-task',
  'deliver-task',
] as const;

const SKILLS_TARGET_DIR = '.claude/skills';

function stageSkill(name: string): ManagedFile {
  return {
    source: `${SKILLS_TARGET_DIR}/${name}/SKILL.md`,
    staged: `skills/${name}/SKILL.md`,
    target: `${SKILLS_TARGET_DIR}/${name}/SKILL.md`,
    format: 'markdown',
  };
}

export const PAYLOAD: readonly PayloadGroup[] = [
  {
    kind: 'fixed',
    file: {
      source: 'AGENTS.md',
      staged: 'AGENTS.md',
      target: 'AGENTS.md',
      format: 'markdown',
    },
  },
  {
    kind: 'variable-set',
    name: 'stage-skills',
    targetDir: SKILLS_TARGET_DIR,
    members: STAGE_SKILLS.map(stageSkill),
  },
];

export interface StagedFile {
  file: ManagedFile;
  /** Whether staging applies the ownership stamp — true for variable-set members only. */
  stamped: boolean;
}

/** Every managed file, flattened out of its group and paired with its stamping rule. */
export function payloadFiles(payload: readonly PayloadGroup[] = PAYLOAD): StagedFile[] {
  return payload.flatMap((group): StagedFile[] =>
    group.kind === 'fixed'
      ? [{ file: group.file, stamped: false }]
      : group.members.map((file) => ({ file, stamped: true })),
  );
}
