import fs from "node:fs";
import path from "node:path";

import { newJobId } from "./ids.js";
import { assertSafeRelativePath, defaultJobsPath, defaultLockPath, defaultRunsDir } from "./paths.js";
import { assertValidTimeZone, nextRunAt, parseSchedule } from "./schedule.js";
import type { JobsFile, RunRecord, ScheduleJob } from "./types.js";

export interface CreateJobInput {
  readonly name: string;
  readonly schedule: string;
  readonly prompt?: string;
  readonly timezone?: string;
  readonly agentBinding?: string;
  readonly deliveryInterface?: string;
  readonly deliveryRequired?: boolean;
  readonly noAgent?: boolean;
  readonly script?: string;
  readonly silentOnEmpty?: boolean;
  readonly allowSchedulerTool?: boolean;
  readonly enabled?: boolean;
}

export interface UpdateJobInput {
  readonly name?: string;
  readonly schedule?: string;
  readonly prompt?: string;
  readonly timezone?: string;
  readonly agentBinding?: string | null;
  readonly deliveryInterface?: string | null;
  readonly deliveryRequired?: boolean;
  readonly noAgent?: boolean;
  readonly script?: string | null;
  readonly silentOnEmpty?: boolean;
  readonly allowSchedulerTool?: boolean;
  readonly enabled?: boolean;
  readonly pendingRun?: boolean;
  readonly nextRunAt?: string;
  readonly lastStatus?: ScheduleJob["lastStatus"];
}

export interface SchedulerStore {
  readonly projectRoot: string;
  readonly jobsPath: string;
  readonly lockPath: string;
  readonly runsDir: string;
  exists(): boolean;
  list(): ScheduleJob[];
  get(id: string): ScheduleJob | undefined;
  create(input: CreateJobInput, now?: Date): ScheduleJob;
  update(id: string, patch: UpdateJobInput, now?: Date): ScheduleJob;
  remove(id: string): boolean;
  replace(jobs: readonly ScheduleJob[]): void;
  writeRun(record: RunRecord): void;
  withLock<T>(fn: () => Promise<T>, options?: { timeoutMs?: number }): Promise<T | undefined>;
}

export interface CreateSchedulerStoreOptions {
  readonly projectRoot: string;
  readonly jobsPath?: string;
  readonly lockPath?: string;
  readonly runsDir?: string;
}

export function createSchedulerStore(options: CreateSchedulerStoreOptions): SchedulerStore {
  return new FileSchedulerStore(options);
}

class FileSchedulerStore implements SchedulerStore {
  readonly projectRoot: string;
  readonly jobsPath: string;
  readonly lockPath: string;
  readonly runsDir: string;

  constructor(options: CreateSchedulerStoreOptions) {
    this.projectRoot = path.resolve(options.projectRoot);
    this.jobsPath = options.jobsPath ?? defaultJobsPath(this.projectRoot);
    this.lockPath = options.lockPath ?? defaultLockPath(this.projectRoot);
    this.runsDir = options.runsDir ?? defaultRunsDir(this.projectRoot);
  }

  exists(): boolean {
    return fs.existsSync(this.jobsPath);
  }

  list(): ScheduleJob[] {
    return this.readFile().jobs.map(cloneJob);
  }

  get(id: string): ScheduleJob | undefined {
    const found = this.readFile().jobs.find((job) => job.id === id);
    return found === undefined ? undefined : cloneJob(found);
  }

  create(input: CreateJobInput, now: Date = new Date()): ScheduleJob {
    const job = buildJob(input, now);
    const file = this.readFile();
    file.jobs.push(job);
    this.writeFile(file);
    return cloneJob(job);
  }

  update(id: string, patch: UpdateJobInput, now: Date = new Date()): ScheduleJob {
    const file = this.readFile();
    const index = file.jobs.findIndex((job) => job.id === id);
    if (index === -1) {
      throw new Error(`Schedule job ${id} was not found`);
    }
    const current = file.jobs[index];
    const next = applyPatch(current, patch, now);
    file.jobs[index] = next;
    this.writeFile(file);
    return cloneJob(next);
  }

  remove(id: string): boolean {
    if (!this.exists()) {
      return false;
    }
    const file = this.readFile();
    const next = file.jobs.filter((job) => job.id !== id);
    if (next.length === file.jobs.length) {
      return false;
    }
    this.writeFile({ schemaVersion: 1, jobs: next });
    return true;
  }

  replace(jobs: readonly ScheduleJob[]): void {
    this.writeFile({ schemaVersion: 1, jobs: jobs.map(cloneJob) });
  }

  writeRun(record: RunRecord): void {
    fs.mkdirSync(this.runsDir, { recursive: true });
    const stamp = record.firedAt.replace(/[:.]/g, "-");
    const filePath = path.join(this.runsDir, `${record.jobId}-${stamp}.json`);
    atomicWriteJson(filePath, record);
  }

  async withLock<T>(fn: () => Promise<T>, options?: { timeoutMs?: number }): Promise<T | undefined> {
    const release = await acquireLock(this.lockPath, options?.timeoutMs ?? 2_000);
    if (release === undefined) {
      return undefined;
    }
    try {
      return await fn();
    } finally {
      release();
    }
  }

  private readFile(): JobsFile {
    if (!fs.existsSync(this.jobsPath)) {
      return { schemaVersion: 1, jobs: [] };
    }
    const raw = fs.readFileSync(this.jobsPath, "utf8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      throw new Error(`Schedule job table is not valid JSON: ${this.jobsPath}`);
    }
    return normalizeJobsFile(parsed);
  }

  private writeFile(file: JobsFile): void {
    fs.mkdirSync(path.dirname(this.jobsPath), { recursive: true });
    atomicWriteJson(this.jobsPath, file);
  }
}

