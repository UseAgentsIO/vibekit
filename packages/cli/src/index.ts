#!/usr/bin/env node

import path from "node:path";
import { pathToFileURL } from "node:url";

import { runCli } from "./cli.js";

export { runCli } from "./cli.js";
export type { CliResult } from "./cli.js";

const invoked =
  process.argv[1] !== undefined &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (invoked) {
  const result = runCli(process.argv.slice(2));
  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }
  process.exitCode = result.exitCode;
}
