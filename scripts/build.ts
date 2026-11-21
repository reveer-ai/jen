// Builds the npm package, jen-ai, into dist/ at a release's version:
//
//   npm run build -- <x.y.z>
//
// It holds src/cli/ compiled to JavaScript, with the version written into
// cli/release.js, a package.json of its own, README.md and LICENSE. The repo's
// package.json stays private, so only this folder can be published.

import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");

// The package's name on npm, which jen uninstall removes as well.
export const PACKAGE = "jen-ai";

export function checkVersion(version: string | undefined): string {
  if (version === undefined || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
    throw new Error(`the version must be x.y.z, such as 0.1.0, not ${version === undefined ? "nothing" : JSON.stringify(version)}`);
  }
  return version;
}

// The published package.json. It has no dependencies: the command needs only
// Node's built-ins, and openai belongs to the agent's image.
export function manifest(version: string) {
  return {
    name: PACKAGE,
    version: checkVersion(version),
    type: "module",
    bin: { jen: "cli/jen.js" },
    engines: { node: ">=26" },
    // npm's trusted publishing compares this exactly with the repo a release
    // runs from.
    repository: { type: "git", url: "git+https://github.com/reveer-ai/jen.git" },
    license: "SEE LICENSE IN LICENSE",
  };
}

export const releaseModule = (version: string) => `// The release this command is, written by the build.\nexport const VERSION = ${JSON.stringify(checkVersion(version))};\n`;

// Writes the package into out, replacing whatever is there.
export function build(version: string, out = join(ROOT, "dist")): void {
  checkVersion(version);
  // tsc also writes the files of src/runtime/ and src/agent/ that src/cli/
  // imports only types from, so it compiles elsewhere and only cli/ is kept.
  const compiled = mkdtempSync(join(tmpdir(), "jen-build-"));
  try {
    const tsc = spawnSync(join(ROOT, "node_modules", ".bin", "tsc"), ["-p", join(ROOT, "tsconfig.build.json"), "--outDir", compiled], { encoding: "utf8" });
    if (tsc.status !== 0) throw new Error(`tsc failed:\n${tsc.stdout}${tsc.stderr}${tsc.error?.message ?? ""}`);
    rmSync(out, { recursive: true, force: true });
    cpSync(join(compiled, "cli"), join(out, "cli"), { recursive: true });
  } finally {
    rmSync(compiled, { recursive: true, force: true });
  }
  writeFileSync(join(out, "cli", "release.js"), releaseModule(version));
  writeFileSync(join(out, "package.json"), `${JSON.stringify(manifest(version), null, 2)}\n`);
  for (const file of ["README.md", "LICENSE"]) cpSync(join(ROOT, file), join(out, file));
}

if (import.meta.main) {
  try {
    build(checkVersion(process.argv[2]));
  } catch (error) {
    process.stderr.write(`build: ${(error as Error).message}\n`);
    process.exit(1);
  }
}
