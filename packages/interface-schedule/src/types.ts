export type {
  CronFields,
  JobStatus,
  JobsFile,
  ParsedSchedule,
  RunRecord,
  ScheduleJob,
  ScheduleKind,
} from "@useagentsio/schedule-core";

export interface ScheduleInterfaceConfig {
  readonly projectRoot: string;
  readonly tickMs: number;
  readonly timezone: string;
  readonly interfaceBinding: string;
  readonly requireDelivery: boolean;
  readonly knownInterfaces?: readonly string[];
  readonly scriptTimeoutMs: number;
}
