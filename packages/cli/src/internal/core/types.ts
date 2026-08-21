import type {
  ApprovalState,
  DecisionState,
  EvidenceState,
  TaskState,
  VerificationState,
} from "./lifecycles.js";
import type { FailureCategory } from "./errors.js";
import type { ModuleId, ModuleType, ProjectId, RuntimeId } from "./ids.js";
import type { ProjectSchemaVersion, SchemaVersion } from "./schema-version.js";

export type IsolationMode = "process" | "worktree";
export type AuthorizationMode = "deny" | "standing" | "explicit";
export type TrackingMode = "git" | "local" | "ephemeral";
export type OwnershipMode = "exclusive" | "generated";
export type DeliveryMode = "proposal" | "apply";
export type SecretSource = "environment" | "deployment";
export type ResultStatus = "completed" | "failed";
export type Priority = "low" | "normal" | "high";

export interface ValidationError {
  readonly path: string;
  readonly message: string;
}

export interface ValidationResult<T = unknown> {
  readonly valid: boolean;
  readonly errors: readonly ValidationError[];
  readonly data?: T;
}

export interface CompatibilityDeclaration {
  readonly vibekit: string;
  readonly pi: string;
  readonly node?: string;
}

export interface SourceRef {
  readonly repository: string;
  readonly revision: string;
}

export interface SecretReference {
  readonly name: string;
  readonly source: SecretSource;
  readonly required?: boolean;
}

export interface FileInstall {
  readonly source: string;
  readonly target: string;
  readonly ownership: OwnershipMode;
}

export interface DependencySet {
  readonly required: readonly ModuleId[];
  readonly optional: readonly ModuleId[];
  readonly recommended: readonly ModuleId[];
  readonly conflicts: readonly ModuleId[];
}

export interface PermissionRequest {
  readonly capability: string;
}

export interface PermissionScope {
  readonly paths?: readonly string[];
  readonly commands?: readonly string[];
  readonly resources?: readonly string[];
  readonly branches?: readonly string[];
}

export interface PermissionGrant {
  readonly capability: string;
  readonly scope?: PermissionScope;
}

export interface ConfigurationContract {
  readonly target: string;
  readonly schema: string;
}

export interface HealthCheck {
  readonly type: string;
  readonly name: string;
}

export interface ModuleDocument {
  readonly schemaVersion: SchemaVersion;
  readonly id: ModuleId;
  readonly type: ModuleType;
  readonly name: string;
  readonly displayName?: string;
  readonly version: string;
  readonly description: string;
  readonly compatibility?: CompatibilityDeclaration;
  readonly source?: SourceRef;
  readonly license?: string;
}

export interface ComponentDocument extends ModuleDocument {
  readonly type: Exclude<ModuleType, "agent">;
  readonly compatibility: CompatibilityDeclaration;
  readonly source: SourceRef;
  readonly license: string;
  readonly providesCapabilities: readonly string[];
  readonly requires: DependencySet;
  readonly requestsPermissions: readonly PermissionRequest[];
  readonly secrets: readonly SecretReference[];
  readonly files: readonly FileInstall[];
  readonly configuration: ConfigurationContract;
  readonly healthCheck?: HealthCheck;
  readonly runtime?: ModuleRuntime;
  readonly packages?: ModulePackages;
}

export interface AgentModelConfig {
  readonly provider: string;
  readonly id: string;
  readonly allowProjectOverride: boolean;
  readonly allowTaskOverride: boolean;
}

export interface AgentComponents {
  readonly required: readonly ModuleId[];
  readonly optional: readonly ModuleId[];
  readonly recommended: readonly ModuleId[];
}

export interface AgentDocument extends ModuleDocument {
  readonly type: "agent";
  readonly instructions: string;
  readonly model: AgentModelConfig;
  readonly components: AgentComponents;
  readonly capabilities: {
    readonly requires: readonly string[];
  };
  readonly inputs: {
    readonly required: readonly string[];
    readonly optional?: readonly string[];
  };
  readonly outputs: {
    readonly required: readonly string[];
    readonly optional?: readonly string[];
  };
  readonly permissions: {
    readonly allow: readonly PermissionGrant[];
    readonly deny: readonly PermissionGrant[];
  };
  readonly delegation: {
    readonly allowed: boolean;
    readonly targets: readonly string[];
    readonly maxDepth: number;
    readonly maxParallelChildren: number;
  };
  readonly state: {
    readonly read: readonly string[];
    readonly write: readonly string[];
  };
  readonly execution: {
    readonly isolation: IsolationMode;
    readonly timeoutMs: number;
    readonly cleanupRequired: boolean;
  };
  readonly verification: {
    readonly required: readonly ModuleId[];
    readonly independentReview: boolean;
  };
  readonly completion: {
    readonly requires: readonly string[];
  };
  readonly escalation: {
    readonly on: readonly string[];
  };
  readonly secrets?: readonly SecretReference[];
  readonly files?: readonly FileInstall[];
  readonly providesCapabilities?: readonly string[];
}

