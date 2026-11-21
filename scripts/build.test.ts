import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import { build, checkVersion, manifest } from "./build.ts";

let out: string;
beforeAll(() => {
  out = join(mkdtempSync(join(tmpdir(), "jen-build-test-")), "dist");
  build("1.2.3", out);
}, 120_000);
afterAll(() => rmSync(join(out, ".."), { recursive: true, force: true }));

test("the manifest is jen-ai at the version, with the command, no dependencies and jen's own license", () => {
  expect(manifest("1.2.3")).toEqual({
    name: "jen-ai",
    version: "1.2.3",
    type: "module",
    bin: { jen: "cli/jen.js" },
    engines: { node: ">=26" },
    repository: { type: "git", url: "git+https://github.com/reveer-ai/jen.git" },
    license: "SEE LICENSE IN LICENSE",
  });
  expect(JSON.parse(readFileSync(join(out, "package.json"), "utf8"))).toEqual(manifest("1.2.3"));
});

test("the package holds the compiled command, README.md and LICENSE, and no tests, fakes or TypeScript", () => {
  expect(readdirSync(out).sort()).toEqual(["LICENSE", "README.md", "cli", "package.json"]);
  const cli = readdirSync(join(out, "cli")).sort();
  expect(cli).toContain("jen.js");
  expect(cli).toContain("main.js");
  expect(cli.filter((f) => !f.endsWith(".js") || /test|fake|harness/.test(f))).toEqual([]);
  expect(readFileSync(join(out, "README.md"), "utf8")).toBe(readFileSync(join(import.meta.dirname, "..", "README.md"), "utf8"));
  expect(readFileSync(join(out, "LICENSE"), "utf8")).toBe(readFileSync(join(import.meta.dirname, "..", "LICENSE"), "utf8"));
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
