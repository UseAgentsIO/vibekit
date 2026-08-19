import {
  conversationKeyOf,
  type HostOutput,
  type InterfaceFactory,
  type InterfaceHealth,
  type InterfaceServices,
  type InboundMessage,
  type RunningInterface,
} from "@useagentsio/interface-sdk";

import {
  createSchedulerStore,
  dueJobs,
  newEventId,
  nextRunAt,
  parseSchedule,
  PathEscapeError,
  resolveInsideProject,
  type JobStatus,
  type ScheduleJob,
  type SchedulerStore,
} from "@useagentsio/schedule-core";

import { isSilentOutput, runJobScript } from "./script.js";
import type { ScheduleInterfaceConfig } from "./types.js";

export class ScheduleInterface implements RunningInterface {
  readonly store: SchedulerStore;
  private readonly config: ScheduleInterfaceConfig;
  private readonly services: InterfaceServices;
  private readonly lastOutputs = new Map<string, HostOutput>();
  private started = false;
  private timer?: ReturnType<typeof setInterval>;
  private ticking = false;
  private nowFn: () => Date;

  constructor(config: Record<string, unknown>, services: InterfaceServices) {
    this.config = readInterfaceConfig(config);
    this.services = services;
    this.store = createSchedulerStore({
      projectRoot: this.config.projectRoot,
      jobsPath: typeof config.jobsPath === "string" ? config.jobsPath : undefined,
    });
    this.nowFn = readNowFn(config);
  }

  async start(): Promise<void> {
    if (this.started) {
      return;
    }
    this.started = true;
    if (this.store.exists()) {
      this.store.list();
    }
    if (this.config.tickMs > 0) {
      this.timer = setInterval(() => {
        void this.tick();
      }, this.config.tickMs);
      this.timer.unref?.();
    }
    await this.tick();
  }