export function buildJob(input: CreateJobInput, now: Date = new Date()): ScheduleJob {
  if (typeof input.name !== "string" || input.name.trim().length === 0) {
    throw new Error("Schedule job name is required");
  }
  if (typeof input.schedule !== "string" || input.schedule.trim().length === 0) {
    throw new Error("Schedule expression is required");
  }
  const timezone = input.timezone?.trim() || "UTC";
  assertValidTimeZone(timezone);
  const parsed = parseSchedule(input.schedule);
  const noAgent = input.noAgent === true;
  const prompt = input.prompt ?? "";
  if (!noAgent && prompt.trim().length === 0) {
    throw new Error("Schedule job prompt is required unless noAgent is set");
  }
  const script = emptyToUndefined(input.script);
  if (script !== undefined) {
    assertSafeRelativePath(script, "script");
  }
  const iso = now.toISOString();
  return {
    id: newJobId(),
    name: input.name.trim(),
    enabled: input.enabled !== false,
    schedule: input.schedule.trim(),
    timezone,
    prompt,
    agentBinding: emptyToUndefined(input.agentBinding),
    deliveryInterface: emptyToUndefined(input.deliveryInterface),
    deliveryRequired: input.deliveryRequired,
    noAgent: noAgent || undefined,
    script,
    silentOnEmpty: input.silentOnEmpty,
    allowSchedulerTool: input.allowSchedulerTool === true ? true : false,
    nextRunAt: nextRunAt(parsed, now, timezone).toISOString(),
    createdAt: iso,
    updatedAt: iso,
  };
}

function applyPatch(current: ScheduleJob, patch: UpdateJobInput, now: Date): ScheduleJob {
  const schedule = patch.schedule ?? current.schedule;
  const timezone = (patch.timezone ?? current.timezone).trim() || "UTC";
  assertValidTimeZone(timezone);
  const parsed = parseSchedule(schedule);
  const next: ScheduleJob = {
    ...current,
    name: patch.name?.trim() || current.name,
    schedule: schedule.trim(),
    timezone,
    prompt: patch.prompt ?? current.prompt,
    agentBinding: patch.agentBinding === null ? undefined : (patch.agentBinding ?? current.agentBinding),
    deliveryInterface:
      patch.deliveryInterface === null ? undefined : (patch.deliveryInterface ?? current.deliveryInterface),
    deliveryRequired: patch.deliveryRequired ?? current.deliveryRequired,
    noAgent: patch.noAgent ?? current.noAgent,
    script: patch.script === null ? undefined : (patch.script ?? current.script),
    silentOnEmpty: patch.silentOnEmpty ?? current.silentOnEmpty,
    allowSchedulerTool: patch.allowSchedulerTool ?? current.allowSchedulerTool,
    enabled: patch.enabled ?? current.enabled,
    pendingRun: patch.pendingRun ?? current.pendingRun,
    nextRunAt: patch.nextRunAt ?? current.nextRunAt,
    lastStatus: patch.lastStatus ?? current.lastStatus,
    updatedAt: now.toISOString(),
  };
  if (patch.schedule !== undefined || patch.timezone !== undefined) {
    next.nextRunAt = nextRunAt(parsed, now, timezone).toISOString();
  }
  if (next.script !== undefined) {
    assertSafeRelativePath(next.script, "script");
  }
  if (next.noAgent !== true && (next.prompt ?? "").trim().length === 0) {
    throw new Error("Schedule job prompt is required unless noAgent is set");
  }
  return next;
}

function normalizeJobsFile(value: unknown): JobsFile {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Schedule job table must be an object");
  }
  const record = value as { schemaVersion?: unknown; jobs?: unknown };
  if (!Array.isArray(record.jobs)) {
    throw new Error("Schedule job table is missing jobs[]");
  }
  return {
    schemaVersion: 1,
    jobs: record.jobs.filter(isJobRecord).map((job) => ({ ...job })),
  };
}

function isJobRecord(value: unknown): value is ScheduleJob {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const job = value as Partial<ScheduleJob>;
  return (
    typeof job.id === "string" &&
    typeof job.name === "string" &&
    typeof job.enabled === "boolean" &&
    typeof job.schedule === "string" &&
    typeof job.timezone === "string" &&
    typeof job.prompt === "string" &&
    typeof job.nextRunAt === "string" &&
    typeof job.createdAt === "string" &&
    typeof job.updatedAt === "string"
  );
}

function cloneJob(job: ScheduleJob): ScheduleJob {
  return { ...job };
}

function emptyToUndefined(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

function atomicWriteJson(filePath: string, value: unknown): void {
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, filePath);
}

async function acquireLock(lockPath: string, timeoutMs: number): Promise<(() => void) | undefined> {
  const started = Date.now();
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  while (Date.now() - started <= timeoutMs) {
    try {
      const fd = fs.openSync(lockPath, "wx");
      fs.writeFileSync(fd, `${process.pid}\n`, "utf8");
      fs.closeSync(fd);
      return () => {
        try {
          fs.rmSync(lockPath, { force: true });
        } catch {
          // ignore
        }
      };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") {
        throw error;
      }
      if (isStaleLock(lockPath)) {
        try {
          fs.rmSync(lockPath, { force: true });
        } catch {
          // ignore
        }
        continue;
      }
      await sleep(15);
    }
  }
  return undefined;
}

function isStaleLock(lockPath: string): boolean {
  try {
    const raw = fs.readFileSync(lockPath, "utf8").trim();
    const pid = Number(raw);
    if (Number.isInteger(pid) && pid > 0 && pidAlive(pid)) {
      return false;
    }
    return true;
  } catch {
    return true;
  }
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
