import {
  defaultRegistryRoot,
  getInstalledModule,
  isModuleId,
  loadRegistry,
  readInstalledManifest,
  resolveModule,
  type ModuleRuntime,
} from "@useagentsio/core";
import type {
  InterfaceFactory,
  InterfaceServices,
  RunningInterface,
} from "@useagentsio/interface-sdk";

import { hostError } from "./errors.js";
import { importProjectModule } from "./project-import.js";

export type InterfaceFactoryMap = Readonly<Record<string, InterfaceFactory>>;

const OFFICIAL_INTERFACE_RUNTIME: Readonly<
  Record<string, { readonly package: string; readonly export: string }>
> = {
  "interface:terminal": {
    package: "@useagentsio/interface-terminal",
    export: "createTerminalInterface",
  },
};

export async function loadInterfaceFactory(
  definition: string,
  factories?: InterfaceFactoryMap,
  projectRoot?: string,
): Promise<InterfaceFactory> {
  if (factories?.[definition] !== undefined) {
    return factories[definition];
  }

  for (const runtime of interfaceRuntimeCandidates(definition, projectRoot)) {
    const factory = await importInterfaceFactory(
      runtime.package,
      runtime.export,
      projectRoot,
    );
    if (factory !== undefined) {
      return factory;
    }
  }

  throw hostError(
    "unavailable",
    "interface_unsupported",
    `No executable Interface factory is registered for ${definition}`,
    { definition },
  );
}

export async function startInterface(
  definition: string,
  config: Record<string, unknown>,
  services: InterfaceServices,
  factories?: InterfaceFactoryMap,
  projectRoot?: string,
): Promise<RunningInterface> {
  const factory = await loadInterfaceFactory(definition, factories, projectRoot);
  return factory.create(config, services);
}

function interfaceRuntimeCandidates(
  definition: string,
  projectRoot?: string,
): ReadonlyArray<{ readonly package: string; readonly export: string }> {
  const candidates: Array<{ readonly package: string; readonly export: string }> = [];
  const fromRegistry = runtimeFromOfficialRegistry(definition, projectRoot);
  if (fromRegistry !== undefined) {
    candidates.push(fromRegistry);
  }
  const fallback = OFFICIAL_INTERFACE_RUNTIME[definition];
  if (
    fallback !== undefined &&
    (fromRegistry === undefined ||
      fromRegistry.package !== fallback.package ||
      fromRegistry.export !== fallback.export)
  ) {
    candidates.push(fallback);
  }
  return candidates;
}

function runtimeFromOfficialRegistry(
  definition: string,
  projectRoot?: string,
): { readonly package: string; readonly export: string } | undefined {
  try {
    const version = installedModuleVersion(definition, projectRoot);
    const loaded = resolveModule(loadRegistry(defaultRegistryRoot()), definition, version);
    if (loaded.document.type === "agent") {
      return undefined;
    }
    return packageExportOf(loaded.document.runtime);
  } catch {
    return undefined;
  }
}

function installedModuleVersion(definition: string, projectRoot?: string): string | undefined {
  if (projectRoot === undefined || !isModuleId(definition)) {
    return undefined;
  }
  try {
    return getInstalledModule(readInstalledManifest(projectRoot), definition)?.version;
  } catch {
    return undefined;
  }
}

function packageExportOf(
  runtime: ModuleRuntime | undefined,
): { readonly package: string; readonly export: string } | undefined {
  if (
    runtime?.kind !== "interface" ||
    runtime.package === undefined ||
    runtime.package.length === 0 ||
    runtime.export === undefined ||
    runtime.export.length === 0
  ) {
    return undefined;
  }
  return { package: runtime.package, export: runtime.export };
}

async function importInterfaceFactory(
  packageName: string,
  exportName: string,
  projectRoot?: string,
): Promise<InterfaceFactory | undefined> {
  if (projectRoot !== undefined) {
    const fromProject = await importProjectModule(projectRoot, packageName);
    const factory = asInterfaceFactory(fromProject?.[exportName]);
    if (factory !== undefined) {
      return factory;
    }
  }
  try {
    const mod = (await import(packageName)) as Record<string, unknown>;
    return asInterfaceFactory(mod[exportName]);
  } catch {
    return undefined;
  }
}

function asInterfaceFactory(exported: unknown): InterfaceFactory | undefined {
  if (typeof exported === "function") {
    return { create: exported as InterfaceFactory["create"] };
  }
  if (
    exported !== null &&
    typeof exported === "object" &&
    typeof (exported as InterfaceFactory).create === "function"
  ) {
    return exported as InterfaceFactory;
  }
  return undefined;
}
