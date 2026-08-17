import {
  isVibeKitError,
  type DecisionDocument,
  type EventDocument,
  type ProjectDocument,
  type ResultDocument,
  type RunState,
  type RuntimeId,
  type SecretReference,
  type StructuredFailure,
  type TaskDocument,
} from "@vibekit/core";

import { loadAgentDocument, type LoadedAgent } from "./agent.js";
import { assembleBoundedContext, type BoundedContext } from "./context.js";
import {
  resolveEffectiveConfiguration,
  type EffectiveConfiguration,
} from "./config.js";
import { filterEnvironment, type FilteredEnvironment } from "./env.js";
import { createRunEvent, mapPiSessionEvent, type PiSessionEvent } from "./events.js";
import { newRuntimeId } from "./ids.js";
import type { ModelRef } from "./model.js";
import { resolveProjectDocument } from "./project.js";
import { collectResult } from "./result.js";
import {
  createPiAgentSession,
  type CreatePiSession,
  type PiSession,
} from "./session.js";
import {
  assertRequiredTaskInputs,
  assertTaskAssignedAgent,
  assertTaskAuthorization,
  assertTaskMatchesProject,
  resolveTaskDocument,
} from "./task.js";

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
  readonly approvalGranted?: boolean;
  readonly createSession?: CreatePiSession;
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
    approvalGranted: input.approvalGranted,
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

    session = await createSession({
      cwd: prepared.configuration.cwd,
      tools: prepared.configuration.tools,
      systemPrompt: prepared.context.systemPrompt,
      model: prepared.configuration.model,
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


