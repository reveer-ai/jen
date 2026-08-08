#!/usr/bin/env node
import { readFileSync } from 'node:fs';

import { STAGE_SKILLS } from './payload.js';

const USAGE = `jen — the workflow layer for automated, agentic software development

Usage:
  jen <command>

Commands:
  init      scaffold the workflow into a project        (not implemented yet)
  update    reconcile a project with this version       (not implemented yet)

Options:
  -h, --help       show this message
  -v, --version    show the installed version

This release ships the payload declaration — ${STAGE_SKILLS.length} stage skills and the workflow
document — and the entry point. The commands that write them into a project land next.`;

function version(): string {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
    version: string;
  };
  return manifest.version;
}

function main(argv: string[]): number {
  const [command] = argv;

  switch (command) {
    case undefined:
    case 'help':
    case '--help':
    case '-h':
      console.log(USAGE);
      return 0;

    case '--version':
    case '-v':
      console.log(version());
      return 0;

    case 'init':
    case 'update':
      console.error(`jen ${command} is not implemented yet.`);
      return 1;

    default:
      console.error(`Unknown command: ${command}\n`);
      console.error(USAGE);
      return 1;
  }
}

process.exitCode = main(process.argv.slice(2));
