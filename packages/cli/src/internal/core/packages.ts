import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { intersects, subset, validRange } from "semver";

import { VibeKitError } from "./errors.js";
import type { LoadedModule } from "./module.js";
import { isProductRuntimePackage } from "../runtime-identifiers.js";

export interface PackageApplyResult {
  readonly created: readonly string[];
  readonly changed: readonly string[];
}

export interface PackageApplyTracker {
  readonly created: string[];
  readonly changed: string[];
  readonly backups: Map<string, Buffer>;
}

export function collectPackageDependencies(
  modules: readonly LoadedModule[],
): Record<string, string> {
  const collected: Record<string, string> = {};
  for (const module of modules) {
    const productOwned = Object.fromEntries(
      Object.entries(module.packages?.dependencies ?? {})
        .filter(([name]) => !isProductRuntimePackage(name)),
    );
    mergePackageDependencies(collected, productOwned, module.id);
  }
  return collected;
}

export function mergePackageDependencies(
  target: Record<string, string>,
  incoming: Readonly<Record<string, string>>,
  sourceId?: string,
): Record<string, string> {
  for (const [name, version] of Object.entries(incoming)) {
    const existing = target[name];
    const compatible = existing === undefined ? version : compatibleRange(existing, version);
    if (compatible === undefined) {
      throw new VibeKitError({
        category: "conflict",
        code: "package_dependency_conflict",
        message: `Conflicting package dependency ${name}: ${existing} vs ${version}`,
        details: { name, existing, requested: version, sourceId },
      });
    }
    target[name] = compatible;
  }
  return target;
}

export function packagesToRemove(
  previous: Readonly<Record<string, string>>,
  next: Readonly<Record<string, string>>,
): string[] {
  return Object.keys(previous)
    .filter((name) => next[name] === undefined)
    .sort((left, right) => left.localeCompare(right));
}

export function packageManagerInstallArgs(packageManager: "npm" | "pnpm"): string[] {
  return ["install", "--ignore-scripts"];
}

export function applyPackageState(options: {
  readonly projectRoot: string;
  readonly dependencies: Readonly<Record<string, string>>;
  readonly remove?: readonly string[];
  readonly tracker: PackageApplyTracker;
}): PackageApplyResult {
  const createdStart = options.tracker.created.length;
  const changedStart = options.tracker.changed.length;
  const remove = options.remove ?? [];
  if (Object.keys(options.dependencies).length === 0 && remove.length === 0) {
    return { created: [], changed: [] };
  }

  snapshotFile(options.projectRoot, "package.json", options.tracker);
  snapshotFile(options.projectRoot, "pnpm-lock.yaml", options.tracker);
  snapshotFile(options.projectRoot, "package-lock.json", options.tracker);
  snapshotFile(options.projectRoot, "yarn.lock", options.tracker);
  const nodeModulesSnapshot = snapshotNodeModules(options.projectRoot, options.tracker);

  try {
    const packagePath = path.join(options.projectRoot, "package.json");
    let body: { dependencies?: Record<string, string>; [key: string]: unknown };
    if (fs.existsSync(packagePath)) {
      body = JSON.parse(fs.readFileSync(packagePath, "utf8")) as {
        dependencies?: Record<string, string>;
        [key: string]: unknown;
      };
      if (!options.tracker.changed.includes("package.json") && !options.tracker.created.includes("package.json")) {
        options.tracker.changed.push("package.json");
      }
    } else {
      body = {
        name: path.basename(options.projectRoot),
        private: true,
        type: "module",
        dependencies: {},
      };
      options.tracker.created.push("package.json");
    }

    const dependencies = { ...body.dependencies };
    for (const name of remove) {
      delete dependencies[name];
    }
    for (const [name, version] of Object.entries(options.dependencies)) {
      const existing = dependencies[name];
      if (existing !== undefined && compatibleRange(existing, version) === undefined) {
        throw new VibeKitError({
          category: "conflict",
          code: "package_dependency_conflict",
          message: `package.json already declares ${name}@${existing}; Module requires ${version}`,
          details: { name, existing, requested: version },
        });
      }
      dependencies[name] = existing ?? version;
    }
    body.dependencies = dependencies;
    fs.writeFileSync(packagePath, `${JSON.stringify(body, null, 2)}\n`);

    for (const [name, spec] of Object.entries(options.dependencies)) {
      if (!spec.startsWith("file:")) {
        continue;
      }
      const source = path.resolve(options.projectRoot, spec.slice("file:".length));
      if (!fs.existsSync(source)) {
        throw new VibeKitError({
          category: "unavailable",
          code: "package_dependency_missing",
          message: `Declared package dependency ${name} was not found at ${source}`,
          details: { name, spec, source },
        });
      }
      const dest = path.join(options.projectRoot, "node_modules", name);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.cpSync(source, dest, { recursive: true });
      const relative = path.relative(options.projectRoot, dest).split(path.sep).join("/");
      if (!options.tracker.created.includes(relative)) {
        options.tracker.created.push(relative);
      }
    }

    const remote = Object.values(options.dependencies).some(
      (spec) => !spec.startsWith("file:") && !spec.startsWith("workspace:"),
    );
    if (remote && shouldRunPackageInstall()) {
      const pm = fs.existsSync(path.join(options.projectRoot, "pnpm-lock.yaml")) ? "pnpm" : "npm";
      const result = spawnSync(pm, packageManagerInstallArgs(pm), {
        cwd: options.projectRoot,
        encoding: "utf8",
        timeout: 120000,
      });
      if (result.status !== 0) {
        throw new VibeKitError({
          category: "external_error",
          code: "package_install_failed",
          message: `Failed to install Module package dependencies with ${pm}`,
          details: { packageManager: pm, stderr: result.stderr, args: packageManagerInstallArgs(pm) },
        });
      }
      const lockfile = pm === "pnpm" ? "pnpm-lock.yaml" : "package-lock.json";
      if (!options.tracker.changed.includes(lockfile) && !options.tracker.created.includes(lockfile)) {
        if (fs.existsSync(path.join(options.projectRoot, lockfile))) {
          if (options.tracker.backups.has(lockfile)) {
            options.tracker.changed.push(lockfile);
          } else {
            options.tracker.created.push(lockfile);
          }
        }
      }
      if (
        fs.existsSync(path.join(options.projectRoot, "node_modules")) &&
        !options.tracker.created.includes("node_modules") &&
        !options.tracker.changed.includes("node_modules")
      ) {
        options.tracker.changed.push("node_modules");
      }
    }
    nodeModulesSnapshot.commit();
  } catch (error) {
    nodeModulesSnapshot.restore();
    throw error;
  }

  return {
    created: options.tracker.created.slice(createdStart),
    changed: options.tracker.changed.slice(changedStart),
  };
}

