import { VibeKitError } from "./errors.js";
import { readInstalledManifest } from "./installed.js";
import type { ModuleId } from "./ids.js";
import { resolveInstalledModule } from "./registry-source.js";
import { findMatchingApproval } from "./approval-gate.js";
import {
  assertCommandInScope,
  assertPathInScope,
  assertResourceInScope,
  intersectScopes,
} from "./scope.js";
import type {
  AgentDocument,
  ApprovalDocument,
  AuthorizationMode,
  InstalledManifestDocument,
  PermissionGrant,
  PermissionScope,
  ProjectDocument,
  RuntimeKind,
  TaskDocument,
} from "./types.js";
import {
  assertCapabilityResolved,
  resolveRequiredCapabilities,
  type CapabilityProvider,
} from "./capabilities.js";

export const DELEGATE_CAPABILITY = "agent.delegate";

/** Capabilities that are Host/Pi runtime features, not Component-provided Tools. */
export const NON_MODULE_CAPABILITIES: ReadonlySet<string> = new Set([DELEGATE_CAPABILITY]);

export const CAPABILITY_BUILTIN_TOOLS: Readonly<Record<string, readonly string[]>> = {
  "source.read": ["read", "grep", "find", "ls"],
  "source.write": ["write", "edit"],
  "command.execute": ["bash"],
  [DELEGATE_CAPABILITY]: ["agent_delegate"],
};

export const BUILTIN_TOOL_CAPABILITIES: Readonly<Record<string, string>> = {
  read: "source.read",
  grep: "source.read",
  find: "source.read",
  ls: "source.read",
  write: "source.write",
  edit: "source.write",
  bash: "command.execute",
  agent_delegate: DELEGATE_CAPABILITY,
};

export const MUTATING_CAPABILITIES: ReadonlySet<string> = new Set([
  "source.write",
  "command.execute",
  "memory.write",
  "schedule.write",
  "deploy.apply",
  "destructive.delete",
  "project.configure",
  "module.install",
  "repository.write",
  "repository.issue.write",
]);

export interface InstalledCapabilityProvider extends CapabilityProvider {
  readonly type: string;
  readonly runtimeKind?: RuntimeKind;
}

export interface AuthorityContext {
  readonly project: ProjectDocument;
  readonly agent: AgentDocument;
  readonly task: TaskDocument;
  readonly installedProviders: readonly InstalledCapabilityProvider[];
  readonly scheduledRun?: boolean;
  readonly approvals?: readonly ApprovalDocument[];
}

export interface EffectiveGrant {
  readonly capability: string;
  readonly provider?: ModuleId;
  readonly scope: PermissionScope;
  readonly authorization: AuthorizationMode;
}

export interface EffectiveAuthority {
  readonly capabilities: readonly string[];
  readonly grants: Readonly<Record<string, EffectiveGrant>>;
  readonly capabilityBindings: Readonly<Record<string, ModuleId>>;
  readonly toolModuleIds: readonly ModuleId[];
  readonly builtinTools: readonly string[];
}

export interface ToolInvocation {
  readonly capability: string;
  readonly action: string;
  readonly target: string;
  readonly toolName?: string;
  readonly moduleId?: ModuleId;
  readonly requestedScope?: Readonly<Record<string, unknown>>;
}

