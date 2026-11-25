import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import { build, buildPlatform, checkVersion, manifest, platformManifest } from "./build.ts";
import { machineVersion } from "./machine.ts";

let out: string;
beforeAll(() => {
  out = join(mkdtempSync(join(tmpdir(), "jen-build-test-")), "dist");
  build("1.2.3", out);
}, 120_000);
afterAll(() => rmSync(join(out, ".."), { recursive: true, force: true }));

test("the manifest is jen-ai at the version, with the command, the platform package as its only dependency, optional and at the same version, and the Apache-2.0 license", () => {
  expect(manifest("1.2.3")).toEqual({
    name: "jen-ai",
    version: "1.2.3",
    type: "module",
    bin: { jen: "cli/jen.js" },
    files: ["cli", "NOTICE"],
    engines: { node: ">=26" },
    optionalDependencies: { "@jen-ai/darwin-arm64": "1.2.3" },
    repository: { type: "git", url: "git+https://github.com/reveer-ai/jen.git" },
    license: "Apache-2.0",
  });
  expect(JSON.parse(readFileSync(join(out, "package.json"), "utf8"))).toEqual(manifest("1.2.3"));
});

test("the package holds the compiled command, README.md, LICENSE and NOTICE, and no tests, fakes or TypeScript", () => {
  expect(readdirSync(out).sort()).toEqual(["LICENSE", "NOTICE", "README.md", "cli", "package.json"]);
  const cli = readdirSync(join(out, "cli")).sort();
  expect(cli).toContain("jen.js");
  expect(cli).toContain("main.js");
  expect(cli.filter((f) => !f.endsWith(".js") || /test|fake|harness/.test(f))).toEqual([]);
  expect(readFileSync(join(out, "README.md"), "utf8")).toBe(readFileSync(join(import.meta.dirname, "..", "README.md"), "utf8"));
  expect(readFileSync(join(out, "LICENSE"), "utf8")).toBe(readFileSync(join(import.meta.dirname, "..", "LICENSE"), "utf8"));
  expect(readFileSync(join(out, "NOTICE"), "utf8")).toBe(readFileSync(join(import.meta.dirname, "..", "NOTICE"), "utf8"));
});

test("the version is written into cli/release.js, which the command reads it from", async () => {
  const { VERSION } = await import(join(out, "cli", "release.js"));
  expect(VERSION).toBe("1.2.3");
});

test("the compiled command runs from node as jen", () => {
  const help = spawnSync(process.execPath, [join(out, "cli", "jen.js"), "help"], { encoding: "utf8" });
  expect([help.status, help.stdout]).toMatchObject([0, expect.stringMatching(/^jen runs your agents\./)]);
});

test.each([undefined, "", "1.2", "v1.2.3", "1.2.3-beta.1", "01.2.3", "1.2.3 "])("the version %j is refused", (version) => {
  expect(() => checkVersion(version)).toThrow(/must be x\.y\.z/);
});

test("npm run build refuses a version that isn't x.y.z, building nothing", () => {
  const result = spawnSync(process.execPath, [join(import.meta.dirname, "build.ts"), "latest"], { encoding: "utf8" });
  expect([result.status, result.stderr]).toEqual([1, 'build: the version must be x.y.z, such as 0.1.0, not "latest"\n']);
});

test("building keeps a checkout's dist/machine/, and jen-ai's tarball leaves it out", () => {
  const dist = join(out, "..", "with-machine");
  mkdirSync(join(dist, "machine"), { recursive: true });
  writeFileSync(join(dist, "machine", "system.img"), "");
  writeFileSync(join(dist, "stale.js"), "");
  build("1.2.3", dist);
  expect(readdirSync(dist).sort()).toEqual(["LICENSE", "NOTICE", "README.md", "cli", "machine", "package.json"]);
  const packed = spawnSync("npm", ["pack", "--dry-run", "--json", dist], { encoding: "utf8" });
  const files = (JSON.parse(packed.stdout)[0].files as { path: string }[]).map((f) => f.path);
  expect(files.filter((f) => !f.startsWith("cli/")).sort()).toEqual(["LICENSE", "NOTICE", "README.md", "package.json"]);
}, 120_000);

test("the platform package's manifest installs only on macOS on arm64", () => {
  expect(platformManifest("1.2.3")).toEqual({
    name: "@jen-ai/darwin-arm64",
    version: "1.2.3",
    description: "jen's machine for Apple silicon Macs, which jen-ai installs.",
    os: ["darwin"],
    cpu: ["arm64"],
    repository: { type: "git", url: "git+https://github.com/reveer-ai/jen.git" },
    license: "SEE LICENSE IN NOTICE",
  });
});

// A folder laid out as npm run build:machine lays out dist/machine/.
function machineFolder() {
  const machine = join(out, "..", "machine");
  mkdirSync(machine, { recursive: true });
  for (const file of ["vmlinuz", "initramfs", "system.img", "version", "jen-machine", "docker"]) writeFileSync(join(machine, file), file, { mode: 0o644 });
  return machine;
}

test("the platform package holds the machine, the launcher and docker, runnable, with its notices", () => {
  const platform = join(out, "..", "platform");
  buildPlatform("1.2.3", machineFolder(), platform);
  expect(readdirSync(platform).sort()).toEqual(["LICENSE", "NOTICE", "README.md", "bin", "machine", "package.json"]);
  expect(readdirSync(join(platform, "machine")).sort()).toEqual(["initramfs", "system.img", "version", "vmlinuz"]);
  expect(readdirSync(join(platform, "bin")).sort()).toEqual(["docker", "jen-machine"]);
  for (const file of ["docker", "jen-machine"]) expect(statSync(join(platform, "bin", file)).mode & 0o777).toBe(0o755);
  expect(readFileSync(join(platform, "bin", "jen-machine"), "utf8")).toBe("jen-machine");
  expect(JSON.parse(readFileSync(join(platform, "package.json"), "utf8"))).toEqual(platformManifest("1.2.3"));
  expect(readFileSync(join(platform, "NOTICE"), "utf8")).toMatch(/GNU General\s+Public License version 2/);
});

test("the platform package's version is its system's and its launcher's, whatever the folder's says", () => {
  const platform = join(out, "..", "platform");
  const machine = machineFolder();
  buildPlatform("1.2.3", machine, platform);
  const first = readFileSync(join(platform, "machine", "version"), "utf8");
  expect(first).toBe(`${machineVersion(machine)}\n`);
  writeFileSync(join(machine, "jen-machine"), "jen-machine, rebuilt");
  buildPlatform("1.2.3", machine, platform);
  expect(readFileSync(join(platform, "machine", "version"), "utf8")).not.toBe(first);
});

test("the platform package isn't built from a folder missing any of its files", () => {
  const machine = machineFolder();
  rmSync(join(machine, "docker"));
  expect(() => buildPlatform("1.2.3", machine, join(out, "..", "platform"))).toThrow(/has no docker\. npm run build:machine writes them into dist\/machine\//);
});
