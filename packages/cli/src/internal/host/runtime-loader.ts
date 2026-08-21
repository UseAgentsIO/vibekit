import {
  getInstalledModule,
  parseModuleId,
  readInstalledManifest,
  resolveInstalledModule,
  type InstalledModuleDocument,
  type ModuleId,
  type ModuleRuntime,
  type RuntimeKind,
} from "../core/index.js";

import { hostError } from "./errors.js";
import { exportedValue, importProjectModule } from "./project-import.js";

export interface ExecutableRuntime {
  readonly record: InstalledModuleDocument;
  readonly runtime: ModuleRuntime;
  readonly package: string;
  readonly export: string;
}

/**
 * Runtime metadata comes from the installed record's registrySource + version.
 * Binders must not consult the official catalog by module ID.
 */
export function readInstalledRecord(
  projectRoot: string,
  id: string,
): InstalledModuleDocument {
  parseModuleId(id);
  const manifest = readInstalledManifest(projectRoot);
  const record = getInstalledModule(manifest, id as ModuleId);
  if (record === undefined) {
    throw hostError(
      "unavailable",
      "module_not_installed",
      `${id} is not installed in this Project`,
      { id, projectRoot },
    );
  }
  return record;
}

export function resolveExecutableRuntime(
  record: InstalledModuleDocument,
  options: {
    readonly expectedType: "tool" | "interface" | "state";
    readonly executableKinds: readonly RuntimeKind[];
  },
): ExecutableRuntime | undefined {
  const parsed = parseModuleId(record.id);
  if (parsed.type !== options.expectedType) {
    throw hostError(
      "configuration_invalid",
      "module_type_mismatch",
      `${record.id} is type ${parsed.type}, expected ${options.expectedType}`,
      { id: record.id, expectedType: options.expectedType, actualType: parsed.type },
    );
  }

  const loaded = resolveInstalledModule(record);
  if (loaded.document.type === "agent" || loaded.document.type !== options.expectedType) {
    throw hostError(
      "configuration_invalid",
      "module_type_mismatch",
      `${record.id}@${record.version} from ${record.registrySource} is type ${loaded.document.type}, expected ${options.expectedType}`,
      {
        id: record.id,
        version: record.version,
        registrySource: record.registrySource,
        expectedType: options.expectedType,
        actualType: loaded.document.type,
      },
    );
  }

  const runtime = loaded.document.runtime;
  if (runtime === undefined || runtime.available === false || runtime.kind === "config-only") {
    return undefined;
  }
  if (runtime.kind === "pi-builtin") {
    return undefined;
  }
  if (!options.executableKinds.includes(runtime.kind)) {
    throw hostError(
      "unavailable",
      "runtime_kind_unsupported",
      `${record.id} runtime kind ${runtime.kind} is not executable as ${options.expectedType}`,
      { id: record.id, kind: runtime.kind, expectedKinds: options.executableKinds },
    );
  }
  if (
    runtime.package === undefined ||
    runtime.package.length === 0 ||
    runtime.export === undefined ||
    runtime.export.length === 0
  ) {
    throw hostError(
      "unavailable",
      "runtime_package_missing",
      `${record.id} is executable but missing runtime.package/export`,
      { id: record.id, kind: runtime.kind, registrySource: record.registrySource },
    );
  }

  return {
    record,
    runtime,
    package: runtime.package,
    export: runtime.export,
  };
}

export async function importRuntimeExport(
  projectRoot: string,
  packageName: string,
  exportName: string,
): Promise<unknown> {
  const mod = await importProjectModule(projectRoot, packageName);
  const exported = exportedValue(mod, exportName);
  if (exported === undefined) {
    throw hostError(
      "unavailable",
      "runtime_export_missing",
      `Package ${packageName} does not export ${exportName}`,
      { packageName, exportName, projectRoot },
    );
  }
  return exported;
}
