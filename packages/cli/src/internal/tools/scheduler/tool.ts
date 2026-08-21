import {
  assertSafeRelativePath,
  createSchedulerStore,
  parseSchedule,
  type CreateJobInput,
  type ScheduleJob,
  type SchedulerStore,
  type UpdateJobInput,
} from "../../schedule/index.js";

export const SCHEDULER_TOOL_NAME = "scheduler";
export const SCHEDULE_READ = "schedule.read";
export const SCHEDULE_WRITE = "schedule.write";

export type SchedulerAction = "create" | "list" | "pause" | "resume" | "run" | "remove" | "update";

const MUTATING = new Set<SchedulerAction>(["create", "pause", "resume", "run", "remove", "update"]);

export interface SchedulerToolContext {
  readonly projectRoot: string;
  readonly config?: Record<string, unknown>;
  readonly resolveSecret?: (name: string) => string;
  readonly grantedCapabilities?: readonly string[];
  readonly scheduledRun?: boolean;
  readonly fromScheduledRun?: boolean;
  readonly allowAgentScheduling?: boolean;
  readonly now?: () => Date;
}

export interface SchedulerToolInput {
  readonly action?: unknown;
  readonly id?: unknown;
  readonly name?: unknown;
  readonly schedule?: unknown;
  readonly timezone?: unknown;
  readonly prompt?: unknown;
  readonly agentBinding?: unknown;
  readonly deliveryInterface?: unknown;
  readonly deliveryRequired?: unknown;
  readonly noAgent?: unknown;
  readonly script?: unknown;
  readonly silentOnEmpty?: unknown;
  readonly enabled?: unknown;
}

export interface SchedulerTool {
  readonly name: string;
  readonly description: string;
  readonly parameters: unknown;
  execute(input: unknown): Promise<unknown>;
}

const PARAMETERS = {
  type: "object",
  additionalProperties: false,
  required: ["action"],
  properties: {
    action: {
      type: "string",
      enum: ["create", "list", "pause", "resume", "run", "remove", "update"],
      description: "Scheduler action to perform",
    },
    id: { type: "string", description: "Job id (sch_…)" },
    name: { type: "string", description: "Human-readable job name" },
    schedule: {
      type: "string",
      description: 'Schedule expression: "30m", "every 2h", "0 9 * * *", or an ISO timestamp',
    },
    timezone: { type: "string", description: "IANA timezone (default UTC)" },
    prompt: { type: "string", description: "Self-contained Task objective" },
    agentBinding: { type: "string" },
    deliveryInterface: { type: "string" },
    deliveryRequired: { type: "boolean" },
    noAgent: { type: "boolean", description: "Run script only; do not submit an agent Task" },
    script: { type: "string", description: "Project-relative script path for noAgent jobs" },
    silentOnEmpty: { type: "boolean" },
    enabled: { type: "boolean" },
  },
} as const;

export function createSchedulerTool(ctx: SchedulerToolContext): SchedulerTool {
  if (typeof ctx.projectRoot !== "string" || ctx.projectRoot.trim().length === 0) {
    throw new Error("createSchedulerTool requires ctx.projectRoot");
  }
  const store = createSchedulerStore({ projectRoot: ctx.projectRoot });
  return {
    name: SCHEDULER_TOOL_NAME,
    description:
      "Create, list, pause, resume, run, update, or remove interface:schedule jobs. Jobs fire as fresh Host Tasks.",
    parameters: PARAMETERS,
    execute: async (input: unknown) => executeScheduler(store, ctx, input),
  };
}

