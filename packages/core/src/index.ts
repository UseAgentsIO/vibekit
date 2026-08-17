export {
  FAILURE_CATEGORIES,
  FAILURE_CATEGORY_SET,
  VibeKitError,
  isFailureCategory,
  isVibeKitError,
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
