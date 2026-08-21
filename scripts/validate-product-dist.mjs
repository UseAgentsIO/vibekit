#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distRoot = path.join(root, "packages", "cli", "dist");
const sourcePackagePattern = /(?:from|import\s*\(|require\s*\()\s*["']@useagentsio\/(?:cli|core|host|pi|interface-[^"'\/\s]+|schedule-core|state-memory|tool-[^"'\/\s]+|verifier-schema)(?:["'\/\s]|$)/;
const generatedFilePattern = /(?:^|\/)published-deps\.(?:cjs|d\.ts|js|mjs|map)$/;

function listFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFiles(absolute));
    } else if (/\.(?:cjs|d\.ts|js|mjs|map)$/.test(entry.name)) {
      files.push(absolute);
    }
  }
  return files;
}

if (!fs.existsSync(distRoot)) {
  throw new Error(
    `Product build output is missing at ${distRoot}. Repair: run pnpm typecheck before packing or publishing.`,
  );
}

const stale = [];
for (const file of listFiles(distRoot)) {
  const relative = path.relative(distRoot, file).split(path.sep).join("/");
  if (generatedFilePattern.test(relative)) {
    stale.push(`${relative} (obsolete generated module)`);
    continue;
  }
  const text = fs.readFileSync(file, "utf8");
  if (sourcePackagePattern.test(text)) {
    stale.push(`${relative} (imports a deleted first-party package)`);
  }
}

if (stale.length > 0) {
  throw new Error(
    `Product build output contains obsolete first-party artifacts:\n${stale.map((file) => `  ${file}`).join("\n")}\n` +
      "Repair: run pnpm exec tsc -b packages/cli --clean && pnpm typecheck, then retry.",
  );
}

console.log(`Product build output is clean: ${distRoot}`);
