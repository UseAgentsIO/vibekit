#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const PACKAGES = [
  "@useagentsio/core",
  "@useagentsio/interface-sdk",
  "@useagentsio/pi",
  "@useagentsio/interface-terminal",
  "@useagentsio/interface-http",
  "@useagentsio/interface-webhook",
  "@useagentsio/schedule-core",
  "@useagentsio/interface-schedule",
  "@useagentsio/tool-scheduler",
  "@useagentsio/interface-slack",
  "@useagentsio/interface-telegram",
  "@useagentsio/state-memory",
  "@useagentsio/tool-web",
  "@useagentsio/tool-browser",
  "@useagentsio/tool-github",
  "@useagentsio/tool-mcp",
  "@useagentsio/tool-process",
  "@useagentsio/verifier-schema",
  "@useagentsio/host",
  "@useagentsio/cli",
];

function run(command, args, { capture = false } = {}) {
  return spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
}

function whoami() {
  const result = run("npm", ["whoami"], { capture: true });
  if (result.status === 0) {
    const user = (result.stdout ?? "").trim();
    return user || null;
  }
  return null;
}

function ensureLoggedIn() {
  let user = whoami();
  if (user) {
    console.log(`npm session: ${user}`);
    return user;
  }

  console.log("No valid npm session. Opening npm login (account sign-in only)…");
  console.log("Use the useagentsio account (or another member with publish rights on @useagentsio).");
  if (!process.stdin.isTTY) {
    console.error("npm login needs an interactive terminal. Re-run `pnpm publish:packages` from your shell.");
    process.exit(1);
  }
  const login = run("npm", ["login"]);
  if (login.error) {
    console.error(`Failed to run npm login: ${login.error.message}`);
    process.exit(1);
  }
  if (login.status !== 0) {
    console.error("npm login did not complete. Publish aborted.");
    process.exit(login.status ?? 1);
  }

  user = whoami();
  if (!user) {
    console.error("Still not logged in after npm login. Publish aborted.");
    process.exit(1);
  }
  console.log(`npm session: ${user}`);
  return user;
}

function localVersions() {
  const byName = new Map();
  const packagesDir = path.join(root, "packages");
  for (const entry of fs.readdirSync(packagesDir)) {
    const pkgPath = path.join(packagesDir, entry, "package.json");
    if (!fs.existsSync(pkgPath)) continue;
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    if (pkg.name && pkg.version) {
      byName.set(pkg.name, pkg.version);
    }
  }
  return byName;
}

function remoteVersion(name) {
  const result = run("npm", ["view", name, "version"], { capture: true });
  if (result.status !== 0) return null;
  const version = (result.stdout ?? "").trim();
  return version || null;
}

function pendingPublishes() {
  const local = localVersions();
  const pending = [];
  for (const name of PACKAGES) {
    const version = local.get(name);
    if (!version) {
      console.error(`No local package.json for ${name}.`);
      process.exit(1);
    }
    const remote = remoteVersion(name);
    if (remote === version) {
      console.log(`skip ${name}@${version} (already on npm)`);
      continue;
    }
    pending.push({ name, version, remote });
  }
  return pending;
}

ensureLoggedIn();

const pending = pendingPublishes();
if (pending.length === 0) {
  console.log("\nNothing to publish.");
  process.exit(0);
}

console.log(`\n${pending.length} package(s) to upload.`);
console.log(
  "npm may open the browser once more to approve the first upload (2FA for publish).",
);
console.log("That is not a second login. After you approve, the rest of this run continues.");

for (const { name, version } of pending) {
  console.log(`\nPublishing ${name}@${version}…`);
  const result = run("pnpm", [
    "--filter",
    name,
    "publish",
    "--access",
    "public",
    "--no-git-checks",
  ]);
  if (result.error) {
    console.error(`Failed to run pnpm publish for ${name}: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`Publish stopped at ${name}. Already-published versions are live; re-run after fixing.`);
    process.exit(result.status ?? 1);
  }
}

console.log("\nAll packages published or already up to date.");
