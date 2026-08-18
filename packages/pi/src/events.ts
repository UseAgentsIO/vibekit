import {
  CURRENT_SCHEMA_VERSION,
  redactSecrets,
  validateDocument,
  type EventDocument,
  type ProjectId,
  type RuntimeId,
} from "@useagentsio/core";

import { configurationInvalid } from "./fail.js";
import { newRuntimeId } from "./ids.js";

export const RUN_EVENT_TYPES = [
  "run.created",
  "run.started",
  "run.progress",
  "run.waiting",
  "run.completed",
  "run.failed",
  "run.cancelled",
  "run.timed_out",
  "result.created",
] as const;

export type RunEventType = (typeof RUN_EVENT_TYPES)[number];

export interface CreateRunEventInput {
  readonly type: RunEventType;
  readonly projectId: ProjectId;
  readonly taskId?: RuntimeId | null;
  readonly runId?: RuntimeId | null;
  readonly actor: string;
  readonly data?: Readonly<Record<string, unknown>>;
  readonly timestamp?: Date;
}

export function createRunEvent(input: CreateRunEventInput): EventDocument {
  const event: EventDocument = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: newRuntimeId("event"),
    type: input.type,
    projectId: input.projectId,
    taskId: input.taskId ?? null,
    runId: input.runId ?? null,
    actor: input.actor,
    timestamp: (input.timestamp ?? new Date()).toISOString(),
    data: redactEventData(input.data ?? {}),
  };
  const validated = validateDocument("event", event);
  if (!validated.valid || validated.data === undefined) {
    throw configurationInvalid(
      "event_invalid",
      validated.errors[0]?.message ?? "Failed to construct a valid Run Event",
      { errors: validated.errors },
    );
  }
  return validated.data;
}

export interface PiSessionEvent {
  readonly type: string;
  readonly toolName?: string;
  readonly isError?: boolean;
  readonly assistantMessageEvent?: {
    readonly type: string;
    readonly delta?: string;
  };
  readonly messages?: readonly unknown[];
}

export function mapPiSessionEvent(
  event: PiSessionEvent,
  meta: {
    readonly projectId: ProjectId;
    readonly taskId: RuntimeId;
    readonly runId: RuntimeId;
    readonly actor: string;
    readonly timestamp?: Date;
  },
): EventDocument | undefined {
  switch (event.type) {
    case "tool_execution_start":
    case "tool_execution_update":
    case "tool_execution_end":
    case "turn_start":
    case "turn_end":
    case "message_start":
    case "message_end":
      return createRunEvent({
        type: "run.progress",
        projectId: meta.projectId,
        taskId: meta.taskId,
        runId: meta.runId,
        actor: meta.actor,
        timestamp: meta.timestamp,
        data: {
          piType: event.type,
          toolName: event.toolName,
          isError: event.isError === true,
        },
      });
    case "agent_end":
      return undefined;
    default:
      return undefined;
  }
}

export function redactEventData(
  data: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === "string") {
      redacted[key] = redactSecrets(value);
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      redacted[key] = redactEventData(value as Record<string, unknown>);
    } else {
      redacted[key] = value;
    }
  }
  return redacted;
}
