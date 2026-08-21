#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const PRODUCT_NAME = "@useagentsio/vibekit";

export function packageManifests() {
  const file = path.join(root, "packages", "cli", "package.json");
  if (!fs.existsSync(file)) throw new Error(`Product manifest is missing at ${file}`);
  const packageJson = readJson(file);
  if (packageJson.name !== PRODUCT_NAME) {
    throw new Error(`Expected product manifest ${PRODUCT_NAME}, found ${packageJson.name}`);
  }
  return [{ file, package: packageJson }];
}

export function assertSynchronizedVersions() {
  const rootPackage = readJson(path.join(root, "package.json"));
  assertVersion(rootPackage.version);
  const manifests = packageManifests();
  const mismatches = manifests.filter((entry) => entry.package.version !== rootPackage.version);
  if (mismatches.length > 0) {
    throw new Error(`Product and workspace versions must match ${rootPackage.version}:\n${mismatches.map((entry) => `  ${entry.package.name}: ${entry.package.version}`).join("\n")}`);
  }
  return { version: rootPackage.version, manifests };
}

export function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

function setVersions(version) {
  assertVersion(version);
  const rootFile = path.join(root, "package.json");
  const productEntry = packageManifests()[0];
  for (const entry of [{ file: rootFile, package: readJson(rootFile) }, productEntry]) {
    fs.writeFileSync(entry.file, `${JSON.stringify({ ...entry.package, version }, null, 2)}\n`, "utf8");
  }
  console.log(`Set the workspace and single product artifact to ${version}.`);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function parseVersion(version) {
  assertVersion(version);
  return version.split(".").map(Number);
}

function assertVersion(version) {
  if (typeof version !== "string" || !VERSION_PATTERN.test(version)) {
    throw new Error(`Expected a stable semantic version such as 1.2.0, received: ${version ?? "(missing)"}`);
  }
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  const requested = process.argv[2];
  if (requested !== undefined && requested !== "--check") setVersions(requested);
  const result = assertSynchronizedVersions();
  console.log(`The single product artifact ${PRODUCT_NAME}@${result.version} is synchronized.`);
}
