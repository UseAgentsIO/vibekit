import path from "node:path";

import {
  createRepositoryState,
  isVibeKitError,
  type ApprovalDocument,
  type ClaimRecord,
  type DecisionDocument,
  type EventDocument,
  type ProjectDocument,
  type RepositoryState,
  type ResultDocument,
  type RunState,
  type RuntimeId,
  type SecretReference,
  type StructuredFailure,
  type TaskDocument,
} from "@useagentsio/core";

import { loadAgentDocument, type LoadedAgent } from "./agent.js";
import { assembleBoundedContext, type BoundedContext } from "./context.js";
import {
  resolveEffectiveConfiguration,
  type EffectiveConfiguration,
} from "./config.js";
import {
  createChildTaskDocument,
  loadDelegationTarget,
  resolveChildTask,
  validateDelegation,
  type DelegationGraphContext,
  type DelegationRequest,
  type ValidatedDelegation,
} from "./delegate.js";
import { filterEnvironment, type FilteredEnvironment } from "./env.js";
import { createRunEvent, mapPiSessionEvent, type PiSessionEvent } from "./events.js";
import { fail } from "./fail.js";
import { createIdempotencyStore, type IdempotencyRecord, type IdempotencyStore } from "./idempotency.js";
import { newRuntimeId } from "./ids.js";
import {
  planProcessIsolation,
  requiresProcessIsolation,
  type ProcessIsolationPlan,
} from "./isolation.js";
import type { ModelRef } from "./model.js";
import { createConcurrencyPool, type ConcurrencyPool, type PoolLease } from "./pool.js";
import { resolveProjectDocument } from "./project.js";
import { collectResult } from "./result.js";
import {
  createPiAgentSession,
  type CreatePiSession,
  type PiCustomTool,
  type PiSession,
} from "./session.js";
import {
  assertRequiredTaskInputs,
  assertTaskAssignedAgent,
  assertTaskAuthorization,
  assertTaskMatchesProject,
  resolveTaskDocument,
} from "./task.js";
import { createGuardedBuiltinTools, guardCustomTool } from "./builtin-guard.js";
import { bindInstalledProjectTools } from "./installed-tools.js";
import { AGENT_DELEGATE_TOOL, registerDelegateTool } from "./tools.js";
import {
  createWorktree,
  isGitRepository,
  isMutatingTask,
  removeWorktree,
  shouldUseWorktree,
  type WorktreeRecord,
} from "./worktree.js";

export interface IsolatedRunInput {
  readonly projectRoot: string;
  readonly bindingName: string;
  readonly task: TaskDocument | string;
  readonly project?: ProjectDocument;
  readonly agent?: LoadedAgent;
  readonly agentPath?: string;
  readonly decisions?: readonly DecisionDocument[];
  readonly componentSecrets?: readonly SecretReference[];
  readonly taskModel?: ModelRef;
  readonly projectAgentModel?: ModelRef;
  readonly extraEnv?: Readonly<Record<string, string>>;
  readonly env?: NodeJS.ProcessEnv;
  readonly cwd?: string;
  readonly runId?: RuntimeId;
  readonly signal?: AbortSignal;
  readonly now?: Date;
  readonly scheduledRun?: boolean;
  readonly approvals?: readonly ApprovalDocument[];
  readonly allowUnfilteredCustomTools?: boolean;
  readonly createSession?: CreatePiSession;
  readonly state?: RepositoryState;
  readonly pool?: ConcurrencyPool;
  readonly idempotency?: IdempotencyStore;
  readonly idempotencyKey?: string;
  readonly exclusive?: boolean;
  readonly isolateWorktree?: boolean;
  readonly isolateProcess?: boolean;
  readonly depth?: number;
  readonly ancestorBindings?: readonly string[];
  readonly activeChildCount?: number;
  readonly customTools?: readonly PiCustomTool[];
  readonly onTextDelta?: (text: string) => void | Promise<void>;
  readonly allowNetwork?: boolean;
}

export interface ManagedRunInput extends IsolatedRunInput {}

