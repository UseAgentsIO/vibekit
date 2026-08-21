#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = process.argv[2];

function copyDir(from, to) {
  fs.rmSync(to, { recursive: true, force: true });
  fs.cpSync(from, to, { recursive: true });
}

if (target === "core") {
  copyDir(path.join(root, "schemas"), path.join(root, "packages/cli/schemas"));
  process.exit(0);
}

if (target === "cli") {
  copyDir(path.join(root, "registry"), path.join(root, "packages/cli/registry"));
  process.exit(0);
}

if (target === "all") {
  copyDir(path.join(root, "schemas"), path.join(root, "packages/cli/schemas"));
  copyDir(path.join(root, "registry"), path.join(root, "packages/cli/registry"));
  process.exit(0);
}

console.error("Usage: prepare-publish.mjs <core|cli|all>");
process.exit(1);
