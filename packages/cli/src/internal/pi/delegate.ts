import {
  CURRENT_SCHEMA_VERSION,
  isRuntimeIdOf,
  type AgentDocument,
  type ModuleId,
  type ProjectDocument,
  type RuntimeId,
  type TaskDocument,
} from "../core/index.js";

import { loadAgentDocument, type LoadedAgent } from "./agent.js";
import { fail } from "./fail.js";
import { newRuntimeId } from "./ids.js";
import {
  AGENT_DELEGATE_TOOL,
  DELEGATE_CAPABILITY,
  hasDelegateCapability,
} from "./tools.js";

const TERMINAL_TASK_STATES = new Set(["accepted", "failed", "cancelled"]);
const DELEGATION_FORBIDDEN = new Set([
  "no-delegation",
  "delegation-forbidden",
  "delegation:deny",
]);

export interface DelegationRequest {
  readonly targetBinding: string;
  readonly objective: string;
  readonly context?: string | readonly string[];
  readonly constraints?: readonly string[];
  readonly expectedOutput?: string | readonly string[];
  readonly taskId?: RuntimeId | string;
  readonly milestones?: readonly string[];
}

export interface DelegationGraphContext {
  readonly project: ProjectDocument;
  readonly parentAgent: AgentDocument | LoadedAgent;
  readonly parentBinding: string;
  readonly parentTask: TaskDocument;
  readonly depth: number;
  readonly ancestorBindings?: readonly string[];
  readonly activeChildCount?: number;
}

export interface ValidatedDelegation {
  readonly parentBinding: string;
  readonly targetBinding: string;
  readonly targetDefinition: ModuleId;
  readonly depth: number;
  readonly childDepth: number;
  readonly maxDepth: number;
  readonly maxParallelChildren: number;
  readonly existingTaskId?: RuntimeId;
}

export interface ChildTaskDraft {
  readonly task: TaskDocument;
  readonly created: boolean;
}

export const AGENT_DELEGATE_DESCRIPTION =
  "Delegate a bounded Task to another Agent binding. The child receives only the supplied objective, context, constraints, and expected output — not the parent conversation.";

export const AGENT_DELEGATE_PARAMETERS = {
  type: "object",
  additionalProperties: false,
  required: ["targetBinding", "objective"],
  properties: {
    targetBinding: { type: "string", minLength: 1 },
    objective: { type: "string", minLength: 1 },
    context: {
      anyOf: [{ type: "string" }, { type: "array", items: { type: "string" } }],
    },
    constraints: { type: "array", items: { type: "string" } },
    expectedOutput: {
      anyOf: [{ type: "string" }, { type: "array", items: { type: "string" } }],
    },
    taskId: { type: "string" },
    milestones: { type: "array", items: { type: "string" } },
  },
} as const;

export function agentDocumentOf(agent: AgentDocument | LoadedAgent): AgentDocument {
  return "document" in agent ? agent.document : agent;
}

export function projectAllowsDelegation(
  project: ProjectDocument,
  parentBinding: string,
  targetBinding: string,
): boolean {
  const allowed = project.delegation[parentBinding];
  return Array.isArray(allowed) && allowed.includes(targetBinding);
}

export function agentAllowsDelegation(agent: AgentDocument, targetBinding: string): boolean {
  return (
    agent.delegation.allowed === true &&
    hasDelegateCapability(agent.capabilities.requires) &&
    agent.delegation.targets.includes(targetBinding)
  );
}

export function taskPermitsDelegation(task: TaskDocument): boolean {
  if (task.authorization.state === "deny") {
    return false;
  }
  if (TERMINAL_TASK_STATES.has(task.status)) {
    return false;
  }
  return !task.constraints.some((constraint) =>
    DELEGATION_FORBIDDEN.has(constraint.trim().toLowerCase()),
  );
}

export function effectiveMaxDelegationDepth(
  project: ProjectDocument,
  agent: AgentDocument,
): number {
  return Math.min(project.execution.maxDelegationDepth, agent.delegation.maxDepth);
}

