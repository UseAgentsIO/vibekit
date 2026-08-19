import {
  defaultRegistryRoot,
  getInstalledModule,
  loadRegistry,
  parseModuleId,
  readInstalledManifest,
  resolveModule,
  type ModuleId,
  type ModuleRuntime,
} from "@useagentsio/core";

import { exportedValue, importProjectModule } from "./project-import.js";

export interface OptionalStateAdapter {
  readonly id: string;
  sessionContext?(): string | undefined | Promise<string | undefined>;
  close?(): void | Promise<void>;
}

export interface StateAdapterFactory {
  (
    config: Record<string, unknown>,
    ctx: { projectRoot: string },
  ): OptionalStateAdapter | Promise<OptionalStateAdapter>;
}

/**
 * Load a non-repository state adapter only when the Project names it and
 * the module is installed. Repository-only Projects stay unchanged.
 */
export async function bindOptionalStateAdapter(
  projectRoot: string,
  backend: ModuleId | undefined,
): Promise<OptionalStateAdapter | undefined> {
  if (backend === undefined || backend === "state:repository") {
    return undefined;
  }
  let parsed;
  try {
    parsed = parseModuleId(backend);
  } catch {
    return undefined;
  }
  if (parsed.type !== "state") {
    return undefined;
  }

  let manifest;
  try {
    manifest = readInstalledManifest(projectRoot);
  } catch {
    return undefined;
  }
  const installed = getInstalledModule(manifest, backend);
  if (installed === undefined) {
    return undefined;
  }

  const runtime = runtimeOf(backend, installed.version);
  if (runtime?.package === undefined || runtime.export === undefined) {
    return undefined;
  }
  if (runtime.kind === "config-only" || runtime.available === false) {
    return undefined;
  }

  const factory = await loadStateFactory(projectRoot, runtime.package, runtime.export);
  if (factory === undefined) {
    return undefined;
  }
  return factory({}, { projectRoot });
}

export async function loadStateFactory(
  projectRoot: string,
  packageName: string,
  exportName: string,
): Promise<StateAdapterFactory | undefined> {
  const mod = await importProjectModule(projectRoot, packageName);
  const exported = exportedValue(mod, exportName);
  if (typeof exported === "function") {
    return exported as StateAdapterFactory;
  }
  return undefined;
}

export async function optionalSessionContext(
  adapter: OptionalStateAdapter | undefined,
  grantedCapabilities: readonly string[],
): Promise<string | undefined> {
  if (adapter?.sessionContext === undefined) {
    return undefined;
  }
  const canReadMemory = grantedCapabilities.some(
    (capability) => capability === "memory.read" || capability.startsWith("memory."),
  );
  if (!canReadMemory) {
    return undefined;
  }
  const snapshot = await adapter.sessionContext();
  if (snapshot === undefined || snapshot.trim() === "") {
    return undefined;
  }
  return snapshot;
}

function runtimeOf(id: ModuleId, version: string): ModuleRuntime | undefined {
  try {
    const loaded = resolveModule(loadRegistry(defaultRegistryRoot()), id, version);
    if (loaded.document.type === "agent") {
      return undefined;
    }
    return loaded.document.runtime;
  } catch {
    try {
      const loaded = resolveModule(loadRegistry(defaultRegistryRoot()), id);
      if (loaded.document.type === "agent") {
        return undefined;
      }
      return loaded.document.runtime;
    } catch {
      return undefined;
    }
  }
}