export function resolveEffectiveAuthority(input: AuthorityContext): EffectiveAuthority {
  const deniedByAgent = new Set(input.agent.permissions.deny.map((grant) => grant.capability));
  const allowByCapability = new Map<string, PermissionGrant>();
  for (const grant of input.agent.permissions.allow) {
    if (!allowByCapability.has(grant.capability)) {
      allowByCapability.set(grant.capability, grant);
    }
  }

  let requested = unique(input.agent.capabilities.requires);
  if (input.task.requiredCapabilities.length > 0) {
    const taskSet = new Set(input.task.requiredCapabilities);
    const missing = input.task.requiredCapabilities.filter((capability) => !requested.includes(capability));
    if (missing.length > 0) {
      throw new VibeKitError({
        category: "permission_denied",
        code: "task_capability_ungranted",
        message: `Task requires capabilities the Agent does not grant: ${missing.join(", ")}`,
        details: { missing, granted: requested },
      });
    }
    requested = requested.filter((capability) => taskSet.has(capability));
  }

  const remaining: string[] = [];
  for (const capability of requested) {
    if (deniedByAgent.has(capability)) {
      continue;
    }
    if (!allowByCapability.has(capability)) {
      continue;
    }
    remaining.push(capability);
  }

  const afterPolicy = applyRuntimePolicies(remaining, input);

  const resolutions = resolveRequiredCapabilities(afterPolicy, {
    projectBindings: input.project.capabilityBindings,
    installedProviders: input.installedProviders,
  });

  const capabilities: string[] = [];
  const grants: Record<string, EffectiveGrant> = {};
  const capabilityBindings: Record<string, ModuleId> = {};
  const toolModuleIds: ModuleId[] = [];
  const builtinTools: string[] = [];

  for (const resolution of resolutions) {
    const mode = authorizationModeFor(input.project, resolution.capability, input.task.authorization.state);
    if (mode === "deny") {
      continue;
    }
    const agentGrant = allowByCapability.get(resolution.capability);
    const scope = intersectScopes(agentGrant?.scope, input.task.scope, resolution.capability);

    if (NON_MODULE_CAPABILITIES.has(resolution.capability)) {
      if (resolution.status === "resolved") {
        capabilityBindings[resolution.capability] = resolution.provider;
      }
      capabilities.push(resolution.capability);
      grants[resolution.capability] = {
        capability: resolution.capability,
        ...(resolution.status === "resolved" ? { provider: resolution.provider } : {}),
        scope,
        authorization: mode,
      };
      builtinTools.push(...(CAPABILITY_BUILTIN_TOOLS[resolution.capability] ?? []));
      continue;
    }

    const providerId = assertCapabilityResolved(resolution);
    const provider = input.installedProviders.find((item) => item.id === providerId);
    if (provider === undefined || !provider.capabilities.includes(resolution.capability)) {
      throw new VibeKitError({
        category: "dependency_missing",
        code: "capability_provider_invalid",
        message: `${providerId} does not provide ${resolution.capability}`,
        details: { capability: resolution.capability, provider: providerId },
      });
    }
    capabilities.push(resolution.capability);
    capabilityBindings[resolution.capability] = providerId;
    grants[resolution.capability] = {
      capability: resolution.capability,
      provider: providerId,
      scope,
      authorization: mode,
    };
    if (provider.type === "tool") {
      toolModuleIds.push(providerId);
    }
    if (provider.runtimeKind === "pi-builtin") {
      builtinTools.push(...(CAPABILITY_BUILTIN_TOOLS[resolution.capability] ?? []));
    }
  }

  return {
    capabilities: unique(capabilities),
    grants,
    capabilityBindings,
    toolModuleIds: uniqueModuleIds(toolModuleIds).filter((id) => {
      const provider = input.installedProviders.find((item) => item.id === id);
      return provider?.runtimeKind !== "pi-builtin";
    }),
    builtinTools: unique(builtinTools),
  };
}

export function authorizeInvocation(input: {
  readonly authority: EffectiveAuthority;
  readonly invocation: ToolInvocation;
  readonly project: ProjectDocument;
  readonly task: TaskDocument;
  readonly approvals?: readonly ApprovalDocument[];
  readonly now?: Date;
}): void {
  const grant = input.authority.grants[input.invocation.capability];
  if (grant === undefined) {
    throw new VibeKitError({
      category: "permission_denied",
      code: "capability_not_granted",
      message: `Capability ${input.invocation.capability} is not in the effective grant set`,
      details: {
        capability: input.invocation.capability,
        action: input.invocation.action,
        target: input.invocation.target,
      },
    });
  }
  if (input.invocation.moduleId !== undefined && grant.provider !== undefined) {
    if (input.invocation.moduleId !== grant.provider) {
      throw new VibeKitError({
        category: "permission_denied",
        code: "tool_not_granted",
        message: `${input.invocation.moduleId} is not the bound provider for ${input.invocation.capability}`,
        details: {
          moduleId: input.invocation.moduleId,
          provider: grant.provider,
          capability: input.invocation.capability,
        },
      });
    }
  }

  const capability = input.invocation.capability;
  if (capability === "source.read" || capability === "source.write") {
    assertPathInScope(input.invocation.target, grant.scope, capability);
  } else if (capability === "command.execute") {
    assertCommandInScope(input.invocation.target, grant.scope, capability);
  } else {
    assertResourceInScope(input.invocation.target, grant.scope, capability);
    if (grant.scope.branches !== undefined && grant.scope.branches.length > 0) {
      const branch = stringField(input.invocation.requestedScope, "branch");
      if (branch !== undefined && !grant.scope.branches.includes(branch) && !grant.scope.branches.includes("*")) {
        throw new VibeKitError({
          category: "permission_denied",
          code: "resource_not_in_scope",
          message: `Branch ${branch} is outside the effective grant for ${capability}`,
          details: { branch, capability, branches: grant.scope.branches },
        });
      }
    }
  }

  if (grant.authorization === "standing") {
    return;
  }
  if (grant.authorization === "deny") {
    throw new VibeKitError({
      category: "authorization_required",
      code: "authorization_denied",
      message: `Authorization denies ${input.invocation.action} on ${input.invocation.target}`,
      details: {
        action: input.invocation.action,
        target: input.invocation.target,
        capability: input.invocation.capability,
      },
    });
  }

  const match = findMatchingApproval({
    approvals: input.approvals ?? [],
    action: input.invocation.action,
    target: input.invocation.target,
    scope: input.invocation.requestedScope ?? scopeAsRecord(grant.scope),
    taskId: input.task.id,
    now: input.now,
  });
  if (match === undefined) {
    throw new VibeKitError({
      category: "authorization_required",
      code: "approval_required",
      message: `Explicit Approval is required for ${input.invocation.action} on ${input.invocation.target}`,
      details: {
        action: input.invocation.action,
        target: input.invocation.target,
        capability: input.invocation.capability,
      },
    });
  }
}

