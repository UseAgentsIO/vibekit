export {
  FAILURE_CATEGORIES,
  FAILURE_CATEGORY_SET,
  VibeKitError,
  isFailureCategory,
  isVibeKitError,
  containsLikelySecret,
  redactSecrets,
} from "./errors.js";
export type { FailureCategory, VibeKitErrorOptions } from "./errors.js";

export {
  MODULE_TYPES,
  MODULE_TYPE_SET,
  RUNTIME_ID_KINDS,
  RUNTIME_ID_KIND_SET,
  assertModuleId,
  assertProjectId,
  assertRuntimeId,
  assertRuntimeIdOf,
  formatModuleId,
  formatProjectId,
  formatRuntimeId,
  isModuleId,
  isModuleName,
  isModuleType,
  isProjectId,
  isRuntimeId,
  isRuntimeIdKind,
  isRuntimeIdOf,
  isUuid,
  parseModuleId,
  parseProjectId,
  parseRuntimeId,
} from "./ids.js";
export type {
  ModuleId,
  ModuleType,
  ParsedModuleId,
  ParsedProjectId,
  ParsedRuntimeId,
  ProjectId,
  RuntimeId,
  RuntimeIdKind,
} from "./ids.js";

export {
  CURRENT_SCHEMA_VERSION,
  assertSchemaVersion,
  isSchemaVersion,
} from "./schema-version.js";
export type { SchemaVersion } from "./schema-version.js";

export {
  DOCUMENT_KINDS,
} from "./types.js";
export type {
  AgentBinding,
  AgentComponents,
  AgentDocument,
  AgentModelConfig,
  ApprovalDocument,
  AuthorizationMode,
  CompatibilityDeclaration,
  ComponentDocument,
  ConfigurationContract,
  DecisionDocument,
  DeliveryMode,
  DependencySet,
  DocumentKind,
  DocumentTypeMap,
  EventDocument,
  EvidenceItem,
  EvidenceObject,
  FileInstall,
  HealthCheck,
  InstalledFileRecord,
  InstalledManifestDocument,
  InstalledModuleDocument,
  IsolationMode,
  ModuleDocument,
  OwnershipMode,
  PermissionGrant,
  PermissionRequest,
  PermissionScope,
  Priority,
  ProjectDocument,
  ProjectTracking,
  RegistryEntryDocument,
  ResultArtifact,
  ResultDocument,
  ResultStatus,
  SecretReference,
  SecretSource,
  SourceRef,
  StructuredFailure,
  TaskDocument,
  TrackingMode,
  ValidationError,
  ValidationResult,
  VerificationContract,
  VerificationDocument,
} from "./types.js";

export {
  getSchemasDirectory,
  isDocumentKind,
  parseAndValidateJson,
  parseAndValidateYaml,
  validateDocument,
} from "./validate.js";

export {
  APPROVAL_STATES,
  DECISION_STATES,
  EVIDENCE_STATES,
  LIFECYCLE_KINDS,
  RUN_STATES,
  TASK_STATES,
  VERIFICATION_STATES,
  allowedTransitions,
  assertTransition,
  canTransition,
  isLifecycleKind,
} from "./lifecycles.js";
export type {
  ApprovalState,
  DecisionState,
  EvidenceState,
  LifecycleKind,
  LifecycleStateMap,
  RunState,
  TaskState,
  VerificationState,
} from "./lifecycles.js";

export {
  isSemverRange,
  satisfiesCompatibility,
} from "./compatibility.js";
export type {
  CompatibilityActual,
  CompatibilityDeclaration as CompatibilityRangeDeclaration,
} from "./compatibility.js";

export {
  assertFileTarget,
  isSafeFileTarget,
  validateFileTarget,
} from "./file-targets.js";

export {
  INSTALLED_RELATIVE_PATH,
  OFFICIAL_REGISTRY_SOURCE,
  PI_EXTENSION_RELATIVE_PATH,
  PI_RUNTIME_VERSION,
  PROJECT_RELATIVE_PATH,
  RUNTIME_GITIGNORE_RULE,
  STAGING_RELATIVE_PATH,
  VIBEKIT_DIR,
  VIBEKIT_VERSION,
} from "./constants.js";

export {
  checksumDirectory,
  listFilesRecursive,
  sha256Checksum,
  sha256File,
  sha256Hex,
} from "./checksum.js";

export { stringifyYaml } from "./yaml.js";

export {
  emptyDependencySet,
  isAgentDocument,
  isComponentDocument,
  loadedModuleFromDocument,
} from "./module.js";
export type { LoadedModule } from "./module.js";

export { safeResolve, toPosixPath } from "./paths.js";

export {
  assertModulePayload,
  defaultRegistryRoot,
  findModuleDirs,
  listRegistryModules,
  loadModuleDocument,
  loadModuleFromDirectory,
  loadRegistry,
  resolveModule,
} from "./registry.js";
export type { Registry, RegistryIndex, RegistryIndexEntry } from "./registry.js";

export {
  detectConflicts,
  detectCycles,
  resolveInstallSet,
  resolveRequiredGraph,
  topologicalSort,
} from "./graph.js";
export type { DependencyGraph, ResolvedInstallSet } from "./graph.js";

export {
  assertCapabilityResolved,
  resolveCapability,
  resolveRequiredCapabilities,
} from "./capabilities.js";
export type {
  CapabilityBindingSource,
  CapabilityProvider,
  CapabilityResolution,
} from "./capabilities.js";

export { collectInstalledOwnership, planFileOwnership } from "./ownership.js";
export type { OwnershipClaim, PlannedFile } from "./ownership.js";

export {
  assertSafeInstalledPaths,
  emptyInstalledManifest,
  getInstalledModule,
  installedManifestPath,
  installedModuleIds,
  readInstalledManifest,
  upsertInstalledModule,
  writeInstalledManifest,
} from "./installed.js";

export {
  createDefaultProject,
  projectDocumentPath,
  readProjectDocument,
  writeProjectDocument,
} from "./project.js";

export { applyInstall, planInstall } from "./install.js";
export type { InstallPlan, InstallResult, PlanInstallOptions, PlannedPermission } from "./install.js";

export { runDoctor } from "./doctor.js";
export type { DoctorFinding, DoctorReport, DoctorSeverity } from "./doctor.js";

export { buildRegistryIndex, writeRegistryIndex } from "./registry-index.js";
export type { RegistryIndexBuildResult } from "./registry-index.js";