function shouldRunPackageInstall(): boolean {
  if (process.env.VIBEKIT_SKIP_PACKAGE_INSTALL === "1") {
    return false;
  }
  if (process.env.VIBEKIT_FORCE_PACKAGE_INSTALL === "1") {
    return true;
  }
  return process.env.VITEST !== "true";
}

function compatibleRange(existing: string, requested: string): string | undefined {
  if (existing === requested) return existing;
  if (existing.startsWith("workspace:")) return existing;
  if (requested.startsWith("workspace:")) return requested;
  if (validRange(existing) === null || validRange(requested) === null || !intersects(existing, requested)) {
    return undefined;
  }
  if (subset(existing, requested)) return existing;
  if (subset(requested, existing)) return requested;
  return `${existing} ${requested}`;
}

function snapshotFile(projectRoot: string, relative: string, tracker: PackageApplyTracker): void {
  const abs = path.join(projectRoot, relative);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
    return;
  }
  if (!tracker.backups.has(relative)) {
    tracker.backups.set(relative, fs.readFileSync(abs));
  }
}

function snapshotNodeModules(
  projectRoot: string,
  tracker: PackageApplyTracker,
): { restore: () => void; commit: () => void } {
  const nm = path.join(projectRoot, "node_modules");
  if (!fs.existsSync(nm)) {
    if (!tracker.created.includes("node_modules")) {
      tracker.created.push("node_modules");
    }
    return {
      restore: () => {
        fs.rmSync(nm, { recursive: true, force: true });
      },
      commit: () => undefined,
    };
  }
  const backupRoot = fs.mkdtempSync(path.join(projectRoot, ".vibekit-node-modules-backup-"));
  const backup = path.join(backupRoot, "node_modules");
  fs.cpSync(nm, backup, { recursive: true });
  return {
    restore: () => {
      fs.rmSync(nm, { recursive: true, force: true });
      fs.cpSync(backup, nm, { recursive: true });
      fs.rmSync(backupRoot, { recursive: true, force: true });
    },
    commit: () => {
      fs.rmSync(backupRoot, { recursive: true, force: true });
    },
  };
}