  async stop(): Promise<void> {
    this.started = false;
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  async deliver(output: HostOutput): Promise<void> {
    this.lastOutputs.set(output.conversationKey, output);
  }

  async health(): Promise<InterfaceHealth> {
    const count = this.store.exists() ? this.store.list().length : 0;
    return {
      ok: this.started,
      connected: this.started,
      detail: `jobs=${count}`,
    };
  }

  lastOutput(conversationKey: string): HostOutput | undefined {
    return this.lastOutputs.get(conversationKey);
  }

  async tick(): Promise<void> {
    if (this.ticking) {
      return;
    }
    if (!this.store.exists()) {
      return;
    }
    this.ticking = true;
    try {
      await this.store.withLock(async () => {
        const now = this.nowFn();
        const jobs = this.store.list();
        const due = dueJobs(jobs, now);
        if (due.length === 0) {
          return;
        }
        const byId = new Map(jobs.map((job) => [job.id, job]));
        for (const snapshot of due) {
          const job = byId.get(snapshot.id);
          if (job === undefined) {
            continue;
          }
          advanceAfterClaim(job, now);
          this.store.replace([...byId.values()]);
          const status = await this.fire(job, now);
          job.lastStatus = status;
          job.updatedAt = this.nowFn().toISOString();
          this.store.replace([...byId.values()]);
        }
      });
    } catch (error) {
      this.services.log.error("schedule tick failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.ticking = false;
    }
  }

  private async fire(job: ScheduleJob, now: Date): Promise<JobStatus> {
    if (this.isDeliveryBlocked(job)) {
      this.store.writeRun({
        jobId: job.id,
        firedAt: now.toISOString(),
        status: "blocked_config",
        error: "delivery interface is missing or unbound",
      });
      return "blocked_config";
    }

    if (job.noAgent === true) {
      if (job.script !== undefined && job.script.length > 0) {
        return this.fireScript(job, now);
      }
      this.store.writeRun({
        jobId: job.id,
        firedAt: now.toISOString(),
        status: "ok",
      });
      return "ok";
    }

    const eventId = newEventId();
    try {
      await this.services.submit(this.inboundFor(job, job.prompt, eventId, now));
      this.store.writeRun({
        jobId: job.id,
        firedAt: now.toISOString(),
        status: "ok",
        eventId,
      });
      return "ok";
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.store.writeRun({
        jobId: job.id,
        firedAt: now.toISOString(),
        status: "failed",
        eventId,
        error: message,
      });
      return "failed";
    }
  }

  private async fireScript(job: ScheduleJob, now: Date): Promise<JobStatus> {
    const script = job.script ?? "";
    try {
      resolveInsideProject(this.config.projectRoot, script, "script");
    } catch (error) {
      const message = error instanceof PathEscapeError ? error.message : "script path rejected";
      await this.submitFailure(job, `Scheduled job ${job.name} (${job.id}) failed: ${message}`, now);
      this.store.writeRun({
        jobId: job.id,
        firedAt: now.toISOString(),
        status: "failed",
        error: message,
      });
      return "failed";
    }

    try {
      const result = await runJobScript({
        projectRoot: this.config.projectRoot,
        script,
        timeoutMs: this.config.scriptTimeoutMs,
      });
      if (result.code !== 0 || result.timedOut) {
        const reason = result.timedOut ? "timed out" : `exit ${result.code}`;
        const text = `Scheduled job ${job.name} (${job.id}) failed: ${reason}`;
        const eventId = await this.submitFailure(job, text, now);
        this.store.writeRun({
          jobId: job.id,
          firedAt: now.toISOString(),
          status: "failed",
          eventId,
          error: reason,
        });
        return "failed";
      }
      if (job.silentOnEmpty === true && isSilentOutput(result.stdout)) {
        this.store.writeRun({
          jobId: job.id,
          firedAt: now.toISOString(),
          status: "silent",
        });
        return "silent";
      }
      this.store.writeRun({
        jobId: job.id,
        firedAt: now.toISOString(),
        status: "ok",
      });
      return "ok";
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const eventId = await this.submitFailure(
        job,
        `Scheduled job ${job.name} (${job.id}) failed: ${message}`,
        now,
      );
      this.store.writeRun({
        jobId: job.id,
        firedAt: now.toISOString(),
        status: "failed",
        eventId,
        error: message,
      });
      return "failed";
    }
  }

  private async submitFailure(job: ScheduleJob, text: string, now: Date): Promise<string | undefined> {
    const eventId = newEventId();
    try {
      await this.services.submit(this.inboundFor(job, text, eventId, now));
      return eventId;
    } catch (error) {
      this.services.log.error("schedule failure submit failed", {
        jobId: job.id,
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  }

  private inboundFor(job: ScheduleJob, text: string, eventId: string, now: Date): InboundMessage {
    const interfaceBinding = this.config.interfaceBinding;
    return {
      eventId,
      interfaceBinding,
      accountId: "schedule",
      conversationId: job.id,
      conversationKey: conversationKeyOf({
        interfaceBinding,
        accountId: "schedule",
        conversationId: job.id,
      }),
      sender: { id: `schedule:${job.id}`, displayName: job.name, trusted: true },
      text,
      attachments: [],
      timestamp: now.toISOString(),
    };
  }

  private isDeliveryBlocked(job: ScheduleJob): boolean {
    const known = this.config.knownInterfaces;
    if (job.deliveryRequired === true) {
      if (job.deliveryInterface === undefined || job.deliveryInterface.length === 0) {
        return true;
      }
      if (known !== undefined && !known.includes(job.deliveryInterface)) {
        return true;
      }
    }
    if (job.deliveryInterface !== undefined && this.config.requireDelivery) {
      if (known === undefined || !known.includes(job.deliveryInterface)) {
        return true;
      }
    }
    return false;
  }
}

function advanceAfterClaim(job: ScheduleJob, now: Date): void {
  job.pendingRun = undefined;
  const parsed = parseSchedule(job.schedule);
  if (parsed.kind === "delay" || parsed.kind === "once") {
    job.enabled = false;
    return;
  }
  job.nextRunAt = nextRunAt(parsed, now, job.timezone).toISOString();
}

function readInterfaceConfig(config: Record<string, unknown>): ScheduleInterfaceConfig {
  const projectRoot = typeof config.projectRoot === "string" ? config.projectRoot.trim() : "";
  if (projectRoot.length === 0) {
    throw new Error("createScheduleInterface requires config.projectRoot");
  }
  const tickMs = readNumber(config.tickMs, 15_000);
  const scriptTimeoutMs = readNumber(config.scriptTimeoutMs, 30_000);
  const timezone = typeof config.timezone === "string" && config.timezone.length > 0 ? config.timezone : "UTC";
  const interfaceBinding =
    typeof config.interfaceBinding === "string" && config.interfaceBinding.length > 0
      ? config.interfaceBinding
      : "schedule-main";
  const knownInterfaces = Array.isArray(config.knownInterfaces)
    ? config.knownInterfaces.filter((item): item is string => typeof item === "string")
    : undefined;
  return {
    projectRoot,
    tickMs,
    timezone,
    interfaceBinding,
    requireDelivery: config.requireDelivery === true,
    knownInterfaces,
    scriptTimeoutMs,
  };
}

function readNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

function readNowFn(config: Record<string, unknown>): () => Date {
  if (typeof config.now === "function") {
    return config.now as () => Date;
  }
  return () => new Date();
}

export const createScheduleInterface: InterfaceFactory["create"] = async (config, services) =>
  new ScheduleInterface(config, services);
