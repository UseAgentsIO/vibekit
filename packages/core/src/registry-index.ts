import fs from "node:fs";
import path from "node:path";

import { checksumDirectory } from "./checksum.js";
import { containsLikelySecret } from "./errors.js";
import { VibeKitError } from "./errors.js";
import { validateFileTarget } from "./file-targets.js";
import { parseModuleId } from "./ids.js";
import { isAgentDocument } from "./module.js";
import {
  findModuleDirs,
  loadModuleFromDirectory,
  type RegistryIndex,
  type RegistryIndexEntry,
} from "./registry.js";
import { listFilesRecursive } from "./checksum.js";

export interface RegistryIndexBuildResult {
  readonly index: RegistryIndex;
  readonly warnings: readonly string[];
}

export function buildRegistryIndex(registryRoot: string): RegistryIndexBuildResult {
  const root = path.resolve(registryRoot);
  const dirs = findModuleDirs(root);
  const entries: RegistryIndexEntry[] = [];
  const warnings: string[] = [];
  const seen = new Map<string, string>();

  for (const dir of dirs) {
    const module = loadModuleFromDirectory(root, dir);
    parseModuleId(module.id);
    if (module.id !== `${module.type}:${module.name}`) {
      throw new VibeKitError({
        category: "invalid_input",
        code: "module_id_mismatch",
        message: `Module id ${module.id} does not match type:name ${module.type}:${module.name}`,
        details: { dir },
      });
    }
    if (!module.license || module.license.length === 0) {
      throw new VibeKitError({
        category: "invalid_input",
        code: "module_license_missing",
        message: `Module ${module.id} is missing a license`,
        details: { dir },
      });
    }
    if (!module.compatibility) {
      throw new VibeKitError({
        category: "invalid_input",
        code: "module_compatibility_missing",
        message: `Module ${module.id} is missing compatibility`,
        details: { dir },
      });
    }
    if (!module.source) {
      throw new VibeKitError({
        category: "invalid_input",
        code: "module_source_missing",
        message: `Module ${module.id} is missing source`,
        details: { dir },
      });
    }

    for (const file of module.files) {
      rejectUnsafeTarget(file.source, module.id, "source");
      rejectUnsafeTarget(file.target, module.id, "target");
      const sourceAbs = path.join(dir, file.source);
      if (!fs.existsSync(sourceAbs) || !fs.statSync(sourceAbs).isFile()) {
        throw new VibeKitError({
          category: "invalid_input",
          code: "module_payload_missing",
          message: `Module ${module.id} is missing ${file.source}`,
          details: { dir, source: file.source },
        });
      }
    }
    if (module.configuration) {
      rejectUnsafeTarget(module.configuration.target, module.id, "configuration");
      rejectUnsafeTarget(module.configuration.schema, module.id, "schema");
      const schemaAbs = path.join(dir, module.configuration.schema);
      if (!fs.existsSync(schemaAbs)) {
        throw new VibeKitError({
          category: "invalid_input",
          code: "module_config_schema_missing",
          message: `Module ${module.id} is missing ${module.configuration.schema}`,
        });
      }
    }
    if (isAgentDocument(module.document)) {
      rejectUnsafeTarget(module.document.instructions, module.id, "instructions");
    }

    for (const filePath of listFilesRecursive(dir)) {
      const text = fs.readFileSync(filePath, "utf8");
      if (containsLikelySecret(text)) {
        throw new VibeKitError({
          category: "invalid_input",
          code: "registry_secret_detected",
          message: `Likely secret detected in ${path.relative(root, filePath)}`,
          details: { file: path.relative(root, filePath) },
        });
      }
    }

    const key = `${module.id}@${module.version}`;
    const previous = seen.get(key);
    if (previous) {
      throw new VibeKitError({
        category: "conflict",
        code: "duplicate_module_id",
        message: `Duplicate registry module ${key}`,
        details: { first: previous, second: dir },
      });
    }
    seen.set(key, dir);

    const checksum = checksumDirectory(dir);
    const relative = path.relative(root, dir).split(path.sep).join("/");
    entries.push({
      id: module.id,
      version: module.version,
      checksum,
      compatibility: module.compatibility,
      path: relative,
    });
  }

  for (const dir of dirs) {
    const module = loadModuleFromDirectory(root, dir);
    for (const dep of module.requiredDependencies) {
      const present = entries.some((entry) => entry.id === dep);
      if (!present) {
        throw new VibeKitError({
          category: "dependency_missing",
          code: "undeclared_dependency",
          message: `Module ${module.id} requires ${dep}, which is not in the registry`,
        });
      }
    }
  }

  entries.sort((left, right) =>
    left.id === right.id
      ? left.version.localeCompare(right.version)
      : left.id.localeCompare(right.id),
  );

  return {
    index: { schemaVersion: 1, modules: entries },
    warnings,
  };
}

export function writeRegistryIndex(registryRoot: string): RegistryIndexBuildResult {
  const result = buildRegistryIndex(registryRoot);
  const indexPath = path.join(registryRoot, "index.json");
  fs.writeFileSync(indexPath, `${JSON.stringify(result.index, null, 2)}\n`, "utf8");
  return result;
}

function rejectUnsafeTarget(target: string, moduleId: string, field: string): void {
  const result = validateFileTarget(target);
  if (!result.valid) {
    throw new VibeKitError({
      category: "invalid_input",
      code: "file_target_invalid",
      message: `Module ${moduleId} has an unsafe ${field} path: ${target}`,
      details: { target, field, errors: result.errors },
    });
  }
}