export interface ManagedRunOutcome {
  readonly runId: RuntimeId;
  readonly status: IsolatedRunOutcome["status"] | "duplicate";
  readonly duplicate: boolean;
  readonly events: readonly EventDocument[];
  readonly result?: ResultDocument;
  readonly configuration?: EffectiveConfiguration;
  readonly context?: BoundedContext;
  readonly environment?: FilteredEnvironment;
  readonly failure?: StructuredFailure;
  readonly claim?: ClaimRecord;
  readonly worktree?: WorktreeRecord;
  readonly isolationPlan?: ProcessIsolationPlan;
  readonly existing?: IdempotencyRecord;
  readonly lease?: PoolLease;
}

export interface DelegationExecuteInput extends DelegationGraphContext {
  readonly projectRoot: string;
  readonly createSession?: CreatePiSession;
  readonly state?: RepositoryState;
  readonly pool?: ConcurrencyPool;
  readonly existingTask?: TaskDocument;
  readonly env?: NodeJS.ProcessEnv;
  readonly extraEnv?: Readonly<Record<string, string>>;
  readonly signal?: AbortSignal;
  readonly now?: Date;
  readonly scheduledRun?: boolean;
  readonly approvals?: readonly ApprovalDocument[];
  readonly componentSecrets?: readonly SecretReference[];
  readonly taskModel?: ModelRef;
  readonly projectAgentModel?: ModelRef;
}

export interface DelegationOutcome {
  readonly request: DelegationRequest;
  readonly validated: ValidatedDelegation;
  readonly childTask: TaskDocument;
  readonly child: ManagedRunOutcome;
}

export interface PreparedRun {
  readonly project: ProjectDocument;
  readonly agent: LoadedAgent;
  readonly task: TaskDocument;
  readonly configuration: EffectiveConfiguration;
  readonly context: BoundedContext;
  readonly environment: FilteredEnvironment;
  readonly runId: RuntimeId;
}

export interface IsolatedRunOutcome {
  readonly runId: RuntimeId;
  readonly status: Extract<RunState, "completed" | "failed" | "cancelled" | "timed_out">;
  readonly events: readonly EventDocument[];
  readonly result: ResultDocument;
  readonly configuration: EffectiveConfiguration;
  readonly context: BoundedContext;
  readonly environment: FilteredEnvironment;
  readonly failure?: StructuredFailure;
}

export function prepareIsolatedRun(input: IsolatedRunInput): PreparedRun {
  const project = resolveProjectDocument(input.projectRoot, input.project);
  const agent =
    input.agent ??
    loadAgentDocument({
      projectRoot: input.projectRoot,
      project,
      bindingName: input.bindingName,
      agentPath: input.agentPath,
    });
  const task = resolveTaskDocument(input.task);

  assertTaskMatchesProject(task, project);
  assertTaskAssignedAgent(task, agent.definition);
  assertRequiredTaskInputs(task, agent.document);
  assertTaskAuthorization(task);

  const configuration = resolveEffectiveConfiguration({
    projectRoot: input.projectRoot,
    project,
    agent: agent.document,
    bindingName: input.bindingName,
    task,
    taskModel: input.taskModel,
    projectAgentModel: input.projectAgentModel,
    componentSecrets: input.componentSecrets,
    cwd: input.cwd,
    scheduledRun: input.scheduledRun === true,
    approvals: input.approvals,
  });

  const context = assembleBoundedContext({
    project,
    agent,
    task,
    configuration,
    decisions: input.decisions,
  });

  const environment = filterEnvironment({
    secrets: configuration.secrets,
    source: input.env,
    extra: input.extraEnv,
  });

  return {
    project,
    agent,
    task,
    configuration,
    context,
    environment,
    runId: input.runId ?? newRuntimeId("run"),
  };
}

