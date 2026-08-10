#!/usr/bin/env node
/**
 * Stages the payload into `dist/templates/` for packing.
 *
 * Plain Node ESM with no build of its own, importing the payload declaration from
 * `dist/` after `tsc` has run — `prepack` guarantees that order. Run standalone before a
 * build, it fails rather than staging an unstamped or partial payload.
 *
 * Usage: node scripts/stage-payload.js [--out <dir>]
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

function fail(message) {
  console.error(`stage-payload: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  let out = null;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--out') {
      out = argv[i + 1] ?? fail('--out needs a directory');
      i += 1;
    } else {
      fail(`unknown argument: ${argv[i]}`);
    }
  }
  return { out };
}

async function loadDeclaration() {
  const built = join(repoRoot, 'dist', 'payload.js');
  if (!existsSync(built)) {
    fail(`${built} is missing. Run \`npm run build\` first — \`prepack\` does this for you.`);
  }
  try {
    return await import(pathToFileURL(built).href);
  } catch (error) {
    fail(`could not import ${built}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Inserts the stamp immediately before the closing `---` of the YAML frontmatter.
 *
 * Text insertion, not a YAML round-trip: staging has to be byte-deterministic, and
 * re-serialising would normalise formatting nobody asked to change.
 */
function stampFrontmatter(content, sourcePath, stamp) {
  const OPEN = '---\n';
  const CLOSE = '\n---\n';

  if (!content.startsWith(OPEN)) {
    fail(`${sourcePath}: no YAML frontmatter to stamp`);
  }

  const close = content.indexOf(CLOSE, OPEN.length - 1);
  if (close === -1) {
    fail(`${sourcePath}: frontmatter is never closed`);
  }

  const frontmatter = content.slice(OPEN.length, close + 1);
  if (/^metadata:/m.test(frontmatter)) {
    fail(`${sourcePath}: already carries a \`metadata\` key. Working copies must stay unstamped.`);
  }

  const insertAt = close + 1;
  return content.slice(0, insertAt) + stamp + content.slice(insertAt);
}

const { out } = parseArgs(process.argv.slice(2));
const { PAYLOAD, SCAFFOLD, STAGED_PAYLOAD_DIR, STAMP_FRONTMATTER, isStampable, stagedFiles } = await loadDeclaration();

const outDir = out
  ? isAbsolute(out)
    ? out
    : resolve(process.cwd(), out)
  : join(repoRoot, STAGED_PAYLOAD_DIR);

// Cleared rather than merged into, so a member dropped from the declaration cannot
// linger in the staged tree and ship.
await rm(outDir, { recursive: true, force: true });

const staged = stagedFiles(PAYLOAD, SCAFFOLD);

for (const { file, stamped } of staged) {
  const sourcePath = join(repoRoot, file.source);
  if (!existsSync(sourcePath)) {
    fail(`${file.source} is declared in the payload but missing from the repository`);
  }
  if (stamped && !isStampable(file.format)) {
    fail(`${file.source} is a variable-set member but its format (${file.format}) cannot carry the stamp`);
  }

  const source = await readFile(sourcePath, 'utf8');
  const content = stamped ? stampFrontmatter(source, file.source, STAMP_FRONTMATTER) : source;

  const destination = join(outDir, file.staged);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, content, 'utf8');
}

// stderr, not stdout: this runs inside `prepack`, and `npm pack --json` puts its own
// machine-readable output on stdout.
console.error(`stage-payload: staged ${staged.length} files into ${outDir}`);