async function executeScheduler(
  store: SchedulerStore,
  ctx: SchedulerToolContext,
  raw: unknown,
): Promise<unknown> {
  const input = (raw ?? {}) as SchedulerToolInput;
  const action = parseAction(input.action);
  if (action === undefined) {
    return fail("action is required (create | list | pause | resume | run | remove | update)");
  }

  if (action === "list") {
    const readDenied = capabilityDenied(ctx, SCHEDULE_READ) && capabilityDenied(ctx, SCHEDULE_WRITE);
    if (readDenied) {
      return fail("Missing capability schedule.read");
    }
    return { ok: true, jobs: store.list() };
  }

  if (MUTATING.has(action)) {
    if (capabilityDenied(ctx, SCHEDULE_WRITE)) {
      return fail("Missing capability schedule.write");
    }
    if (scheduledMutationDenied(ctx)) {
      return fail("Scheduled runs cannot create or edit jobs");
    }
  }

  const now = ctx.now?.() ?? new Date();

  try {
    switch (action) {
      case "create":
        return { ok: true, job: createJob(store, input, now) };
      case "pause":
        return { ok: true, job: mutate(store, input, { enabled: false }, now) };
      case "resume":
        return { ok: true, job: resumeJob(store, requireId(input), now) };
      case "run":
        return { ok: true, job: store.update(requireId(input), { pendingRun: true, nextRunAt: now.toISOString() }, now) };
      case "remove": {
        const id = requireId(input);
        const removed = store.remove(id);
        if (!removed) {
          return fail(`Schedule job ${id} was not found`);
        }
        return { ok: true, removed: id };
      }
      case "update":
        return { ok: true, job: updateJob(store, input, now) };
      default:
        return fail(`Unsupported action ${String(action)}`);
    }
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}

function createJob(store: SchedulerStore, input: SchedulerToolInput, now: Date): ScheduleJob {
  const name = readString(input.name);
  const schedule = readString(input.schedule);
  if (name === undefined) {
    throw new Error("create requires name");
  }
  if (schedule === undefined) {
    throw new Error("create requires schedule");
  }
  parseSchedule(schedule);
  const script = readString(input.script);
  if (script !== undefined) {
    assertSafeRelativePath(script, "script");
  }
  const draft: CreateJobInput = {
    name,
    schedule,
    prompt: readString(input.prompt) ?? "",
    timezone: readString(input.timezone),
    agentBinding: readString(input.agentBinding),
    deliveryInterface: readString(input.deliveryInterface),
    deliveryRequired: readBoolean(input.deliveryRequired),
    noAgent: readBoolean(input.noAgent),
    script,
    silentOnEmpty: readBoolean(input.silentOnEmpty),
    allowSchedulerTool: false,
    enabled: readBoolean(input.enabled),
  };
  return store.create(draft, now);
}

function updateJob(store: SchedulerStore, input: SchedulerToolInput, now: Date): ScheduleJob {
  const id = requireId(input);
  const schedule = readString(input.schedule);
  if (schedule !== undefined) {
    parseSchedule(schedule);
  }
  const script = input.script === null ? null : readString(input.script);
  if (typeof script === "string") {
    assertSafeRelativePath(script, "script");
  }
  const patch: UpdateJobInput = {
    name: readString(input.name),
    schedule,
    prompt: readString(input.prompt),
    timezone: readString(input.timezone),
    agentBinding: input.agentBinding === null ? null : readString(input.agentBinding),
    deliveryInterface: input.deliveryInterface === null ? null : readString(input.deliveryInterface),
    deliveryRequired: readBoolean(input.deliveryRequired),
    noAgent: readBoolean(input.noAgent),
    script,
    silentOnEmpty: readBoolean(input.silentOnEmpty),
    enabled: readBoolean(input.enabled),
  };
  return store.update(id, patch, now);
}

function resumeJob(store: SchedulerStore, id: string, now: Date): ScheduleJob {
  const current = store.get(id);
  if (current === undefined) {
    throw new Error(`Schedule job ${id} was not found`);
  }
  const parsed = parseSchedule(current.schedule);
  const overdue = Date.parse(current.nextRunAt) <= now.getTime();
  const nextRun =
    overdue && (parsed.kind === "interval" || parsed.kind === "cron")
      ? undefined
      : current.nextRunAt;
  const patch: UpdateJobInput = {
    enabled: true,
    ...(overdue && (parsed.kind === "interval" || parsed.kind === "cron")
      ? { schedule: current.schedule, timezone: current.timezone }
      : { nextRunAt: nextRun }),
  };
  return store.update(id, patch, now);
}

function mutate(store: SchedulerStore, input: SchedulerToolInput, patch: UpdateJobInput, now: Date): ScheduleJob {
  return store.update(requireId(input), patch, now);
}

function requireId(input: SchedulerToolInput): string {
  const id = readString(input.id);
  if (id === undefined) {
    throw new Error("id is required");
  }
  return id;
}

function parseAction(value: unknown): SchedulerAction | undefined {
  if (
    value === "create" ||
    value === "list" ||
    value === "pause" ||
    value === "resume" ||
    value === "run" ||
    value === "remove" ||
    value === "update"
  ) {
    return value;
  }
  return undefined;
}

function scheduledMutationDenied(ctx: SchedulerToolContext): boolean {
  const scheduled = ctx.scheduledRun === true || ctx.fromScheduledRun === true;
  if (!scheduled) {
    return false;
  }
  if (ctx.allowAgentScheduling === true) {
    return false;
  }
  if (ctx.config?.allowAgentScheduling === true) {
    return false;
  }
  return true;
}

function capabilityDenied(ctx: SchedulerToolContext, capability: string): boolean {
  if (ctx.grantedCapabilities === undefined) {
    return false;
  }
  return !ctx.grantedCapabilities.includes(capability);
}

function readString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}
