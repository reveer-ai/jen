import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { USAGE } from "./main.ts";

const entry = join(import.meta.dirname, "jen.ts");
// jen.ts run by node, with Node's version reported as version when it's given.
const jen = (args: string[], version?: string) => {
  const preload = version === undefined ? [] : ["--import", `data:text/javascript,Object.defineProperty(process.versions, "node", { value: ${JSON.stringify(version)} })`];
  return spawnSync(process.execPath, [...preload, entry, ...args], { encoding: "utf8" });
};

test("jen.ts runs as jen from node, with no arguments printing the usage and exiting 2", () => {
  expect(readFileSync(entry, "utf8").startsWith("#!/usr/bin/env node\n")).toBe(true);
  const help = jen(["help"]);
  expect([help.status, help.stdout]).toEqual([0, `${USAGE}\n`]);
  const none = jen([]);
  expect([none.status, none.stderr]).toEqual([2, `${USAGE}\n`]);
});

test.each(["22.1.0", "25.9.0", "18.20.4"])("Node %s is refused, saying which Node jen needs and doing nothing else", (version) => {
  const result = jen(["help"], version);
  expect([result.status, result.stdout, result.stderr]).toEqual([1, "", `jen: jen needs Node 26 or later, and this is Node ${version}. Install it from https://nodejs.org.\n`]);
});

test.each(["26.0.0", "27.3.1"])("Node %s runs the command", (version) => {
  const result = jen(["help"], version);
  expect([result.status, result.stdout]).toEqual([0, `${USAGE}\n`]);
});