export function invocationFromToolCall(input: {
  readonly toolName: string;
  readonly args: unknown;
  readonly authority: EffectiveAuthority;
  readonly moduleId?: ModuleId;
}): ToolInvocation {
  const builtinCapability = BUILTIN_TOOL_CAPABILITIES[input.toolName];
  if (builtinCapability !== undefined) {
    return {
      capability: builtinCapability,
      action: invocationAction(input.authority.grants[builtinCapability]?.provider, builtinCapability),
      target: targetFromArgs(builtinCapability, input.args),
      toolName: input.toolName,
      moduleId: input.moduleId ?? input.authority.grants[builtinCapability]?.provider,
      requestedScope: requestedScopeFromArgs(builtinCapability, input.args),
    };
  }

  const fromModule = input.moduleId !== undefined
    ? Object.values(input.authority.grants).filter((grant) => grant.provider === input.moduleId)
    : [];
  const capability =
    capabilityFromArgs(input.args, fromModule.map((grant) => grant.capability)) ??
    fromModule[0]?.capability;
  if (capability === undefined) {
    throw new VibeKitError({
      category: "permission_denied",
      code: "capability_not_granted",
      message: `Tool ${input.toolName} is not bound to an effective capability`,
      details: { toolName: input.toolName, moduleId: input.moduleId },
    });
  }
  return {
    capability,
    action: invocationAction(input.moduleId ?? input.authority.grants[capability]?.provider, capability),
    target: targetFromArgs(capability, input.args),
    toolName: input.toolName,
    moduleId: input.moduleId ?? input.authority.grants[capability]?.provider,
    requestedScope: requestedScopeFromArgs(capability, input.args),
  };
}

export function providersFromInstalled(
  manifest: InstalledManifestDocument,
  load: (id: ModuleId, version: string) => InstalledCapabilityProvider | undefined,
): InstalledCapabilityProvider[] {
  const providers: InstalledCapabilityProvider[] = [];
  for (const record of manifest.modules) {
    const provider = load(record.id, record.version);
    if (provider !== undefined && provider.capabilities.length > 0) {
      providers.push(provider);
    }
  }
  return providers;
}

export function loadInstalledProviders(projectRoot: string): InstalledCapabilityProvider[] {
  let manifest: InstalledManifestDocument;
  try {
    manifest = readInstalledManifest(projectRoot);
  } catch {
    return [];
  }
  return providersFromInstalled(manifest, (id, version) => {
    const record = manifest.modules.find((module) => module.id === id && module.version === version);
    if (record === undefined) {
      return undefined;
    }
    try {
      const loaded = resolveInstalledModule(record);
      const runtimeKind =
        loaded.document.type === "agent" ? undefined : loaded.document.runtime?.kind;
      return {
        id: loaded.id,
        capabilities: loaded.providesCapabilities,
        type: loaded.type,
        runtimeKind,
      };
    } catch {
      return undefined;
    }
  });
}

function applyRuntimePolicies(capabilities: readonly string[], input: AuthorityContext): string[] {
  const policies = new Set(input.project.policies);
  let next = [...capabilities];
  if (policies.has("policy:schedule-no-recurse") && input.scheduledRun === true) {
    next = next.filter((capability) => capability !== "schedule.read" && capability !== "schedule.write");
  }
  if (policies.has("policy:memory-write-approval")) {
    // Keep memory.write in the set; authorizeInvocation requires an exact Approval.
  }
  return next;
}

