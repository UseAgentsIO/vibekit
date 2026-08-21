#!/usr/bin/env node

import { spawnSync } from "node:child_process";

const replacement = "@useagentsio/vibekit";
const confirmationFlag = "--confirm-owner-approved-cleanup";
const writeFlag = "--apply";
const legacyPackages = [
  "@useagentsio/cli",
  "@useagentsio/core",
  "@useagentsio/host",
  "@useagentsio/interface-http",
  "@useagentsio/interface-schedule",
  "@useagentsio/interface-sdk",
  "@useagentsio/interface-slack",
  "@useagentsio/interface-telegram",
  "@useagentsio/interface-terminal",
  "@useagentsio/interface-webhook",
  "@useagentsio/pi",
  "@useagentsio/schedule-core",
  "@useagentsio/state-memory",
  "@useagentsio/tool-browser",
  "@useagentsio/tool-github",
  "@useagentsio/tool-mcp",
  "@useagentsio/tool-process",
  "@useagentsio/tool-scheduler",
  "@useagentsio/tool-web",
  "@useagentsio/verifier-schema",
];

const writeRequested = process.argv.includes(writeFlag);
if (writeRequested && !process.argv.includes(confirmationFlag)) {
  throw new Error(`Refusing npm writes. Re-run only after owner approval with ${writeFlag} ${confirmationFlag}.`);
}

function npm(args) {
  return spawnSync("npm", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 4 * 1024 * 1024,
  });
}

function versionsFor(name) {
  const result = npm(["view", name, "versions", "--json"]);
  if (result.status !== 0) return [];
  try {
    const parsed = JSON.parse((result.stdout ?? "").trim());
    if (Array.isArray(parsed)) return parsed.filter((version) => typeof version === "string");
    if (typeof parsed === "string" && parsed.length > 0) return [parsed];
  } catch {
    // Treat an empty or malformed npm response as unpublished. npm stderr is
    // intentionally discarded so credentials and registry diagnostics cannot
    // leak into this report.
  }
  return [];
}

function runWrite(args) {
  const result = npm(args);
  if (result.status === 0) return true;
  return false;
}

const inventory = legacyPackages.map((name) => ({ name, versions: versionsFor(name) }));
console.log(`Read-only legacy npm inventory for ${replacement} migration`);
for (const entry of inventory) {
  console.log(`${entry.name}\t${entry.versions.length > 0 ? entry.versions.join(",") : "unpublished"}`);
}

const published = inventory.flatMap(({ name, versions }) => versions.map((version) => ({ name, version })));
if (!writeRequested) {
  console.log("\nNo npm writes were requested. The following sequence is prepared but was not executed:");
  console.log("1. Authenticate separately and obtain explicit owner approval for this exact inventory.");
  console.log("2. Attempt `npm unpublish <package>@<version>` for every listed legacy version, one version at a time.");
  console.log(`3. If npm refuses an unpublish, run: npm deprecate <package>@<version> "Moved to ${replacement}; use the single product package." for that exact version.`);
  console.log(`4. Re-run this script without ${writeFlag} and verify every legacy package/version is either unpublished or deprecated before any product publish.`);
  process.exit(0);
}

if (published.length === 0) {
  console.log("No published legacy versions remain; no npm writes were attempted.");
  process.exit(0);
}

const message = `Moved to ${replacement}; use the single product package.`;
for (const { name, version } of published) {
  const spec = `${name}@${version}`;
  if (runWrite(["unpublish", spec])) {
    console.log(`Unpublished ${spec}`);
    continue;
  }
  if (!runWrite(["deprecate", spec, message])) {
    throw new Error(`Could not unpublish or deprecate ${spec}; stop and review npm state before continuing.`);
  }
  console.log(`Deprecated ${spec}: ${message}`);
}
