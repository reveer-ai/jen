/**
 * Reading jen's ownership stamp back off a file on disk.
 *
 * A scan, not a YAML parse. Staging inserts the stamp as text so that it stays
 * byte-deterministic, and this side reads it the same way: one idea of what frontmatter
 * is, and no dependency to accept forms staging never produces.
 *
 * Where the scan is ambiguous it answers "not stamped". That is the safe direction —
 * an unrecognised file is left alone, never deleted.
 */
import { STAMP } from './payload.js';

/**
 * The raw YAML frontmatter block, or `null` when the file has none. Deliberately a scan
 * rather than a parser — the same thing a skill loader does to find `name`.
 */
export function frontmatterOf(content: string): string | null {
  if (!content.startsWith('---\n')) return null;
  const close = content.indexOf('\n---\n', 3);
  return close === -1 ? null : content.slice(4, close + 1);
}

function indentOf(line: string): string {
  return line.slice(0, line.length - line.trimStart().length);
}

/**
 * Whether the file carries jen's stamp: `jen: true` as a direct key of a `metadata` block
 * mapping in the frontmatter.
 *
 * Only the block form counts. A hand-written flow-style `metadata: {jen: true}` is not
 * recognised — nothing jen writes looks like that, and failing to recognise it means
 * leaving the file alone rather than deleting it.
 */
export function hasStamp(content: string): boolean {
  const frontmatter = frontmatterOf(content);
  if (frontmatter === null) return false;

  const lines = frontmatter.split('\n');
  const opensBlock = lines.findIndex((line) => line.trimEnd() === `${STAMP.section}:`);
  if (opensBlock === -1) return false;

  // The block runs until the first line that dedents back to the frontmatter's own level.
  let level: string | null = null;
  for (const line of lines.slice(opensBlock + 1)) {
    if (line.trim() === '') continue;

    const indent = indentOf(line);
    if (indent === '') break;
    level ??= indent;
    // Deeper than the block's own keys — a nested mapping, not `metadata.jen`.
    if (indent !== level) continue;

    const colon = line.indexOf(':');
    if (colon === -1) continue;
    if (line.slice(0, colon).trim() === STAMP.key && line.slice(colon + 1).trim() === String(STAMP.value)) {
      return true;
    }
  }
  return false;
}