export async function runIsolated(input: IsolatedRunInput): Promise<IsolatedRunOutcome> {
  const prepared = prepareIsolatedRun(input);
  const events: EventDocument[] = [];
  const actor = prepared.agent.document.id;
  const now = () => input.now ?? new Date();
  const emit = (
    type: Parameters<typeof createRunEvent>[0]["type"],
    data?: Readonly<Record<string, unknown>>,
  ): EventDocument => {
    const event = createRunEvent({
      type,
      projectId: prepared.project.id,
      taskId: prepared.task.id,
      runId: prepared.runId,
      actor,
      timestamp: now(),
      data,
    });
    events.push(event);
    return event;
  };

  emit("run.created", {
    binding: prepared.agent.bindingName,
    agentId: prepared.agent.document.id,
    model: {
      provider: prepared.configuration.model.provider,
      id: prepared.configuration.model.id,
      source: prepared.configuration.model.source,
    },
    tools: prepared.configuration.tools,
    isolation: prepared.configuration.isolation,
  });

  const createSession = input.createSession ?? createPiAgentSession;
  let session: PiSession | undefined;
  let disposed = false;
  let assistantText = "";
  let unsubscribe: (() => void) | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let stop: ((reason: "timeout" | "cancel") => void) | undefined;
  let stopReason: "timeout" | "cancel" | undefined;

  const disposeSession = (): boolean => {
    if (session === undefined || disposed) {
      return true;
    }
    disposed = true;
    try {
      session.dispose();
      return true;
    } catch {
      return false;
    }
  };

  const requestStop = (reason: "timeout" | "cancel"): void => {
    if (stopReason === undefined) {
      stopReason = reason;
      stop?.(reason);
    }
    void session?.abort();
  };

  const onAbort = (): void => {
    requestStop("cancel");
  };

  input.signal?.addEventListener("abort", onAbort, { once: true });

  try {
    if (input.signal?.aborted) {
      emit("run.cancelled", { reason: "aborted-before-start" });
      return finish("cancelled", prepared, events, assistantText, now(), ["run-cancelled"]);
    }

    const runTools = await resolveRunTools(input, prepared);
    session = await createSession({
      cwd: prepared.configuration.cwd,
      tools: prepared.configuration.tools,
      customTools: runTools,
      systemPrompt: systemPromptForTools(
        prepared.context.systemPrompt,
        prepared.configuration.tools,
      ),
      model: prepared.configuration.model,
      allowNetwork: input.allowNetwork,
      onTextDelta: input.onTextDelta,
    });

    if (stopReason === "cancel" || input.signal?.aborted) {
      emit("run.cancelled", { reason: "signal" });
      return ended("cancelled", prepared, events, assistantText, now(), disposeSession(), {
        category: "cancelled",
        code: "run_cancelled",
        message: "Run was cancelled",
      });
    }

    unsubscribe = session.subscribe((event: PiSessionEvent) => {
      assistantText += collectAssistantDelta(event);
      const mapped = mapPiSessionEvent(event, {
        projectId: prepared.project.id,
        taskId: prepared.task.id,
        runId: prepared.runId,
        actor,
        timestamp: now(),
      });
      if (mapped !== undefined) {
        events.push(mapped);
      }
    });

    emit("run.started", { cwd: prepared.configuration.cwd });

    const stopped = new Promise<"timeout" | "cancel">((resolve) => {
      stop = resolve;
    });
    if (stopReason !== undefined) {
      stop?.(stopReason);
    }
    timeout = setTimeout(() => {
      requestStop("timeout");
    }, prepared.configuration.timeoutMs);

    try {
      await Promise.race([session.prompt(prepared.context.userPrompt), stopped]);
    } catch (error) {
      if (stopReason === undefined) {
        const failure = toFailure(error);
        emit("run.failed", { category: failure.category, code: failure.code });
        disposeSession();
        return finish("failed", prepared, events, assistantText, now(), [failure.code], failure);
      }
    }

    if (stopReason === "timeout") {
      emit("run.timed_out", { timeoutMs: prepared.configuration.timeoutMs });
      return ended("timed_out", prepared, events, assistantText, now(), disposeSession(), {
        category: "timed_out",
        code: "run_timed_out",
        message: "Run exceeded timeoutMs",
        details: { timeoutMs: prepared.configuration.timeoutMs },
      });
    }

    if (stopReason === "cancel") {
      emit("run.cancelled", { reason: "signal" });
      return ended("cancelled", prepared, events, assistantText, now(), disposeSession(), {
        category: "cancelled",
        code: "run_cancelled",
        message: "Run was cancelled",
      });
    }

    emit("run.completed", {});
    const cleanupOk = disposeSession();
    if (!cleanupOk && prepared.configuration.cleanupRequired) {
      return finish(
        "failed",
        prepared,
        events,
        assistantText,
        now(),
        ["cleanup-failed"],
        {
          category: "cleanup_failed",
          code: "cleanup_failed",
          message: "Required session cleanup failed after completion",
        },
        "failed",
      );
    }
    return finish("completed", prepared, events, assistantText, now());
  } catch (error) {
    if (stopReason === "timeout") {
      emit("run.timed_out", { timeoutMs: prepared.configuration.timeoutMs });
      disposeSession();
      return finish("timed_out", prepared, events, assistantText, now(), ["run-timed-out"], {
        category: "timed_out",
        code: "run_timed_out",
        message: "Run exceeded timeoutMs",
        details: { timeoutMs: prepared.configuration.timeoutMs },
      });
    }
    if (stopReason === "cancel" || input.signal?.aborted) {
      emit("run.cancelled", { reason: "signal" });
      disposeSession();
      return finish("cancelled", prepared, events, assistantText, now(), ["run-cancelled"], {
        category: "cancelled",
        code: "run_cancelled",
        message: "Run was cancelled",
      });
    }
    const failure = toFailure(error);
    emit("run.failed", { category: failure.category, code: failure.code });
    disposeSession();
    return finish("failed", prepared, events, assistantText, now(), [failure.code], failure);
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
    unsubscribe?.();
    input.signal?.removeEventListener("abort", onAbort);
    disposeSession();
  }
}

