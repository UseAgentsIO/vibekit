import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { VibeKitError } from "@useagentsio/core";

const require = createRequire(import.meta.url);
const packagesRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export function publishedRange(packageName: string): string {
  return `^${packageVersion(packageName)}`;
}

export function packageVersion(packageName: string): string {
  try {
    const pkg = require(`${packageName}/package.json`) as { version?: string };
    if (typeof pkg.version === "string" && pkg.version.length > 0) {
      return pkg.version;
    }
  } catch {
    // Fall through to the monorepo sibling package.json.
  }
  const sibling = path.join(packagesRoot, packageName.replace("@useagentsio/", ""), "package.json");
  if (fs.existsSync(sibling)) {
    const pkg = JSON.parse(fs.readFileSync(sibling, "utf8")) as { version?: string };
    if (typeof pkg.version === "string" && pkg.version.length > 0) {
      return pkg.version;
    }
  }
  throw new VibeKitError({
    category: "unavailable",
    code: "package_version_unresolved",
    message: `Could not resolve a published version for ${packageName}`,
    details: { packageName },
  });
}
