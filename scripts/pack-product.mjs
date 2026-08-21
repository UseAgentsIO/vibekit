#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const productRoot = path.join(root, "packages", "cli");
const outputFlag = process.argv.indexOf("--output");
const output = outputFlag === -1
  ? fs.mkdtempSync(path.join(os.tmpdir(), "vibekit-release-"))
  : path.resolve(process.argv[outputFlag + 1] ?? "");

if (!output) throw new Error("Usage: node scripts/pack-product.mjs [--output <directory>]");
fs.mkdirSync(output, { recursive: true });

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    encoding: "utf8",
    stdio: options.capture === true ? ["ignore", "pipe", "pipe"] : "inherit",
    maxBuffer: 128 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit ${result.status}\n${result.stdout ?? ""}${result.stderr ?? ""}`);
  }
  return result;
}

function copyIfPresent(source, target) {
  if (fs.existsSync(source)) fs.cpSync(source, target, { recursive: true });
}

function stageProduct() {
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), "vibekit-product-"));
  copyIfPresent(path.join(productRoot, "dist"), path.join(staging, "dist"));
  copyIfPresent(path.join(productRoot, "registry"), path.join(staging, "registry"));
  copyIfPresent(path.join(productRoot, "schemas"), path.join(staging, "schemas"));
  copyIfPresent(path.join(productRoot, "README.md"), path.join(staging, "README.md"));

  const manifest = JSON.parse(fs.readFileSync(path.join(productRoot, "package.json"), "utf8"));
  if (manifest.name !== "@useagentsio/vibekit") {
    throw new Error(`Expected the single product package to be @useagentsio/vibekit, found ${manifest.name}`);
  }
  if (typeof manifest.version !== "string" || manifest.version.length === 0) {
    throw new Error("The product package is missing a version");
  }
  manifest.private = false;
  manifest.scripts = {};
  manifest.bundledDependencies = [
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}),
  ].sort();
  fs.writeFileSync(path.join(staging, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  // Materialize only third-party dependencies. First-party runtime code is
  // already under dist/internal and must never become a second package tree.
  run("npm", ["install", "--ignore-scripts", "--no-save", "--package-lock=false"], { cwd: staging });
  fs.rmSync(path.join(staging, "package-lock.json"), { force: true });
  return staging;
}

let staging;
try {
  run("node", ["scripts/prepare-publish.mjs", "cli"]);
  run("pnpm", ["typecheck"]);
  run("node", ["scripts/validate-product-dist.mjs"]);
  staging = stageProduct();
  const packed = run("npm", ["pack", "--ignore-scripts", "--pack-destination", output, "--json"], {
    cwd: staging,
    capture: true,
  });
  const metadata = JSON.parse(packed.stdout)[0];
  const tarball = path.join(output, metadata.filename);
  const forbiddenFirstParty = (metadata.files ?? [])
    .map((entry) => entry.path)
    .filter((entry) => entry.startsWith("node_modules/@useagentsio/"));
  if (forbiddenFirstParty.length > 0) {
    throw new Error(`Packed product contains obsolete first-party package paths: ${forbiddenFirstParty.join(", ")}`);
  }
  console.log(`Packed ${metadata.id} at ${tarball}`);
} finally {
  if (staging !== undefined && !process.argv.includes("--keep")) {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}
