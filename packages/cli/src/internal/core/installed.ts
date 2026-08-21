import fs from "node:fs";
import path from "node:path";

import { INSTALLED_RELATIVE_PATH } from "./constants.js";
import { VibeKitError } from "./errors.js";
import type { ModuleId } from "./ids.js";
import { safeResolve } from "./paths.js";
import type { InstalledManifestDocument, InstalledModuleDocument } from "./types.js";
import { parseAndValidateJson, validateDocument } from "./validate.js";

export function emptyInstalledManifest(): InstalledManifestDocument {
  return {
    schemaVersion: 1,
    modules: [],
  };
}

export function installedManifestPath(projectRoot: string): string {
  return path.join(projectRoot, INSTALLED_RELATIVE_PATH);
}

export function readInstalledManifest(projectRoot: string): InstalledManifestDocument {
  const filePath = installedManifestPath(projectRoot);
  if (!fs.existsSync(filePath)) {
    throw new VibeKitError({
      category: "invalid_input",
      code: "installed_manifest_missing",
      message: `Installed manifest not found at ${INSTALLED_RELATIVE_PATH}`,
      details: { path: filePath },
    });
  }
  const result = parseAndValidateJson("installed", fs.readFileSync(filePath, "utf8"));
  if (!result.valid || result.data === undefined) {
    throw new VibeKitError({
      category: "invalid_input",
      code: "installed_manifest_invalid",
      message: result.errors[0]?.message ?? "installed.json is invalid",
      details: { errors: result.errors },
    });
  }
  return result.data;
}

export function writeInstalledManifest(
  projectRoot: string,
  manifest: InstalledManifestDocument,
): void {
  const validated = validateDocument("installed", manifest);
  if (!validated.valid || validated.data === undefined) {
    throw new VibeKitError({
      category: "invalid_input",
      code: "installed_manifest_invalid",
      message: validated.errors[0]?.message ?? "installed.json is invalid",
      details: { errors: validated.errors },
    });
  }
  const filePath = installedManifestPath(projectRoot);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(validated.data, null, 2)}\n`, "utf8");
  fs.renameSync(tempPath, filePath);
}

export function upsertInstalledModule(
  manifest: InstalledManifestDocument,
  record: InstalledModuleDocument,
): InstalledManifestDocument {
  const modules = manifest.modules.filter((module) => module.id !== record.id);
  modules.push(record);
  modules.sort((left, right) => left.id.localeCompare(right.id));
  return {
    schemaVersion: 1,
    modules,
  };
}

export function getInstalledModule(
  manifest: InstalledManifestDocument,
  id: ModuleId,
): InstalledModuleDocument | undefined {
  return manifest.modules.find((module) => module.id === id);
}

export function installedModuleIds(manifest: InstalledManifestDocument): Set<ModuleId> {
  return new Set(manifest.modules.map((module) => module.id));
}

export function assertSafeInstalledPaths(
  projectRoot: string,
  manifest: InstalledManifestDocument,
): void {
  for (const module of manifest.modules) {
    for (const file of module.files) {
      safeResolve(projectRoot, file.path);
    }
    for (const configPath of module.configurationPaths) {
      safeResolve(projectRoot, configPath);
    }
  }
}
