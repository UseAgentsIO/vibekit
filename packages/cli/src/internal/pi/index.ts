export { configurationInvalid, fail } from "./fail.js";
export { newRuntimeId } from "./ids.js";

export {
  agentDocumentPath,
  loadAgentDocument,
  resolveAgentBinding,
  type LoadAgentOptions,
  type LoadedAgent,
} from "./agent.js";

export {
  loadProjectDocument,
  projectDocumentPath,
  resolveProjectDocument,
} from "./project.js";

export {
  assertRequiredTaskInputs,
  assertTaskAssignedAgent,
  assertTaskAuthorization,
  assertTaskMatchesProject,
  loadTaskDocument,
  resolveTaskDocument,
} from "./task.js";

export {
  VIBEKIT_DEFAULT_ADAPTER,
  VIBEKIT_DEFAULT_ISOLATION,
  VIBEKIT_DEFAULT_MAX_DELEGATION_DEPTH,
  VIBEKIT_DEFAULT_MAX_PARALLEL_RUNS,
  VIBEKIT_DEFAULT_TIMEOUT_MS,
  resolveAllowlistedTools,
  resolveEffectiveConfiguration,
  resolveProjectDefaultModel,
  type EffectiveConfiguration,
  type EffectivePermissions,
  type ResolveEffectiveConfigurationInput,
} from "./config.js";

export {
  INHERIT_MODEL,
  isInheritModelValue,
  isUsableModel,
  loadProjectAgentConfig,
  resolveModel,
  usableModel,
  type ModelRef,
  type ModelSource,
  type ResolveModelInput,
  type ResolvedModel,
} from "./model.js";

export {
  AGENT_DELEGATE_TOOL,
  CAPABILITY_TOOL_MAP,
  DELEGATE_CAPABILITY,
  MUTATING_TOOLS,
  PI_BUILTIN_TOOLS,
  hasDelegateCapability,
  registerDelegateTool,
  toolsForCapability,
  uniqueTools,
  type PiBuiltinTool,
} from "./tools.js";

export {
  assembleBoundedContext,
  type AssembleBoundedContextInput,
  type BoundedContext,
} from "./context.js";

export { VIBEKIT_RUNTIME_INVARIANTS } from "./invariants.js";

export {
  REQUIRED_RUNTIME_ENV,
  filterEnvironment,
  type FilterEnvironmentInput,
  type FilteredEnvironment,
} from "./env.js";

export {
  RUN_EVENT_TYPES,
  createRunEvent,
  mapPiSessionEvent,
  redactEventData,
  type CreateRunEventInput,
  type PiSessionEvent,
  type RunEventType,
} from "./events.js";

export {
  collectResult,
  extractResultPayload,
  type CollectResultInput,
} from "./result.js";

export {
  adaptCustomTool,
  assistantTextDelta,
  createPiAgentSession,
  type CreatePiSession,
  type CreatePiSessionOptions,
  type PiCustomTool,
  type PiSession,
} from "./session.js";

export {
  OFFICIAL_PROVIDERS,
  openModelCatalog,
  probeProvider,
  secretNameForProvider,
  type CatalogModel,
  type CatalogProvider,
  type ModelCatalog,
  type ProviderProbeResult,
  type ProviderProbeStatus,
} from "./models-catalog.js";

export {
  closeConversationSession,
  createPersistentConversationSession,
  openPersistentConversationSession,
  runConversationTurn,
  type ConversationTurnInput,
  type ConversationTurnResult,
  type CreatePersistentSessionManager,
  type CreatePersistentSessionManagerInput,
  type PersistentConversationSessionOptions,
  type PersistentSession,
} from "./conversation.js";

export {
  authorizeToolCall,
  createGuardedBuiltinTools,
  guardCustomTool,
} from "./builtin-guard.js";
export { bindInstalledProjectTools } from "./installed-tools.js";
export type { BindInstalledToolsInput, BoundCustomTool } from "./installed-tools.js";

export {
  executeDelegation,
  openProjectState,
  prepareIsolatedRun,
  runIsolated,
  runManaged,
  type DelegationExecuteInput,
  type DelegationOutcome,
  type IsolatedRunInput,
  type IsolatedRunOutcome,
  type ManagedRunInput,
  type ManagedRunOutcome,
  type PreparedRun,
} from "./run.js";

export {
  AGENT_DELEGATE_DESCRIPTION,
  AGENT_DELEGATE_PARAMETERS,
  agentAllowsDelegation,
  agentDocumentOf,
  assertChildTaskAssignable,
  assertDelegationGraphAcyclic,
  createAgentDelegateTool,
  createChildTaskDocument,
  detectDelegationCycle,
  effectiveMaxDelegationDepth,
  loadDelegationTarget,
  parseDelegationRequest,
  projectAllowsDelegation,
  resolveChildTask,
  taskPermitsDelegation,
  validateDelegation,
  type ChildTaskDraft,
  type DelegationGraphContext,
  type DelegationRequest,
  type ValidatedDelegation,
} from "./delegate.js";

export {
  createWorktree,
  isGitRepository,
  isMutatingTask,
  listWorktrees,
  removeWorktree,
  resolveRepoRoot,
  shouldUseWorktree,
  worktreePathFor,
  type CreateWorktreeInput,
  type WorktreeRecord,
} from "./worktree.js";

export {
  ISOLATED_CHILD_PROTOCOL,
  planProcessIsolation,
  requiresProcessIsolation,
  runIsolatedProcess,
  spawnIsolatedProcess,
  type IsolatedChild,
  type PlanProcessIsolationInput,
  type ProcessIsolationPlan,
} from "./isolation.js";

export {
  createIdempotencyStore,
  idempotencyFileName,
  type IdempotencyRecord,
  type IdempotencyStore,
} from "./idempotency.js";

export {
  createConcurrencyPool,
  type ConcurrencyPool,
  type PoolLease,
} from "./pool.js";

export { evaluateVerification, reviewAfterRun, verifyAfterRun } from "./verify-hook.js";
