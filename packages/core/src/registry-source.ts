import { VibeKitError } from "./errors.js";
import { OFFICIAL_REGISTRY_SOURCE } from "./constants.js";
import type { LoadedModule } from "./module.js";
import {
  defaultRegistryRoot,
  loadRegistry,
  localRegistrySource,
  resolveModule,
  type Registry,
} from "./registry.js";
import type { InstalledModuleDocument, ModuleRuntime } from "./types.js";

export { localRegistrySource, registrySourceForRoot } from "./registry.js";

export const LOCAL_REGISTRY_SOURCE_PREFIX = "local:";

export type ParsedRegistrySource =
  | { readonly kind: "official" }
  | { readonly kind: "local"; readonly root: string };

export function isOfficialRegistrySource(source: string): boolean {
  return source === OFFICIAL_REGISTRY_SOURCE;
}

export function parseRegistrySource(source: string): ParsedRegistrySource {
  if (source === OFFICIAL_REGISTRY_SOURCE) {
    return { kind: "official" };
  }
  if (source.startsWith(LOCAL_REGISTRY_SOURCE_PREFIX)) {
    const root = source.slice(LOCAL_REGISTRY_SOURCE_PREFIX.length);
    if (root.length === 0) {
      throw new VibeKitError({
        category: "invalid_input",
        code: "registry_source_invalid",
        message: "Local registry source is missing a path",
        details: { source },
      });
    }
    return { kind: "local", root };
  }
  throw new VibeKitError({
    category: "invalid_input",
    code: "registry_source_unsupported",
    message: `Unsupported registry source "${source}". Supported sources are "${OFFICIAL_REGISTRY_SOURCE}" and "${LOCAL_REGISTRY_SOURCE_PREFIX}<path>"`,
    details: { source },
  });
}

export function loadRegistryForSource(source: string): Registry {
  const parsed = parseRegistrySource(source);
  if (parsed.kind === "official") {
    return loadRegistry(defaultRegistryRoot(), OFFICIAL_REGISTRY_SOURCE);
  }
  return loadRegistry(parsed.root, localRegistrySource(parsed.root));
}

export function registryForInstalledModule(
  record: Pick<InstalledModuleDocument, "id" | "version" | "registrySource">,
  selected?: Registry,
): Registry {
  if (selected !== undefined && selected.source === record.registrySource) {
    return selected;
  }
  return loadRegistryForSource(record.registrySource);
}

export function assertRegistryMatchesInstallSource(
  record: Pick<InstalledModuleDocument, "id" | "registrySource">,
  selected: Registry,
): void {
  if (selected.source === record.registrySource) {
    return;
  }
  throw new VibeKitError({
    category: "conflict",
    code: "registry_source_mismatch",
    message: `${record.id} was installed from ${record.registrySource}; the selected registry is ${selected.source}. Pass --registry matching the install source.`,
    details: {
      id: record.id,
      installedSource: record.registrySource,
      selectedSource: selected.source,
    },
  });
}

export function resolveInstalledModule(
  record: Pick<InstalledModuleDocument, "id" | "version" | "registrySource"> & {
    readonly integrityChecksum?: string;
  },
  selected?: Registry,
): LoadedModule {
  const registry = registryForInstalledModule(record, selected);
  const loaded = resolveModule(registry, record.id, record.version);
  if (
    "integrityChecksum" in record &&
    typeof record.integrityChecksum === "string" &&
    record.integrityChecksum.length > 0 &&
    loaded.checksum !== undefined &&
    loaded.checksum !== record.integrityChecksum
  ) {
    throw new VibeKitError({
      category: "conflict",
      code: "installed_integrity_mismatch",
      message: `Installed ${record.id}@${record.version} checksum does not match ${record.registrySource}`,
      details: {
        id: record.id,
        version: record.version,
        installed: record.integrityChecksum,
        resolved: loaded.checksum,
      },
    });
  }
  return loaded;
}

export function resolveInstalledModuleRuntime(
  record: Pick<InstalledModuleDocument, "id" | "version" | "registrySource">,
  selected?: Registry,
): ModuleRuntime | undefined {
  const loaded = resolveInstalledModule(record, selected);
  if (loaded.document.type === "agent") {
    return undefined;
  }
  return loaded.document.runtime;
}
