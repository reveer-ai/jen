#!/usr/bin/env node
import { run } from './cli.js';

// `run` is synchronous for `init` and `update` and a promise for `run`, so this awaits
// what may already be a number. Nothing here may leave the exit code unset.
process.exitCode = await run(process.argv.slice(2), {
  out: (message) => console.log(message),
  err: (message) => console.error(message),
});