export type RuntimeKind = "interface" | "pi-builtin" | "pi-extension" | "package" | "config-only";
export interface ModuleRuntime {
  readonly kind: RuntimeKind;
  readonly package?: string;
  readonly export?: string;
  readonly lifecycle?: "singleton";
  readonly tools?: readonly string[];
  readonly available?: boolean;
}
export interface ModulePackages {
  readonly dependencies?: Readonly<Record<string, string>>;
}
export interface HostConfig {
  readonly retainedConversations: number;
  readonly maxParallelConversations: number;
  readonly sameConversationPolicy: "serialize";
  readonly shutdownGraceMs: number;
}
export interface InterfaceBinding {
  readonly definition: ModuleId;
  readonly enabled: boolean;
  readonly defaultAgent: string;
  readonly config?: string;
}
export interface ConversationDocument {
  readonly schemaVersion: SchemaVersion;
  readonly id: RuntimeId;
  readonly projectId: ProjectId;
  readonly interfaceBinding: string;
  readonly accountId: string;
  readonly external: { readonly conversationId: string; readonly threadId?: string };
  readonly conversationKey: string;
  readonly agentBinding: string;
  readonly sessionPath: string;
  readonly status: "active" | "idle" | "closed";
  readonly title?: string;
  readonly lastEventId?: string;
  readonly createdAt: string;
  readonly lastUsedAt: string;
  readonly revision: number;
}

export interface ProjectTracking {
  readonly conversations?: TrackingMode;
  readonly decisions: TrackingMode;
  readonly tasks: TrackingMode;
  readonly results: TrackingMode;
  readonly approvals: TrackingMode;
  readonly verifications: TrackingMode;
  readonly events: TrackingMode;
  readonly runtime: TrackingMode;
}

export interface AgentBinding {
  readonly definition: ModuleId;
}

export interface ProjectDocument {
  readonly schemaVersion: ProjectSchemaVersion;
  readonly id: ProjectId;
  readonly name: string;
  readonly root: string;
  /** Relative working area for ordinary Agent tasks. Defaults to the Project root. */
  readonly workspace?: string;
  readonly runtime?: {
    readonly adapter: string;
    readonly host?: string;
  };
  readonly defaultAgent?: string;
  readonly host?: HostConfig;
  readonly interfaceBindings?: Readonly<Record<string, InterfaceBinding>>;
  readonly pi: {
    readonly compatibility: string;
  };
  readonly defaults?: {
    readonly model?: {
      readonly provider: string;
      readonly id: string;
    };
  };
  readonly state: {
    readonly backend: ModuleId;
    readonly path: string;
    readonly tracking: ProjectTracking;
  };
  readonly agentBindings: Readonly<Record<string, AgentBinding>>;
  readonly delegation: Readonly<Record<string, readonly string[]>>;
  readonly capabilityBindings: Readonly<Record<string, ModuleId>>;
  readonly policies: readonly ModuleId[];
  readonly execution: {
    readonly maxParallelRuns: number;
    readonly defaultIsolation: IsolationMode;
    readonly mutationIsolation: IsolationMode;
    readonly defaultTimeoutMs: number;
    readonly maxDelegationDepth: number;
  };
  readonly authorization: {
    readonly default: AuthorizationMode;
    readonly actions: Readonly<Record<string, AuthorizationMode>>;
  };
  readonly verification: {
    readonly default: readonly ModuleId[];
  };
  readonly sources: {
    readonly canonical: readonly string[];
    readonly derived?: readonly string[];
    readonly untrusted: readonly string[];
  };
}

export interface RegistryEntryDocument {
  readonly schemaVersion: SchemaVersion;
  readonly id: ModuleId;
  readonly type?: ModuleType;
  readonly name: string;
  readonly displayName?: string;
  readonly version: string;
  readonly description: string;
  readonly publisher: string;
  readonly source: SourceRef;
  readonly license: string;
  readonly checksum: string;
  readonly compatibility: CompatibilityDeclaration;
  readonly requires: DependencySet;
  readonly providesCapabilities: readonly string[];
  readonly requestsPermissions: readonly PermissionRequest[];
  readonly secrets: readonly SecretReference[];
  readonly files: readonly FileInstall[];
  readonly documentation: string;
}

export interface InstalledFileRecord {
  readonly path: string;
  readonly hash: string;
  readonly ownership: OwnershipMode;
}

export interface InstalledModuleDocument {
  readonly schemaVersion: SchemaVersion;
  readonly id: ModuleId;
  readonly version: string;
  readonly registrySource: string;
  readonly sourceRevision: string;
  readonly integrityChecksum: string;
  readonly installedAt: string;
  readonly dependencies: readonly ModuleId[];
  readonly files: readonly InstalledFileRecord[];
  readonly configurationPaths: readonly string[];
  readonly compatibility: CompatibilityDeclaration;
}

export interface InstalledManifestDocument {
  readonly schemaVersion: SchemaVersion;
  readonly modules: readonly InstalledModuleDocument[];
}

