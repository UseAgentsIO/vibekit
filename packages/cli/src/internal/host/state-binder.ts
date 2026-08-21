import { getInstalledModule, parseModuleId, readInstalledManifest, type ModuleId } from "../core/index.js";

import { hostError } from "./errors.js";
import { exportedValue, importProjectModule } from "./project-import.js";
import { resolveExecutableRuntime } from "./runtime-loader.js";

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
  const candidates = uniqueIds(
    [backend, "state:memory"].filter(
      (id): id is string => id !== undefined && id !== "state:repository",
    ),
  );
  for (const id of candidates) {
    const adapter = await bindStateModule(projectRoot, id);
    if (adapter !== undefined) {
      return adapter;
    }
  }
  return undefined;
}

async function bindStateModule(
  projectRoot: string,
  backend: string,
): Promise<OptionalStateAdapter | undefined> {
  if (backend === "state:repository") {
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
  const installed = getInstalledModule(manifest, backend as ModuleId);
  if (installed === undefined) {
    return undefined;
  }

  const executable = resolveExecutableRuntime(installed, {
    expectedType: "state",
    executableKinds: ["package"],
  });
  if (executable === undefined) {
    return undefined;
  }

  const factory = await loadStateFactory(projectRoot, executable.package, executable.export);
  if (factory === undefined) {
    throw hostError(
      "unavailable",
      "state_factory_missing",
      `Unable to load ${backend} from ${executable.package} (${executable.export})`,
      {
        id: backend,
        package: executable.package,
        export: executable.export,
        registrySource: installed.registrySource,
      },
    );
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

function uniqueIds(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (!seen.has(value)) {
      seen.add(value);
      result.push(value);
    }
  }
  return result;
}
