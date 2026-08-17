import type {
  AgentDocument,
  CompatibilityDeclaration,
  ComponentDocument,
  ConfigurationContract,
  DependencySet,
  FileInstall,
  ModuleDocument,
  PermissionGrant,
  PermissionRequest,
  SecretReference,
  SourceRef,
} from "./types.js";
import type { ModuleId, ModuleType } from "./ids.js";

export interface LoadedModule {
  readonly id: ModuleId;
  readonly type: ModuleType;
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly displayName?: string;
  readonly compatibility?: CompatibilityDeclaration;
  readonly source?: SourceRef;
  readonly license?: string;
  readonly document: ComponentDocument | AgentDocument;
  readonly files: readonly FileInstall[];
  readonly secrets: readonly SecretReference[];
  readonly requiredDependencies: readonly ModuleId[];
  readonly optionalDependencies: readonly ModuleId[];
  readonly recommendedDependencies: readonly ModuleId[];
  readonly conflicts: readonly ModuleId[];
  readonly providesCapabilities: readonly string[];
  readonly requestsPermissions: readonly PermissionRequest[];
  readonly permissionGrants?: {
    readonly allow: readonly PermissionGrant[];
    readonly deny: readonly PermissionGrant[];
  };
  readonly configuration?: ConfigurationContract;
  readonly registryPath: string;
  readonly absolutePath: string;
  readonly checksum?: string;
}

export function isComponentDocument(
  document: ModuleDocument,
): document is ComponentDocument {
  return document.type !== "agent";
}

export function isAgentDocument(document: ModuleDocument): document is AgentDocument {
  return document.type === "agent";
}

export function emptyDependencySet(): DependencySet {
  return {
    required: [],
    optional: [],
    recommended: [],
    conflicts: [],
  };
}

export function loadedModuleFromDocument(
  document: ComponentDocument | AgentDocument,
  options: {
    registryPath: string;
    absolutePath: string;
    checksum?: string;
  },
): LoadedModule {
  if (isAgentDocument(document)) {
    return {
      id: document.id,
      type: document.type,
      name: document.name,
      version: document.version,
      description: document.description,
      displayName: document.displayName,
      compatibility: document.compatibility,
      source: document.source,
      license: document.license,
      document,
      files: document.files ?? [],
      secrets: document.secrets ?? [],
      requiredDependencies: document.components.required,
      optionalDependencies: document.components.optional,
      recommendedDependencies: document.components.recommended,
      conflicts: [],
      providesCapabilities: document.providesCapabilities ?? [],
      requestsPermissions: document.permissions.allow.map((grant) => ({
        capability: grant.capability,
      })),
      permissionGrants: document.permissions,
      configuration: undefined,
      registryPath: options.registryPath,
      absolutePath: options.absolutePath,
      checksum: options.checksum,
    };
  }

  return {
    id: document.id,
    type: document.type,
    name: document.name,
    version: document.version,
    description: document.description,
    displayName: document.displayName,
    compatibility: document.compatibility,
    source: document.source,
    license: document.license,
    document,
    files: document.files,
    secrets: document.secrets,
    requiredDependencies: document.requires.required,
    optionalDependencies: document.requires.optional,
    recommendedDependencies: document.requires.recommended,
    conflicts: document.requires.conflicts,
    providesCapabilities: document.providesCapabilities,
    requestsPermissions: document.requestsPermissions,
    configuration: document.configuration,
    registryPath: options.registryPath,
    absolutePath: options.absolutePath,
    checksum: options.checksum,
  };
}