export function detectDelegationCycle(input: {
  readonly parentBinding: string;
  readonly targetBinding: string;
  readonly ancestorBindings?: readonly string[];
  readonly graph: Readonly<Record<string, readonly string[]>>;
}): boolean {
  const { parentBinding, targetBinding, graph } = input;
  const ancestors = input.ancestorBindings ?? [];
  if (targetBinding === parentBinding || ancestors.includes(targetBinding)) {
    return true;
  }
  const forbidden = new Set([...ancestors, parentBinding]);
  const seen = new Set<string>();
  const stack = [...(graph[targetBinding] ?? [])];
  while (stack.length > 0) {
    const node = stack.pop();
    if (node === undefined || seen.has(node)) {
      continue;
    }
    if (forbidden.has(node)) {
      return true;
    }
    seen.add(node);
    stack.push(...(graph[node] ?? []));
  }
  return false;
}

export function assertDelegationGraphAcyclic(
  graph: Readonly<Record<string, readonly string[]>>,
): void {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (node: string, trail: string[]): void => {
    if (visited.has(node)) {
      return;
    }
    if (visiting.has(node)) {
      throw fail("conflict", "delegation_cycle", `Delegation graph contains a cycle`, {
        cycle: [...trail, node],
      });
    }
    visiting.add(node);
    for (const next of graph[node] ?? []) {
      visit(next, [...trail, node]);
    }
    visiting.delete(node);
    visited.add(node);
  };
  for (const node of Object.keys(graph)) {
    visit(node, []);
  }
}

export function parseDelegationRequest(input: unknown): DelegationRequest {
  if (input === null || typeof input !== "object") {
    throw fail(
      "invalid_input",
      "delegation_request_invalid",
      "agent_delegate requires an object payload",
    );
  }
  const value = input as Record<string, unknown>;
  if (typeof value.targetBinding !== "string" || value.targetBinding.trim().length === 0) {
    throw fail(
      "invalid_input",
      "delegation_target_missing",
      "agent_delegate requires targetBinding",
    );
  }
  if (typeof value.objective !== "string" || value.objective.trim().length === 0) {
    throw fail("invalid_input", "delegation_objective_missing", "agent_delegate requires objective");
  }
  const taskId = parseOptionalTaskId(value.taskId);
  return {
    targetBinding: value.targetBinding.trim(),
    objective: value.objective.trim(),
    context: parseStringOrList(value.context),
    constraints: parseStringList(value.constraints),
    expectedOutput: parseStringOrList(value.expectedOutput),
    taskId,
    milestones: parseStringList(value.milestones),
  };
}