export interface TaskDocument {
  readonly schemaVersion: SchemaVersion;
  readonly id: RuntimeId;
  readonly projectId: ProjectId;
  readonly objective: string;
  readonly context: {
    readonly references: readonly string[];
  };
  readonly constraints: readonly string[];
  readonly acceptanceCriteria: readonly string[];
  readonly requiredCapabilities: readonly string[];
  readonly assignedAgent: ModuleId | null;
  readonly claimedBy: RuntimeId | null;
  readonly scope: {
    readonly paths: readonly string[];
    readonly resources: readonly string[];
  };
  readonly dependencies: readonly RuntimeId[];
  readonly priority: Priority;
  readonly delivery: {
    readonly mode: DeliveryMode;
  };
  readonly authorization: {
    readonly state: AuthorizationMode;
  };
  readonly status: TaskState;
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ResultArtifact {
  readonly path: string;
  readonly revision: string;
}

export interface EvidenceObject {
  readonly state: EvidenceState;
  readonly source?: string;
  readonly summary?: string;
  readonly uri?: string;
}

export type EvidenceItem = string | EvidenceObject;

export interface ResultDocument {
  readonly schemaVersion: SchemaVersion;
  readonly id: RuntimeId;
  readonly taskId: RuntimeId;
  readonly runId: RuntimeId;
  readonly agentId: ModuleId;
  readonly status: ResultStatus;
  readonly summary: string;
  readonly artifacts: readonly ResultArtifact[];
  readonly evidence: readonly EvidenceItem[];
  readonly verificationIds: readonly RuntimeId[];
  readonly unresolvedIssues: readonly string[];
  readonly discoveredConstraints: readonly string[];
  readonly recommendedNextActions: readonly string[];
  readonly createdAt: string;
}

export interface DecisionDocument {
  readonly schemaVersion: SchemaVersion;
  readonly id: RuntimeId;
  readonly projectId?: ProjectId;
  readonly question: string;
  readonly decision: string;
  readonly status: DecisionState;
  readonly reason: string;
  readonly evidence: readonly EvidenceItem[];
  readonly authority: string;
  readonly producedBy: string;
  readonly createdAt: string;
  readonly updatedAt?: string;
  readonly supersedes?: RuntimeId | null;
}

export interface ApprovalDocument {
  readonly schemaVersion: SchemaVersion;
  readonly id: RuntimeId;
  readonly projectId?: ProjectId;
  readonly action: string;
  readonly target: string;
  readonly scope: Readonly<Record<string, unknown>>;
  readonly taskId: RuntimeId;
  readonly resultId: RuntimeId;
  readonly status: ApprovalState;
  readonly requestedAuthority: string;
  readonly requestedAt: string;
  readonly decidedAt: string | null;
  readonly expiresAt?: string | null;
}

export interface VerificationContract {
  readonly type: "command" | "review";
  readonly command?: string;
  readonly review?: string;
}

export interface VerificationDocument {
  readonly schemaVersion: SchemaVersion;
  readonly id: RuntimeId;
  readonly taskId: RuntimeId;
  readonly resultId: RuntimeId;
  readonly verifierId: ModuleId;
  readonly candidateRevision: string;
  readonly contract: VerificationContract;
  readonly startedAt: string;
  readonly finishedAt: string | null;
  readonly status: VerificationState;
  readonly evidence: readonly EvidenceItem[];
  readonly exitCode?: number | null;
  readonly observedFailures: readonly string[];
  readonly skipReason?: string;
}

export interface EventDocument {
  readonly schemaVersion: SchemaVersion;
  readonly id: RuntimeId;
  readonly type: string;
  readonly projectId: ProjectId;
  readonly taskId?: RuntimeId | null;
  readonly runId?: RuntimeId | null;
  readonly actor: string;
  readonly timestamp: string;
  readonly data: Readonly<Record<string, unknown>>;
}

export type DocumentKind =
  | "module"
  | "component"
  | "agent"
  | "project"
  | "registry-entry"
  | "installed-module"
  | "installed"
  | "task"
  | "result"
  | "decision"
  | "approval"
  | "verification"
  | "event"
  | "conversation"
  | "secret";

export interface DocumentTypeMap {
  module: ModuleDocument;
  component: ComponentDocument;
  agent: AgentDocument;
  project: ProjectDocument;
  "registry-entry": RegistryEntryDocument;
  "installed-module": InstalledModuleDocument;
  installed: InstalledManifestDocument;
  task: TaskDocument;
  result: ResultDocument;
  decision: DecisionDocument;
  approval: ApprovalDocument;
  verification: VerificationDocument;
  event: EventDocument;
  conversation: ConversationDocument;
  secret: SecretReference;
}

export const DOCUMENT_KINDS: readonly DocumentKind[] = [
  "module",
  "component",
  "agent",
  "project",
  "registry-entry",
  "installed-module",
  "installed",
  "task",
  "result",
  "decision",
  "approval",
  "verification",
  "event",
  "conversation",
  "secret",
];

export interface StructuredFailure {
  readonly category: FailureCategory;
  readonly code: string;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
}
