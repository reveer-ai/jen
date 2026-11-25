// Builds the npm packages at a release's version: jen-ai into dist/, and the
// platform package, which holds jen's machine for Apple silicon Macs:
//
//   npm run build -- <x.y.z>
//   npm run build -- platform <x.y.z> <machine> <out>
//
// jen-ai holds src/cli/ compiled to JavaScript, with the version written into
// cli/release.js, a package.json of its own, README.md, LICENSE and NOTICE.
// The platform package is built from a folder laid out as npm run
// build:machine lays out dist/machine/. The repo's package.json stays
// private, so only these folders can be published.

import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PLATFORM_PACKAGE } from "../src/cli/machine.ts";
import { MACHINE_FILES } from "./machine.ts";

const ROOT = join(import.meta.dirname, "..");

// The package's name on npm, which jen uninstall removes as well.
export const PACKAGE = "jen-ai";

export function checkVersion(version: string | undefined): string {
  if (version === undefined || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
    throw new Error(`the version must be x.y.z, such as 0.1.0, not ${version === undefined ? "nothing" : JSON.stringify(version)}`);
  }
  return version;
}

// npm's trusted publishing compares this exactly with the repo a release
// runs from.
const REPOSITORY = { type: "git", url: "git+https://github.com/reveer-ai/jen.git" };

// The published package.json. Its only dependency is the platform package,
// which npm installs only on an Apple silicon Mac: the command needs only
// Node's built-ins, and openai belongs to the agent's image. files leaves out
// a checkout's dist/machine/.
export function manifest(version: string) {
  return {
    name: PACKAGE,
    version: checkVersion(version),
    type: "module",
    bin: { jen: "cli/jen.js" },
    files: ["cli", "NOTICE"],
    engines: { node: ">=26" },
    optionalDependencies: { [PLATFORM_PACKAGE]: version },
    repository: REPOSITORY,
    license: "Apache-2.0",
  };
}

// The platform package's package.json. Its files are under several licenses,
// which its NOTICE names.
export function platformManifest(version: string) {
  return {
    name: PLATFORM_PACKAGE,
    version: checkVersion(version),
    description: "jen's machine for Apple silicon Macs, which jen-ai installs.",
    os: ["darwin"],
    cpu: ["arm64"],
    repository: REPOSITORY,
    license: "SEE LICENSE IN NOTICE",
  };
}

export const releaseModule = (version: string) => `// The release this command is, written by the build.\nexport const VERSION = ${JSON.stringify(checkVersion(version))};\n`;

// Writes the package into out, replacing whatever is there but a checkout's
// machine/, which npm run build:machine writes.
export function build(version: string, out = join(ROOT, "dist")): void {
  checkVersion(version);
  // tsc also writes the files of src/runtime/ and src/agent/ that src/cli/
  // imports only types from, so it compiles elsewhere and only cli/ is kept.
  const compiled = mkdtempSync(join(tmpdir(), "jen-build-"));
  try {
    const tsc = spawnSync(join(ROOT, "node_modules", ".bin", "tsc"), ["-p", join(ROOT, "tsconfig.build.json"), "--outDir", compiled], { encoding: "utf8" });
    if (tsc.status !== 0) throw new Error(`tsc failed:\n${tsc.stdout}${tsc.stderr}${tsc.error?.message ?? ""}`);
    if (existsSync(out)) for (const entry of readdirSync(out)) if (entry !== "machine") rmSync(join(out, entry), { recursive: true, force: true });
    cpSync(join(compiled, "cli"), join(out, "cli"), { recursive: true });
  } finally {
    rmSync(compiled, { recursive: true, force: true });
  }
  writeFileSync(join(out, "cli", "release.js"), releaseModule(version));
  writeFileSync(join(out, "package.json"), `${JSON.stringify(manifest(version), null, 2)}\n`);
  for (const file of ["README.md", "LICENSE", "NOTICE"]) cpSync(join(ROOT, file), join(out, file));
}

// Writes the platform package into out, replacing whatever is there, from
// machine, which holds the machine's files, the signed launcher, jen-machine,
// and the docker command, as dist/machine/ does.
export function buildPlatform(version: string, machine: string, out: string): void {
  checkVersion(version);
  const inputs = [...MACHINE_FILES, "jen-machine", "docker"];
  const missing = inputs.filter((file) => !existsSync(join(machine, file)));
  if (missing.length > 0) throw new Error(`${machine} has no ${missing.join(", ")}. npm run build:machine writes them into dist/machine/.`);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(join(out, "machine"), { recursive: true });
  mkdirSync(join(out, "bin"));
  for (const file of MACHINE_FILES) copyFileSync(join(machine, file), join(out, "machine", file));
  for (const file of ["jen-machine", "docker"]) {
    copyFileSync(join(machine, file), join(out, "bin", file));
    // Executables lose their mode in a GitHub Actions artifact.
    chmodSync(join(out, "bin", file), 0o755);
  }
  writeFileSync(join(out, "package.json"), `${JSON.stringify(platformManifest(version), null, 2)}\n`);
  writeFileSync(join(out, "README.md"), `# ${PLATFORM_PACKAGE}\n\njen's machine for Apple silicon Macs: the Linux VM that is jen's Docker engine there, its launcher and Docker's \`docker\` command. \`npm install -g jen-ai\` installs it, so install that instead: https://github.com/reveer-ai/jen\n`);
  copyFileSync(join(ROOT, "LICENSE"), join(out, "LICENSE"));
  copyFileSync(join(ROOT, "src", "machine", "NOTICE"), join(out, "NOTICE"));
}

if (import.meta.main) {
  try {
    if (process.argv[2] === "platform") {
      const [, , , version, machine, out] = process.argv;
      if (machine === undefined || out === undefined) throw new Error("usage: npm run build -- platform <x.y.z> <machine> <out>");
      buildPlatform(checkVersion(version), machine, out);
    } else build(checkVersion(process.argv[2]));
  } catch (error) {
    process.stderr.write(`build: ${(error as Error).message}\n`);
    process.exit(1);
  }
}
