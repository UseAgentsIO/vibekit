import type {
  InterfaceFactory,
  InterfaceServices,
  RunningInterface,
} from "@useagentsio/interface-sdk";

import { hostError } from "./errors.js";
import {
  importRuntimeExport,
  readInstalledRecord,
  resolveExecutableRuntime,
} from "./runtime-loader.js";

export type InterfaceFactoryMap = Readonly<Record<string, InterfaceFactory>>;

export async function loadInterfaceFactory(
  definition: string,
  factories?: InterfaceFactoryMap,
  projectRoot?: string,
): Promise<InterfaceFactory> {
  if (factories?.[definition] !== undefined) {
    return factories[definition];
  }

  if (projectRoot === undefined) {
    throw hostError(
      "unavailable",
      "interface_unsupported",
      `No executable Interface factory is registered for ${definition}`,
      { definition },
    );
  }

  const record = readInstalledRecord(projectRoot, definition);
  const executable = resolveExecutableRuntime(record, {
    expectedType: "interface",
    executableKinds: ["interface"],
  });
  if (executable === undefined) {
    throw hostError(
      "unavailable",
      "interface_not_executable",
      `${definition} is installed but is not executable`,
      { definition, version: record.version, registrySource: record.registrySource },
    );
  }

  const exported = await importRuntimeExport(projectRoot, executable.package, executable.export);
  const factory = asInterfaceFactory(exported);
  if (factory === undefined) {
    throw hostError(
      "unavailable",
      "interface_export_invalid",
      `${executable.package} export ${executable.export} is not an Interface factory`,
      { definition, package: executable.package, export: executable.export },
    );
  }
  return factory;
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