function ended(
  status: Extract<IsolatedRunOutcome["status"], "cancelled" | "timed_out">,
  prepared: PreparedRun,
  events: EventDocument[],
  assistantText: string,
  createdAt: Date,
  cleanupOk: boolean,
  failure: StructuredFailure,
): IsolatedRunOutcome {
  const issues = [status === "timed_out" ? "run-timed-out" : "run-cancelled"];
  if (!cleanupOk) {
    issues.push("cleanup-failed");
  }
  return finish(
    status,
    prepared,
    events,
    assistantText,
    createdAt,
    issues,
    cleanupOk
      ? failure
      : {
          category: "cleanup_failed",
          code: "cleanup_failed",
          message: `Required session cleanup failed after ${status}`,
        },
  );
}

function finish(
  status: IsolatedRunOutcome["status"],
  prepared: PreparedRun,
  events: EventDocument[],
  assistantText: string,
  createdAt: Date,
  unresolvedIssues?: readonly string[],
  failure?: StructuredFailure,
  resultStatus: ResultDocument["status"] = status === "completed" ? "completed" : "failed",
): IsolatedRunOutcome {
  const result = collectResult({
    taskId: prepared.task.id,
    runId: prepared.runId,
    agentId: prepared.agent.document.id,
    assistantText,
    status: resultStatus,
    fallbackSummary: fallbackSummary(status, failure),
    unresolvedIssues,
    now: createdAt,
  });
  events.push(
    createRunEvent({
      type: "result.created",
      projectId: prepared.project.id,
      taskId: prepared.task.id,
      runId: prepared.runId,
      actor: prepared.agent.document.id,
      timestamp: createdAt,
      data: { resultId: result.id, status: result.status },
    }),
  );
  return {
    runId: prepared.runId,
    status,
    events,
    result,
    configuration: prepared.configuration,
    context: prepared.context,
    environment: prepared.environment,
    failure,
  };
}

function fallbackSummary(
  status: IsolatedRunOutcome["status"],
  failure?: StructuredFailure,
): string {
  if (failure !== undefined) {
    return failure.message;
  }
  switch (status) {
    case "completed":
      return "Run completed";
    case "cancelled":
      return "Run was cancelled";
    case "timed_out":
      return "Run timed out";
    case "failed":
      return "Run failed";
  }
}

function collectAssistantDelta(event: PiSessionEvent): string {
  if (
    event.type === "message_update" &&
    event.assistantMessageEvent?.type === "text_delta" &&
    typeof event.assistantMessageEvent.delta === "string"
  ) {
    return event.assistantMessageEvent.delta;
  }
  return "";
}

function toFailure(error: unknown): StructuredFailure {
  if (isVibeKitError(error)) {
    return {
      category: error.category,
      code: error.code,
      message: error.message,
      details: error.details,
    };
  }
  return {
    category: "external_error",
    code: "pi_session_failed",
    message: error instanceof Error ? error.message : "Pi session failed",
  };
}

const DELEGATE_INVARIANT =
  "9. Do not register or invoke agent_delegate. Delegation is not available in this Run.";
const DELEGATE_INVARIANT_ALLOWED =
  "9. You may invoke agent_delegate only for authorized Project bindings. The child receives a new bounded Task, not this conversation.";

