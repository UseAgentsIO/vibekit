import { NON_MODULE_CAPABILITIES } from "./authority.js";
import { satisfiesCompatibility } from "./compatibility.js";
import { PI_RUNTIME_VERSION, VIBEKIT_VERSION } from "./constants.js";
import { VibeKitError } from "./errors.js";
import type { ModuleId } from "./ids.js";
import { isAgentDocument, type LoadedModule } from "./module.js";
import type { Registry } from "./registry.js";
import { listRegistryModules, resolveModule } from "./registry.js";

export interface CapabilityProviderResolution {
  readonly extraRoots: readonly ModuleId[];
  readonly bindings: Readonly<Record<string, ModuleId>>;
}

export function resolveCapabilityProviders(options: {
  readonly registry: Registry;
  readonly lookup: (id: ModuleId) => LoadedModule | undefined;
  readonly agents: readonly LoadedModule[];
  readonly available: readonly LoadedModule[];
  readonly projectBindings: Readonly<Record<string, ModuleId>>;
}): CapabilityProviderResolution {
  const availableById = new Map(options.available.map((module) => [module.id, module]));
  const bindings: Record<string, ModuleId> = { ...options.projectBindings };
  const extraRoots: ModuleId[] = [];
  const extraSeen = new Set<ModuleId>();

  const capabilities = unique(
    options.agents.flatMap((agent) =>
      isAgentDocument(agent.document) ? agent.document.capabilities.requires : [],
    ),
  );

  for (const capability of capabilities) {
    if (NON_MODULE_CAPABILITIES.has(capability)) {
      continue;
    }
    const bound = bindings[capability];
    if (bound !== undefined) {
      const provider = availableById.get(bound) ?? loadProvider(options.lookup, bound);
      if (provider !== undefined && provider.providesCapabilities.includes(capability)) {
        if (!availableById.has(bound) && !extraSeen.has(bound)) {
          extraRoots.push(bound);
          extraSeen.add(bound);
          availableById.set(bound, provider);
        }
        continue;
      }
      throw new VibeKitError({
        category: "dependency_missing",
        code: "capability_provider_invalid",
        message: `${bound} does not provide ${capability}`,
        details: { capability, provider: bound },
      });
    }

    const installedCandidates = [...availableById.values()]
      .filter((module) => module.type !== "agent" && module.providesCapabilities.includes(capability))
      .map((module) => module.id)
      .sort((left, right) => left.localeCompare(right));

    if (installedCandidates.length === 1 && installedCandidates[0] !== undefined) {
      bindings[capability] = installedCandidates[0];
      continue;
    }
    if (installedCandidates.length > 1) {
      throw new VibeKitError({
        category: "conflict",
        code: "capability_ambiguous",
        message: `Capability ${capability} is provided by several Modules; bind one explicitly`,
        details: { capability, providers: installedCandidates },
      });
    }

    const registryCandidates = listCompatibleProviders(options.registry, capability);
    if (registryCandidates.length === 0) {
      throw new VibeKitError({
        category: "dependency_missing",
        code: "capability_unresolved",
        message: `No installed or registry Module provides capability ${capability}`,
        details: { capability },
      });
    }
    if (registryCandidates.length > 1) {
      throw new VibeKitError({
        category: "conflict",
        code: "capability_ambiguous",
        message: `Capability ${capability} is provided by several Modules; bind one explicitly`,
        details: { capability, providers: registryCandidates },
      });
    }
    const chosen = registryCandidates[0];
    if (chosen === undefined) {
      throw new VibeKitError({
        category: "dependency_missing",
        code: "capability_unresolved",
        message: `No installed or registry Module provides capability ${capability}`,
        details: { capability },
      });
    }
    bindings[capability] = chosen;
    if (!availableById.has(chosen) && !extraSeen.has(chosen)) {
      extraRoots.push(chosen);
      extraSeen.add(chosen);
      const loaded = options.lookup(chosen);
      if (loaded !== undefined) {
        availableById.set(chosen, loaded);
      }
    }
  }

  extraRoots.sort((left, right) => left.localeCompare(right));
  return { extraRoots, bindings };
}

function listCompatibleProviders(registry: Registry, capability: string): ModuleId[] {
  const actual = {
    vibekit: VIBEKIT_VERSION,
    pi: PI_RUNTIME_VERSION,
    node: process.versions.node,
  };
  const ids = new Set<ModuleId>();
  for (const entry of listRegistryModules(registry)) {
    if (!satisfiesCompatibility(entry.compatibility, actual)) {
      continue;
    }
    let loaded: LoadedModule;
    try {
      loaded = resolveModule(registry, entry.id, entry.version);
    } catch {
      continue;
    }
    if (loaded.type === "agent") {
      continue;
    }
    if (loaded.providesCapabilities.includes(capability)) {
      ids.add(loaded.id);
    }
  }
  return [...ids].sort((left, right) => left.localeCompare(right));
}

function loadProvider(
  lookup: (id: ModuleId) => LoadedModule | undefined,
  id: ModuleId,
): LoadedModule | undefined {
  return lookup(id);
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}