export function validateDelegation(
  request: DelegationRequest,
  context: DelegationGraphContext,
): ValidatedDelegation {
  const parent = agentDocumentOf(context.parentAgent);
  const targetBinding = request.targetBinding.trim();
  if (targetBinding.length === 0) {
    throw fail(
      "invalid_input",
      "delegation_target_missing",
      "agent_delegate requires targetBinding",
    );
  }
  if (request.objective.trim().length === 0) {
    throw fail("invalid_input", "delegation_objective_missing", "agent_delegate requires objective");
  }

  if (!hasDelegateCapability(parent.capabilities.requires)) {
    throw fail(
      "permission_denied",
      "delegation_unauthorized",
      `Agent ${parent.id} does not have capability ${DELEGATE_CAPABILITY}`,
      { agentId: parent.id, capability: DELEGATE_CAPABILITY },
    );
  }
  if (parent.delegation.allowed !== true) {
    throw fail(
      "permission_denied",
      "delegation_unauthorized",
      `Agent ${parent.id} is not allowed to delegate`,
      { agentId: parent.id },
    );
  }
  const target = context.project.agentBindings[targetBinding];
  if (target === undefined) {
    throw fail(
      "dependency_missing",
      "delegation_target_missing",
      `Project has no Agent binding "${targetBinding}"`,
      { targetBinding, projectId: context.project.id },
    );
  }
  if (!parent.delegation.targets.includes(targetBinding)) {
    throw fail(
      "permission_denied",
      "delegation_unauthorized",
      `Agent ${parent.id} may not delegate to "${targetBinding}"`,
      { agentId: parent.id, targetBinding, allowed: parent.delegation.targets },
    );
  }
  if (!projectAllowsDelegation(context.project, context.parentBinding, targetBinding)) {
    throw fail(
      "permission_denied",
      "delegation_unauthorized",
      `Project does not allow ${context.parentBinding} → ${targetBinding}`,
      {
        parentBinding: context.parentBinding,
        targetBinding,
        allowed: context.project.delegation[context.parentBinding] ?? [],
      },
    );
  }
  if (!taskPermitsDelegation(context.parentTask)) {
    throw fail(
      "permission_denied",
      "delegation_task_forbidden",
      `Task ${context.parentTask.id} does not permit delegation`,
      { taskId: context.parentTask.id, status: context.parentTask.status },
    );
  }

  if (
    detectDelegationCycle({
      parentBinding: context.parentBinding,
      targetBinding,
      ancestorBindings: context.ancestorBindings,
      graph: context.project.delegation,
    })
  ) {
    throw fail(
      "conflict",
      "delegation_cycle",
      `Delegation cycle: ${[...(context.ancestorBindings ?? []), context.parentBinding, targetBinding].join(" → ")}`,
      {
        parentBinding: context.parentBinding,
        targetBinding,
        ancestors: context.ancestorBindings ?? [],
      },
    );
  }

  const maxDepth = effectiveMaxDelegationDepth(context.project, parent);
  if (context.depth >= maxDepth) {
    throw fail(
      "policy_blocked",
      "delegation_depth_exceeded",
      `Delegation depth ${context.depth} exceeds maximum ${maxDepth}`,
      { depth: context.depth, maxDepth },
    );
  }

  const maxParallelChildren = parent.delegation.maxParallelChildren;
  const active = context.activeChildCount ?? 0;
  if (active >= maxParallelChildren) {
    throw fail(
      "policy_blocked",
      "delegation_children_exceeded",
      `Agent already has ${active} active children (max ${maxParallelChildren})`,
      { active, maxParallelChildren },
    );
  }

  const existingTaskId = parseOptionalTaskId(request.taskId);
  return {
    parentBinding: context.parentBinding,
    targetBinding,
    targetDefinition: target.definition,
    depth: context.depth,
    childDepth: context.depth + 1,
    maxDepth,
    maxParallelChildren,
    existingTaskId,
  };
}

export function createChildTaskDocument(input: {
  readonly project: ProjectDocument;
  readonly request: DelegationRequest;
  readonly targetDefinition: ModuleId;
  readonly parentTask: TaskDocument;
  readonly now?: Date;
}): TaskDocument {
  const now = (input.now ?? new Date()).toISOString();
  const references = collectReferences(input.request);
  const constraints = [...(input.request.constraints ?? [])];
  const acceptanceCriteria = collectExpectedOutput(input.request);
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: input.request.taskId !== undefined && isRuntimeIdOf("task", input.request.taskId)
      ? (input.request.taskId as RuntimeId)
      : newRuntimeId("task"),
    projectId: input.project.id,
    objective: input.request.objective.trim(),
    context: { references },
    constraints,
    acceptanceCriteria,
    requiredCapabilities: [],
    assignedAgent: input.targetDefinition,
    claimedBy: null,
    scope: {
      paths: [...input.parentTask.scope.paths],
      resources: [...input.parentTask.scope.resources],
    },
    dependencies: [input.parentTask.id],
    priority: input.parentTask.priority,
    delivery: { mode: input.parentTask.delivery.mode },
    authorization: { state: input.parentTask.authorization.state === "deny" ? "deny" : "standing" },
    status: "open",
    revision: 1,
    createdAt: now,
    updatedAt: now,
  };
}

