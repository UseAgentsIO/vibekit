import path from "node:path";

import {
  PI_RUNTIME_VERSION,
  VIBEKIT_VERSION,
  loadInstalledProviders,
  resolveEffectiveAuthority,
  satisfiesCompatibility,
  type AgentDocument,
  type ApprovalDocument,
  type AuthorizationMode,
  type EffectiveAuthority,
  type IsolationMode,
  type ModuleId,
  type PermissionGrant,
  type ProjectDocument,
  type SecretReference,
  type TaskDocument,
} from "@useagentsio/core";

import { configurationInvalid, fail } from "./fail.js";
import {
  loadProjectAgentConfig,
  resolveModel,
  usableModel,
  type ModelRef,
  type ResolvedModel,
} from "./model.js";
import { MUTATING_TOOLS, toolsForCapability, uniqueTools } from "./tools.js";

export const VIBEKIT_DEFAULT_TIMEOUT_MS = 600_000;
export const VIBEKIT_DEFAULT_ISOLATION: IsolationMode = "process";
export const VIBEKIT_DEFAULT_MAX_PARALLEL_RUNS = 4;
export const VIBEKIT_DEFAULT_MAX_DELEGATION_DEPTH = 2;
export const VIBEKIT_DEFAULT_ADAPTER = "@useagentsio/pi";

export interface EffectivePermissions {
  readonly allow: readonly PermissionGrant[];
  readonly deny: readonly PermissionGrant[];
}

export interface EffectiveConfiguration {
  readonly model: ResolvedModel;
  readonly isolation: IsolationMode;
  readonly timeoutMs: number;
  readonly cleanupRequired: boolean;
  readonly tools: readonly string[];
  readonly secrets: readonly SecretReference[];
  readonly capabilities: readonly string[];
  readonly capabilityBindings: Readonly<Record<string, ModuleId>>;
  readonly permissions: EffectivePermissions;
  readonly state: {
    readonly read: readonly string[];
    readonly write: readonly string[];
  };
  readonly verification: {
    readonly required: readonly ModuleId[];
    readonly independentReview: boolean;
  };
  readonly delegation: {
    readonly allowed: boolean;
    readonly targets: readonly string[];
    readonly maxDepth: number;
    readonly maxParallelChildren: number;
  };
  readonly authorization: AuthorizationMode;
  readonly adapter: string;
  readonly cwd: string;
  readonly maxParallelRuns: number;
  readonly maxDelegationDepth: number;
  readonly allowProjectOverride: boolean;
  readonly allowTaskOverride: boolean;
  readonly authority: EffectiveAuthority;
  readonly scheduledRun: boolean;
}

export interface ResolveEffectiveConfigurationInput {
  readonly projectRoot: string;
  readonly project: ProjectDocument;
  readonly agent: AgentDocument;
  readonly bindingName: string;
  readonly task: TaskDocument;
  readonly taskModel?: ModelRef;
  readonly projectAgentModel?: ModelRef;
  readonly componentSecrets?: readonly SecretReference[];
  readonly cwd?: string;
  readonly scheduledRun?: boolean;
  readonly approvals?: readonly ApprovalDocument[];
}

export function resolveEffectiveConfiguration(
  input: ResolveEffectiveConfigurationInput,
): EffectiveConfiguration {
  assertPiCompatibility(input.project, input.agent);

  const fragment = loadProjectAgentConfig(input.projectRoot, input.bindingName);
  const projectAllowsTaskOverride = fragment.allowTaskOverride !== false;
  const allowProjectOverride =
    fragment.allowProjectOverride ?? input.agent.model.allowProjectOverride;
  const allowTaskOverride = input.agent.model.allowTaskOverride && projectAllowsTaskOverride;

  const model = resolveModel({
    projectRoot: input.projectRoot,
    project: input.project,
    agent: input.agent,
    bindingName: input.bindingName,
    taskModel: input.taskModel,
    projectAgentModel: input.projectAgentModel ?? fragment.model,
    projectAllowsTaskOverride,
  });

  const isolation = tightenIsolation(
    input.project.execution.defaultIsolation,
    input.agent.execution.isolation,
  );
  const timeoutMs = Math.min(
    VIBEKIT_DEFAULT_TIMEOUT_MS,
    input.project.execution.defaultTimeoutMs,
    input.agent.execution.timeoutMs,
  );
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
    throw configurationInvalid("timeout_invalid", "Effective timeoutMs must be a positive integer", {
      timeoutMs,
    });
  }

  const authority = resolveEffectiveAuthority({
    project: input.project,
    agent: input.agent,
    task: input.task,
    installedProviders: loadInstalledProviders(input.projectRoot),
    scheduledRun: input.scheduledRun === true,
    approvals: input.approvals,
  });
  const capabilities = authority.capabilities;
  const capabilityBindings = authority.capabilityBindings;

  const permissions: EffectivePermissions = {
    allow: input.agent.permissions.allow,
    deny: input.agent.permissions.deny,
  };
  const tools = authority.builtinTools;

  const secrets = mergeSecrets(input.agent.secrets ?? [], input.componentSecrets ?? []);
  const verification = applyVerificationPolicy(input.project, input.agent);

  return {
    model,
    isolation,
    timeoutMs,
    cleanupRequired: input.agent.execution.cleanupRequired,
    tools,
    secrets,
    capabilities,
    capabilityBindings,
    permissions,
    state: {
      read: [...input.agent.state.read],
      write: [...input.agent.state.write],
    },
    verification,
    delegation: {
      allowed: false,
      targets: [],
      maxDepth: 0,
      maxParallelChildren: 0,
    },
    authorization: input.task.authorization.state,
    adapter: input.project.runtime?.adapter ?? VIBEKIT_DEFAULT_ADAPTER,
    cwd: path.resolve(input.cwd ?? path.resolve(input.projectRoot)),
    maxParallelRuns: input.project.execution.maxParallelRuns,
    maxDelegationDepth: Math.min(
      input.project.execution.maxDelegationDepth,
      input.agent.delegation.maxDepth,
    ),
    allowProjectOverride,
    allowTaskOverride,
    authority,
    scheduledRun: input.scheduledRun === true,
  };
}

