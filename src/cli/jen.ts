#!/usr/bin/env node
// The jen command's entry. It checks Node's version before anything else runs,
// so it uses nothing newer than Node 18 has and imports the command only once
// the check passes: an older Node would otherwise stop at syntax or an API it
// lacks, or, without import.meta.main, exit saying nothing.

const version = process.versions.node;
if (Number(version.split(".")[0]) < 26) {
  process.stderr.write(`jen: jen needs Node 26 or later, and this is Node ${version}. Install it from https://nodejs.org.\n`);
  process.exit(1);
}
const { start } = await import("./main.ts");
await start();