function systemPromptForTools(systemPrompt: string, tools: readonly string[]): string {
  if (!tools.includes(AGENT_DELEGATE_TOOL)) {
    return systemPrompt;
  }
  return systemPrompt.replace(DELEGATE_INVARIANT, DELEGATE_INVARIANT_ALLOWED);
}

export async function runManaged(input: ManagedRunInput): Promise<ManagedRunOutcome> {
  const task = resolveTaskDocument(input.task);
  const runId = input.runId ?? newRuntimeId("run");
  const state = input.state;
  const idempotency = resolveIdempotencyStore(input, state);

  if (input.idempotencyKey !== undefined && idempotency !== undefined) {
    const begun = idempotency.begin(input.idempotencyKey, task.id, runId);
    if (!begun.created) {
      return {
        runId: begun.record.runId ?? runId,
        status: "duplicate",
        duplicate: true,
        events: [],
        existing: begun.record,
      };
    }
  }

  const prepared = prepareIsolatedRun({ ...input, task, runId });
  const tools = registerDelegateTool(
    prepared.configuration.tools,
    prepared.agent.document.capabilities.requires,
  );
  const mutating = isMutatingTask(task, tools);
  const useWorktree =
    input.isolateWorktree === true ||
    (input.isolateWorktree !== false &&
      shouldUseWorktree({
        isolation: prepared.configuration.isolation,
        mutationIsolation: prepared.project.execution.mutationIsolation,
        mutating,
      }) &&
      isGitRepository(input.projectRoot));
  const useProcessPlan =
    input.isolateProcess === true ||
    (input.isolateProcess !== false &&
      requiresProcessIsolation({
        project: prepared.project,
        isolation: prepared.configuration.isolation,
        mutating,
      }));

  const pool =
    input.pool ??
    createConcurrencyPool({
      max: prepared.configuration.maxParallelRuns,
      directory:
        state === undefined
          ? undefined
          : path.join(state.paths.runtime, "pool"),
    });
  const lease = pool.acquire(runId);

  let claim: ClaimRecord | undefined;
  let worktree: WorktreeRecord | undefined;
  let worktreeCleanupFailed = false;
  let outcome: IsolatedRunOutcome | undefined;
  const isolationPlan = useProcessPlan
    ? planProcessIsolation({
        cwd: prepared.configuration.cwd,
        secrets: prepared.configuration.secrets,
        source: input.env,
        extra: input.extraEnv,
        environment: prepared.environment,
      })
    : undefined;

  try {
    if (state !== undefined) {
      state.claims.recoverStale();
      claim = state.claims.create({
        taskId: task.id,
        runId,
        agentId: prepared.agent.document.id,
        scope: {
          paths: [...task.scope.paths],
          resources: [...task.scope.resources],
        },
        exclusive: input.exclusive ?? true,
      });
    }

    if (useWorktree) {
      worktree = createWorktree({
        repoRoot: input.projectRoot,
        runId,
      });
    }

    outcome = await runIsolated({
      ...input,
      task,
      runId,
      cwd: worktree?.path ?? input.cwd,
    });

    if (input.idempotencyKey !== undefined) {
      idempotency?.complete(input.idempotencyKey, runId);
    }
  } finally {
    if (worktree !== undefined) {
      try {
        removeWorktree(worktree);
      } catch {
        worktreeCleanupFailed = true;
      }
    }
    if (claim !== undefined && state !== undefined) {
      try {
        state.claims.release(claim.id);
      } catch {
        // Claim may already be expired and recovered.
      }
    }
    pool.release(runId);
  }

  if (outcome === undefined) {
    throw fail(
      "internal_error",
      "managed_run_incomplete",
      "Managed Run ended without an outcome",
      { runId },
    );
  }

  persistManagedOutcome(state, task, outcome);

  if (worktreeCleanupFailed && prepared.configuration.cleanupRequired) {
    return {
      ...outcome,
      status: "failed",
      duplicate: false,
      claim,
      worktree,
      isolationPlan,
      lease,
      failure: {
        category: "cleanup_failed",
        code: "cleanup_failed",
        message: "Required worktree cleanup failed after the Run",
      },
    };
  }

  return {
    ...outcome,
    duplicate: false,
    claim,
    worktree,
    isolationPlan,
    lease,
  };
}

