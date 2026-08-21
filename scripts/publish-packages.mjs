#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { assertSynchronizedVersions, compareVersions } from "./package-versions.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PRODUCT = "@useagentsio/vibekit";

function run(command, args, { capture = false } = {}) {
  return spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
}

function remoteVersion(name) {
  const result = run("npm", ["view", name, "version"], { capture: true });
  if (result.status !== 0) return null;
  const version = (result.stdout ?? "").trim();
  return version || null;
}

const { version } = assertSynchronizedVersions();
const remote = remoteVersion(PRODUCT);
if (remote !== null && compareVersions(version, remote) <= 0) {
  throw new Error(`${PRODUCT}@${version} is not greater than the npm latest ${remote}; choose a new release version before publishing.`);
}

if (process.argv.includes("--check")) {
  console.log(`${PRODUCT}@${version} is ready for one publish operation (remote latest: ${remote ?? "none"}).`);
  process.exit(0);
}

function whoami() {
  const result = run("npm", ["whoami"], { capture: true });
  return result.status === 0 && (result.stdout ?? "").trim().length > 0;
}

if (!whoami()) {
  throw new Error("No npm session is available. Authenticate separately, then rerun this publish command; no login flow is started automatically.");
}

const result = run("pnpm", ["--filter", PRODUCT, "publish", "--access", "public", "--no-git-checks"]);
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
console.log(`Published one product artifact: ${PRODUCT}@${version}`);
