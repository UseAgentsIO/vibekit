import fs from "node:fs";
import path from "node:path";

import { sha256File } from "./checksum.js";
import { detectConflicts, detectCycles } from "./graph.js";
import type { ModuleId } from "./ids.js";
import { readInstalledManifest } from "./installed.js";
import type { LoadedModule } from "./module.js";
import { collectInstalledOwnership } from "./ownership.js";
import { safeResolve } from "./paths.js";
import { readProjectDocument } from "./project.js";
import { loadRegistry, resolveModule, type Registry } from "./registry.js";
import type { InstalledManifestDocument, ProjectDocument } from "./types.js";
import { validateFileTarget } from "./file-targets.js";
import { validateDocument } from "./validate.js";

export type DoctorSeverity = "error" | "warning";

export interface DoctorFinding {
  readonly severity: DoctorSeverity;
  readonly code: string;
  readonly message: string;
  readonly path?: string;
}

export interface DoctorReport {
  readonly findings: readonly DoctorFinding[];
  readonly errorCount: number;
  readonly warningCount: number;
}

export function runDoctor(options: {
  readonly projectRoot: string;
  readonly registry?: Registry;
}): DoctorReport {
  const findings: DoctorFinding[] = [];
  let project: ProjectDocument | undefined;
  let manifest: InstalledManifestDocument | undefined;

  try {
    project = readProjectDocument(options.projectRoot);
    const validated = validateDocument("project", project);
    if (!validated.valid) {
      for (const error of validated.errors) {
        findings.push({
          severity: "error",
          code: "project_schema",
          message: error.message,
          path: error.path,
        });
      }
    }
  } catch (error) {
    findings.push(toFinding(error, "project_schema"));
  }

  try {
    manifest = readInstalledManifest(options.projectRoot);
    const validated = validateDocument("installed", manifest);
    if (!validated.valid) {
      for (const error of validated.errors) {
        findings.push({
          severity: "error",
          code: "installed_schema",
          message: error.message,
          path: error.path,
        });
      }
    }
  } catch (error) {
    findings.push(toFinding(error, "installed_schema"));
  }

  if (project && project.schemaVersion !== 1) {
    findings.push({
      severity: "error",
      code: "schema_version",
      message: `Unsupported project schemaVersion ${project.schemaVersion}`,
    });
  }
  if (manifest && manifest.schemaVersion !== 1) {
    findings.push({
      severity: "error",
      code: "schema_version",
      message: `Unsupported installed schemaVersion ${manifest.schemaVersion}`,
    });
  }

  if (manifest) {
    checkOwnership(manifest, findings);
    checkInstalledFiles(options.projectRoot, manifest, findings);
    checkInstalledIntegrity(options.projectRoot, manifest, findings);
  }

  if (manifest && project) {
    const registry = options.registry ?? tryLoadRegistry();
    if (registry) {
      checkDependencies(manifest, registry, findings);
    } else {
      findings.push({
        severity: "warning",
        code: "registry_unavailable",
        message: "Registry not available; skipped module dependency checks",
      });
    }
  }

  return {
    findings,
    errorCount: findings.filter((finding) => finding.severity === "error").length,
    warningCount: findings.filter((finding) => finding.severity === "warning").length,
  };
}

function checkOwnership(
  manifest: InstalledManifestDocument,
  findings: DoctorFinding[],
): void {
  const seen = new Map<string, ModuleId>();
  for (const module of manifest.modules) {
    for (const file of module.files) {
      const target = validateFileTarget(file.path);
      if (!target.valid) {
        findings.push({
          severity: "error",
          code: "file_target_invalid",
          message: target.errors[0]?.message ?? "Invalid file target",
          path: file.path,
        });
      }
      if (file.ownership !== "exclusive") {
        continue;
      }
      const owner = seen.get(file.path);
      if (owner && owner !== module.id) {
        findings.push({
          severity: "error",
          code: "duplicate_exclusive_ownership",
          message: `${file.path} is owned by both ${owner} and ${module.id}`,
          path: file.path,
        });
      } else {
        seen.set(file.path, module.id);
      }
    }
  }
  collectInstalledOwnership(manifest);
}

function checkInstalledFiles(
  projectRoot: string,
  manifest: InstalledManifestDocument,
  findings: DoctorFinding[],
): void {
  const ids = new Set<string>();
  for (const module of manifest.modules) {
    if (ids.has(module.id)) {
      findings.push({
        severity: "error",
        code: "duplicate_module_id",
        message: `Duplicate installed Module ${module.id}`,
      });
    }
    ids.add(module.id);
    if (module.schemaVersion !== 1) {
      findings.push({
        severity: "error",
        code: "schema_version",
        message: `Unsupported schemaVersion on ${module.id}`,
      });
    }
    for (const file of module.files) {
      try {
        const abs = safeResolve(projectRoot, file.path);
        if (!fs.existsSync(abs)) {
          findings.push({
            severity: "error",
            code: "installed_file_missing",
            message: `Installed file ${file.path} for ${module.id} is missing`,
            path: file.path,
          });
        }
      } catch (error) {
        findings.push(toFinding(error, "file_target_invalid"));
      }
    }
  }
}

function checkInstalledIntegrity(
  projectRoot: string,
  manifest: InstalledManifestDocument,
  findings: DoctorFinding[],
): void {
  for (const module of manifest.modules) {
    for (const file of module.files) {
      const abs = path.join(projectRoot, file.path);
      if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
        continue;
      }
      const actual = sha256File(abs);
      if (actual !== file.hash) {
        findings.push({
          severity: "warning",
          code: "installed_hash_mismatch",
          message: `File ${file.path} does not match the recorded hash for ${module.id}`,
          path: file.path,
        });
      }
    }
  }
}

function checkDependencies(
  manifest: InstalledManifestDocument,
  registry: Registry,
  findings: DoctorFinding[],
): void {
  const installed = new Set(manifest.modules.map((module) => module.id));
  const loaded: LoadedModule[] = [];
  const edges = new Map<ModuleId, ModuleId[]>();

  for (const record of manifest.modules) {
    let module: LoadedModule;
    try {
      module = resolveModule(registry, record.id, record.version);
    } catch {
      findings.push({
        severity: "warning",
        code: "module_unavailable",
        message: `Installed module ${record.id}@${record.version} is not in the registry`,
      });
      continue;
    }
    loaded.push(module);
    edges.set(module.id, [...module.requiredDependencies]);
    for (const dep of module.requiredDependencies) {
      if (!installed.has(dep)) {
        findings.push({
          severity: "error",
          code: "required_dependency_missing",
          message: `${module.id} requires ${dep}, which is not installed`,
        });
      }
    }
  }

  const cycles = detectCycles(edges);
  for (const cycle of cycles) {
    findings.push({
      severity: "error",
      code: "dependency_cycle",
      message: `Dependency cycle: ${cycle.join(" -> ")}`,
    });
  }

  for (const conflict of detectConflicts(loaded)) {
    if (installed.has(conflict.left) && installed.has(conflict.right)) {
      findings.push({
        severity: "error",
        code: "module_conflict",
        message: `${conflict.left} conflicts with ${conflict.right}`,
      });
    }
  }
}

function tryLoadRegistry(): Registry | undefined {
  try {
    return loadRegistry(process.env.VIBEKIT_REGISTRY ?? path.resolve("registry"));
  } catch {
    return undefined;
  }
}

function toFinding(error: unknown, code: string): DoctorFinding {
  if (error instanceof Error) {
    return { severity: "error", code, message: error.message };
  }
  return { severity: "error", code, message: "Unknown doctor error" };
}
