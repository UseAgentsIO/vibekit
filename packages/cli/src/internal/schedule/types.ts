export type JobStatus = "ok" | "failed" | "blocked_config" | "silent";

export interface ScheduleJob {
  id: string;
  name: string;
  enabled: boolean;
  schedule: string;
  timezone: string;
  prompt: string;
  agentBinding?: string;
  deliveryInterface?: string;
  deliveryRequired?: boolean;
  noAgent?: boolean;
  script?: string;
  silentOnEmpty?: boolean;
  allowSchedulerTool?: boolean;
  pendingRun?: boolean;
  nextRunAt: string;
  lastStatus?: JobStatus;
  createdAt: string;
  updatedAt: string;
}

export type ScheduleKind = "delay" | "interval" | "cron" | "once";

export interface CronFields {
  readonly minute: ReadonlySet<number>;
  readonly hour: ReadonlySet<number>;
  readonly dayOfMonth: ReadonlySet<number>;
  readonly month: ReadonlySet<number>;
  readonly dayOfWeek: ReadonlySet<number>;
  readonly dayOfMonthStar: boolean;
  readonly dayOfWeekStar: boolean;
}

export type ParsedSchedule =
  | { readonly kind: "delay"; readonly ms: number }
  | { readonly kind: "interval"; readonly ms: number }
  | { readonly kind: "cron"; readonly expression: string; readonly fields: CronFields }
  | { readonly kind: "once"; readonly at: Date };

export interface JobsFile {
  readonly schemaVersion: 1;
  jobs: ScheduleJob[];
}

export interface RunRecord {
  readonly jobId: string;
  readonly firedAt: string;
  readonly status: JobStatus;
  readonly eventId?: string;
  readonly error?: string;
}
