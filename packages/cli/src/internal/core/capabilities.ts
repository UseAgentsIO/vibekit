import { VibeKitError } from "./errors.js";
import type { ModuleId } from "./ids.js";

export type CapabilityBindingSource = "agent" | "project" | "installed";

export interface CapabilityProvider {
  readonly id: ModuleId;
  readonly capabilities: readonly string[];
  readonly compatible?: boolean;
}

export type CapabilityResolution =
  | {
      readonly status: "resolved";
      readonly capability: string;
      readonly provider: ModuleId;
      readonly source: CapabilityBindingSource;
    }
  | {
      readonly status: "unresolved";
      readonly capability: string;
      readonly reason: "none" | "ambiguous";
      readonly providers: readonly ModuleId[];
    };

export function resolveCapability(
  capability: string,
  options: {
    readonly agentBinding?: ModuleId;
    readonly projectBinding?: ModuleId;
    readonly installedProviders: readonly CapabilityProvider[];
  },
): CapabilityResolution {
  if (options.agentBinding) {
    if (!providerOffers(options.installedProviders, options.agentBinding, capability)) {
      return {
        status: "unresolved",
        capability,
        reason: "none",
        providers: [],
      };
    }
    return {
      status: "resolved",
      capability,
      provider: options.agentBinding,
      source: "agent",
    };
  }
  if (options.projectBinding) {
    if (!providerOffers(options.installedProviders, options.projectBinding, capability)) {
      return {
        status: "unresolved",
        capability,
        reason: "none",
        providers: [],
      };
    }
    return {
      status: "resolved",
      capability,
      provider: options.projectBinding,
      source: "project",
    };
  }

  const providers = options.installedProviders
    .filter((provider) => provider.compatible !== false)
    .filter((provider) => provider.capabilities.includes(capability))
    .map((provider) => provider.id)
    .sort((left, right) => left.localeCompare(right));

  if (providers.length === 1 && providers[0] !== undefined) {
    return {
      status: "resolved",
      capability,
      provider: providers[0],
      source: "installed",
    };
  }
  if (providers.length === 0) {
    return {
      status: "unresolved",
      capability,
      reason: "none",
      providers: [],
    };
  }
  return {
    status: "unresolved",
    capability,
    reason: "ambiguous",
    providers,
  };
}

export function assertCapabilityResolved(resolution: CapabilityResolution): ModuleId {
  if (resolution.status === "resolved") {
    return resolution.provider;
  }
  if (resolution.reason === "ambiguous") {
    throw new VibeKitError({
      category: "conflict",
      code: "capability_ambiguous",
      message: `Capability ${resolution.capability} is provided by several Modules; bind one explicitly`,
      details: {
        capability: resolution.capability,
        providers: resolution.providers,
      },
    });
  }
  throw new VibeKitError({
    category: "dependency_missing",
    code: "capability_unresolved",
    message: `No installed Module provides capability ${resolution.capability}`,
    details: { capability: resolution.capability },
  });
}

function providerOffers(
  installedProviders: readonly CapabilityProvider[],
  id: ModuleId,
  capability: string,
): boolean {
  return installedProviders.some(
    (provider) => provider.id === id && provider.capabilities.includes(capability),
  );
}

export function resolveRequiredCapabilities(
  capabilities: readonly string[],
  options: {
    readonly agentBindings?: Readonly<Record<string, ModuleId>>;
    readonly projectBindings?: Readonly<Record<string, ModuleId>>;
    readonly installedProviders: readonly CapabilityProvider[];
  },
): CapabilityResolution[] {
  return capabilities.map((capability) =>
    resolveCapability(capability, {
      agentBinding: options.agentBindings?.[capability],
      projectBinding: options.projectBindings?.[capability],
      installedProviders: options.installedProviders,
    }),
  );
}