function authorizationModeFor(
  project: ProjectDocument,
  capability: string,
  taskMode: AuthorizationMode,
): AuthorizationMode {
  if (taskMode === "deny") {
    return "deny";
  }
  if (project.policies.includes("policy:memory-write-approval") && capability === "memory.write") {
    return "explicit";
  }
  const declared = project.authorization.actions[capability];
  if (declared !== undefined) {
    if (taskMode === "explicit" && declared === "standing") {
      return "explicit";
    }
    return declared;
  }
  if (taskMode === "explicit") {
    return "explicit";
  }
  return project.authorization.default;
}

function invocationAction(provider: ModuleId | undefined, capability: string): string {
  return provider !== undefined ? `${provider} / ${capability}` : capability;
}

function targetFromArgs(capability: string, args: unknown): string {
  const record = isRecord(args) ? args : {};
  if (capability === "source.read" || capability === "source.write") {
    return (
      stringField(record, "path") ??
      stringField(record, "file_path") ??
      stringField(record, "target") ??
      ""
    );
  }
  if (capability === "command.execute") {
    return stringField(record, "command") ?? stringField(record, "cmd") ?? "";
  }
  if (capability.startsWith("schedule.")) {
    return (
      stringField(record, "id") ??
      stringField(record, "jobId") ??
      stringField(record, "target") ??
      stringField(record, "action") ??
      ""
    );
  }
  if (capability.startsWith("repository.")) {
    const repo = stringField(record, "repo") ?? stringField(record, "repository") ?? "";
    const branch = stringField(record, "branch");
    return branch !== undefined && repo.length > 0 ? `${repo} / ${branch}` : repo;
  }
  if (capability === DELEGATE_CAPABILITY) {
    return stringField(record, "target") ?? stringField(record, "agent") ?? "";
  }
  return (
    stringField(record, "target") ??
    stringField(record, "path") ??
    stringField(record, "id") ??
    stringField(record, "resource") ??
    ""
  );
}

function requestedScopeFromArgs(
  capability: string,
  args: unknown,
): Readonly<Record<string, unknown>> {
  const record = isRecord(args) ? args : {};
  const scope: Record<string, unknown> = {};
  const path = stringField(record, "path") ?? stringField(record, "file_path");
  const command = stringField(record, "command") ?? stringField(record, "cmd");
  const resource =
    stringField(record, "id") ??
    stringField(record, "jobId") ??
    stringField(record, "repo") ??
    stringField(record, "resource");
  const branch = stringField(record, "branch");
  if (path !== undefined) {
    scope.path = path;
  }
  if (command !== undefined) {
    scope.command = command;
  }
  if (resource !== undefined) {
    scope.resource = resource;
  }
  if (branch !== undefined) {
    scope.branch = branch;
  }
  scope.capability = capability;
  return scope;
}

function capabilityFromArgs(args: unknown, candidates: readonly string[]): string | undefined {
  const record = isRecord(args) ? args : {};
  const declared = stringField(record, "capability") ?? stringField(record, "action");
  if (declared !== undefined && candidates.includes(declared)) {
    return declared;
  }
  if (declared === "write" && candidates.includes("schedule.write")) {
    return "schedule.write";
  }
  if (declared === "read" && candidates.includes("schedule.read")) {
    return "schedule.read";
  }
  const mutating = candidates.find((capability) => MUTATING_CAPABILITIES.has(capability));
  if (mutating !== undefined && (declared === "write" || declared === "create" || declared === "update" || declared === "delete")) {
    return mutating;
  }
  return candidates[0];
}

function scopeAsRecord(scope: PermissionScope): Record<string, unknown> {
  return {
    ...(scope.paths !== undefined ? { paths: [...scope.paths] } : {}),
    ...(scope.commands !== undefined ? { commands: [...scope.commands] } : {}),
    ...(scope.resources !== undefined ? { resources: [...scope.resources] } : {}),
    ...(scope.branches !== undefined ? { branches: [...scope.branches] } : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringField(record: Readonly<Record<string, unknown>> | undefined, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function unique(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (!seen.has(value)) {
      seen.add(value);
      result.push(value);
    }
  }
  return result;
}

function uniqueModuleIds(values: readonly ModuleId[]): ModuleId[] {
  return unique(values) as ModuleId[];
}

export function pairingRequired(project: ProjectDocument): boolean {
  return project.policies.includes("policy:interface-pairing");
}

export function inboundIsUntrusted(project: ProjectDocument): boolean {
  return project.policies.includes("policy:untrusted-inbound");
}
