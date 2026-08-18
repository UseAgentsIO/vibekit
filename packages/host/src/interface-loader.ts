import type {
  InterfaceFactory,
  InterfaceServices,
  RunningInterface,
} from "@useagentsio/interface-sdk";

import { hostError } from "./errors.js";

export type InterfaceFactoryMap = Readonly<Record<string, InterfaceFactory>>;

export async function loadInterfaceFactory(
  definition: string,
  factories?: InterfaceFactoryMap,
): Promise<InterfaceFactory> {
  if (factories?.[definition] !== undefined) {
    return factories[definition];
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
): Promise<RunningInterface> {
  const factory = await loadInterfaceFactory(definition, factories);
  return factory.create(config, services);
}