export function resolveAllowlistedTools(input: {
  readonly capabilities: readonly string[];
  readonly permissions: EffectivePermissions;
  readonly authorization: AuthorizationMode;
}): readonly string[] {
  const denied = new Set(input.permissions.deny.map((grant) => grant.capability));
  const allowed = new Set(input.permissions.allow.map((grant) => grant.capability));
  const names: string[] = [];

  for (const capability of input.capabilities) {
    if (denied.has(capability) || !allowed.has(capability)) {
      continue;
    }
    names.push(...toolsForCapability(capability));
  }

  const uniqueNames = uniqueTools(names);
  if (input.authorization === "deny") {
    throw fail(
      "authorization_required",
      "task_authorization_denied",
      "Task authorization does not permit a Run",
      { authorization: input.authorization },
    );
  }
  if (input.authorization === "standing" || input.authorization === "explicit") {
    return uniqueNames;
  }
  throw fail(
    "authorization_required",
    "task_authorization_denied",
    "Task authorization does not permit a Run",
    { authorization: input.authorization },
  );
}

function applyVerificationPolicy(
  project: ProjectDocument,
  agent: AgentDocument,
): { readonly required: readonly ModuleId[]; readonly independentReview: boolean } {
  const required = uniqueModuleIds([
    ...agent.verification.required,
    ...project.verification.default,
  ]);
  if (project.policies.includes("policy:require-verification") && required.length === 0) {
    throw configurationInvalid(
      "verification_required",
      "Policy require-verification is active but no Verifiers are configured",
      { policies: project.policies },
    );
  }
  return {
    required,
    independentReview: agent.verification.independentReview,
  };
}

function assertPiCompatibility(project: ProjectDocument, agent: AgentDocument): void {
  const actual = { vibekit: VIBEKIT_VERSION, pi: PI_RUNTIME_VERSION };
  if (
    !satisfiesCompatibility({ vibekit: VIBEKIT_VERSION, pi: project.pi.compatibility }, actual)
  ) {
    throw fail(
      "compatibility_error",
      "pi_compatibility_unsatisfied",
      `Project Pi compatibility ${project.pi.compatibility} is not satisfied by ${PI_RUNTIME_VERSION}`,
      { declared: project.pi.compatibility, actual: PI_RUNTIME_VERSION },
    );
  }
  if (agent.compatibility !== undefined) {
    if (!satisfiesCompatibility(agent.compatibility, actual)) {
      throw fail(
        "compatibility_error",
        "agent_compatibility_unsatisfied",
        `Agent compatibility is not satisfied by this runtime`,
        { declared: agent.compatibility, actual },
      );
    }
  }
}

function tightenIsolation(project: IsolationMode, agent: IsolationMode): IsolationMode {
  return isolationRank(agent) >= isolationRank(project) ? agent : project;
}

function isolationRank(mode: IsolationMode): number {
  return mode === "worktree" ? 1 : 0;
}

function mergeSecrets(
  agentSecrets: readonly SecretReference[],
  componentSecrets: readonly SecretReference[],
): SecretReference[] {
  const merged: SecretReference[] = [];
  for (const secret of [...agentSecrets, ...componentSecrets]) {
    if (!merged.some((item) => item.name === secret.name)) {
      merged.push(secret);
    }
  }
  return merged;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function uniqueModuleIds(values: readonly ModuleId[]): ModuleId[] {
  return [...new Set(values)];
}

export function resolveProjectDefaultModel(project: ProjectDocument): ModelRef | undefined {
  return usableModel(project.defaults?.model);
}
