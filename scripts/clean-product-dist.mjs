#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distRoot = path.join(root, "packages", "cli", "dist");

// packages/cli/dist is generated output only. Removing the complete product
// output before a build also removes files left behind when a source module is
// deleted, which TypeScript's incremental cleaner cannot discover.
fs.rmSync(distRoot, { recursive: true, force: true });
console.log(`Cleaned product build output: ${distRoot}`);