export async function executeDelegation(
  request: DelegationRequest,
  input: DelegationExecuteInput,
): Promise<DelegationOutcome> {
  const validated = validateDelegation(request, input);
  loadDelegationTarget({
    projectRoot: input.projectRoot,
    project: input.project,
    targetBinding: validated.targetBinding,
  });
  const childDraft = resolveChildTask({
    project: input.project,
    request,
    targetDefinition: validated.targetDefinition,
    parentTask: input.parentTask,
    existing: input.existingTask,
    now: input.now,
  });
  if (childDraft.created && input.state !== undefined) {
    input.state.tasks.create(childDraft.task);
  }

  const child = await runManaged({
    projectRoot: input.projectRoot,
    bindingName: validated.targetBinding,
    task: childDraft.task,
    project: input.project,
    state: input.state,
    pool: input.pool,
    createSession: input.createSession,
    env: input.env,
    extraEnv: input.extraEnv,
    signal: input.signal,
    now: input.now,
    scheduledRun: input.scheduledRun,
    approvals: input.approvals,
    componentSecrets: input.componentSecrets,
    taskModel: input.taskModel,
    projectAgentModel: input.projectAgentModel,
    depth: validated.childDepth,
    ancestorBindings: [...(input.ancestorBindings ?? []), input.parentBinding],
    exclusive: true,
  });

  return {
    request,
    validated,
    childTask: childDraft.task,
    child,
  };
}

function persistManagedOutcome(
  state: RepositoryState | undefined,
  task: TaskDocument,
  outcome: IsolatedRunOutcome,
): void {
  if (state === undefined) {
    return;
  }
  if (state.tasks.tryGet(task.id) === undefined) {
    state.tasks.create(task);
  }
  for (const event of outcome.events) {
    state.events.append(event);
  }
  if (typeof state.results.create === "function" && state.results.tryGet(outcome.result.id) === undefined) {
    state.results.create(outcome.result);
  }
}

function resolveIdempotencyStore(
  input: ManagedRunInput,
  state: RepositoryState | undefined,
): IdempotencyStore | undefined {
  if (input.idempotency !== undefined) {
    return input.idempotency;
  }
  if (input.idempotencyKey === undefined) {
    return undefined;
  }
  const directory =
    state !== undefined
      ? path.join(state.paths.runtime, "idempotency")
      : path.join(path.resolve(input.projectRoot), ".vibekit", "runtime", "idempotency");
  return createIdempotencyStore({ directory });
}

async function resolveRunTools(
  input: IsolatedRunInput,
  prepared: PreparedRun,
): Promise<PiCustomTool[]> {
  if (input.customTools !== undefined && input.customTools.length > 0 && input.allowUnfilteredCustomTools !== true) {
    throw fail(
      "permission_denied",
      "custom_tools_unfiltered",
      "Worker Runs cannot accept unfiltered customTools; Tools must come from installed Modules and effective authority",
      { count: input.customTools.length },
    );
  }

  const guardContext = {
    cwd: prepared.configuration.cwd,
    authority: prepared.configuration.authority,
    project: prepared.project,
    task: prepared.task,
    approvals: input.approvals,
  };
  const builtins = createGuardedBuiltinTools(guardContext);
  const installed = await bindInstalledProjectTools({
    projectRoot: input.projectRoot,
    resolveSecret: (name) => prepared.environment.env[name] ?? "",
    grantedCapabilities: prepared.configuration.capabilities,
    scheduledRun: prepared.configuration.scheduledRun,
    allowedModuleIds: prepared.configuration.authority.toolModuleIds,
  });
  const guardedInstalled = installed.map((tool) => guardCustomTool(tool, guardContext, tool.moduleId));
  const extras =
    input.allowUnfilteredCustomTools === true
      ? (input.customTools ?? []).map((tool) => guardCustomTool(tool, guardContext))
      : [];
  return [...builtins, ...guardedInstalled, ...extras];
}

export function openProjectState(input: {
  readonly projectRoot: string;
  readonly project?: ProjectDocument;
  readonly now?: () => Date;
}): RepositoryState {
  const project = resolveProjectDocument(input.projectRoot, input.project);
  return createRepositoryState({
    projectRoot: input.projectRoot,
    statePath: project.state.path,
    now: input.now,
  });
}

export { createChildTaskDocument, validateDelegation };