export function assertChildTaskAssignable(
  task: TaskDocument,
  targetDefinition: ModuleId,
  project: ProjectDocument,
): void {
  if (task.projectId !== project.id) {
    throw fail(
      "configuration_invalid",
      "task_project_mismatch",
      `Task ${task.id} belongs to ${task.projectId}, not ${project.id}`,
      { taskId: task.id, taskProjectId: task.projectId, projectId: project.id },
    );
  }
  if (task.assignedAgent !== null && task.assignedAgent !== targetDefinition) {
    throw fail(
      "configuration_invalid",
      "task_agent_mismatch",
      `Task ${task.id} is assigned to ${task.assignedAgent}, not ${targetDefinition}`,
      { taskId: task.id, assignedAgent: task.assignedAgent, targetDefinition },
    );
  }
  if (!taskPermitsDelegation(task) && task.authorization.state === "deny") {
    throw fail(
      "authorization_required",
      "task_authorization_denied",
      `Task ${task.id} is not authorized to run`,
      { taskId: task.id },
    );
  }
}

export function resolveChildTask(input: {
  readonly project: ProjectDocument;
  readonly request: DelegationRequest;
  readonly targetDefinition: ModuleId;
  readonly parentTask: TaskDocument;
  readonly existing?: TaskDocument;
  readonly now?: Date;
}): ChildTaskDraft {
  if (input.existing !== undefined) {
    assertChildTaskAssignable(input.existing, input.targetDefinition, input.project);
    return { task: input.existing, created: false };
  }
  return {
    task: createChildTaskDocument(input),
    created: true,
  };
}

export function createAgentDelegateTool<T>(runtime: {
  execute: (request: DelegationRequest) => Promise<T> | T;
}): {
  readonly name: typeof AGENT_DELEGATE_TOOL;
  readonly description: string;
  readonly parameters: typeof AGENT_DELEGATE_PARAMETERS;
  execute(input: unknown): Promise<T>;
} {
  return {
    name: AGENT_DELEGATE_TOOL,
    description: AGENT_DELEGATE_DESCRIPTION,
    parameters: AGENT_DELEGATE_PARAMETERS,
    async execute(input: unknown): Promise<T> {
      return runtime.execute(parseDelegationRequest(input));
    },
  };
}

export function loadDelegationTarget(input: {
  readonly projectRoot: string;
  readonly project: ProjectDocument;
  readonly targetBinding: string;
}): LoadedAgent {
  return loadAgentDocument({
    projectRoot: input.projectRoot,
    project: input.project,
    bindingName: input.targetBinding,
  });
}

function parseOptionalTaskId(value: unknown): RuntimeId | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (typeof value !== "string" || !isRuntimeIdOf("task", value)) {
    throw fail("invalid_input", "delegation_task_id_invalid", "taskId must be a Task runtime id", {
      taskId: value,
    });
  }
  return value as RuntimeId;
}

function parseStringList(value: unknown): readonly string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw fail("invalid_input", "delegation_request_invalid", "Expected a string array");
  }
  return value;
}

function parseStringOrList(value: unknown): string | readonly string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === "string") {
    return value;
  }
  return parseStringList(value);
}

function collectReferences(request: DelegationRequest): string[] {
  const references: string[] = [];
  if (typeof request.context === "string" && request.context.trim().length > 0) {
    references.push(request.context.trim());
  } else if (Array.isArray(request.context)) {
    references.push(...request.context);
  }
  if (request.milestones) {
    for (const milestone of request.milestones) {
      references.push(`milestone: ${milestone}`);
    }
  }
  return references;
}

function collectExpectedOutput(request: DelegationRequest): string[] {
  if (request.expectedOutput === undefined) {
    return [];
  }
  if (typeof request.expectedOutput === "string") {
    return request.expectedOutput.trim().length > 0 ? [request.expectedOutput.trim()] : [];
  }
  return [...request.expectedOutput];
}
