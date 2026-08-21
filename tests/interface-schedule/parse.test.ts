import { describe, expect, it } from "vitest";

import {
  dueJobs,
  nextRunAt,
  parseSchedule,
  ScheduleParseError,
} from "../../packages/cli/src/internal/interfaces/schedule/index.js";
import type { ScheduleJob } from "../../packages/cli/src/internal/interfaces/schedule/index.js";

describe("parseSchedule", () => {
  it("parses one-shot delays", () => {
    expect(parseSchedule("30m")).toEqual({ kind: "delay", ms: 30 * 60_000 });
    expect(parseSchedule("2h")).toEqual({ kind: "delay", ms: 2 * 3_600_000 });
    expect(parseSchedule("1d")).toEqual({ kind: "delay", ms: 86_400_000 });
  });

  it("parses interval expressions", () => {
    expect(parseSchedule("every 30m")).toEqual({ kind: "interval", ms: 30 * 60_000 });
    expect(parseSchedule("every 2h")).toEqual({ kind: "interval", ms: 2 * 3_600_000 });
    expect(parseSchedule("every 1d")).toEqual({ kind: "interval", ms: 86_400_000 });
  });

  it("parses 5-field cron", () => {
    const parsed = parseSchedule("0 9 * * *");
    expect(parsed.kind).toBe("cron");
    if (parsed.kind !== "cron") {
      return;
    }
    expect(parsed.expression).toBe("0 9 * * *");
    expect(parsed.fields.minute.has(0)).toBe(true);
    expect(parsed.fields.hour.has(9)).toBe(true);
    expect(parsed.fields.dayOfMonthStar).toBe(true);
    expect(parsed.fields.dayOfWeekStar).toBe(true);
  });

  it("parses ISO-8601 timestamps as one-shot", () => {
    const parsed = parseSchedule("2026-08-20T12:00:00.000Z");
    expect(parsed.kind).toBe("once");
    if (parsed.kind !== "once") {
      return;
    }
    expect(parsed.at.toISOString()).toBe("2026-08-20T12:00:00.000Z");
  });

  it("rejects empty and unknown expressions", () => {
    expect(() => parseSchedule("")).toThrow(ScheduleParseError);
    expect(() => parseSchedule("sometimes")).toThrow(ScheduleParseError);
    expect(() => parseSchedule("* * * *")).toThrow(ScheduleParseError);
  });
});

describe("nextRunAt / dueJobs", () => {
  it("advances cron to the next matching minute in UTC", () => {
    const parsed = parseSchedule("0 9 * * *");
    expect(nextRunAt(parsed, new Date("2026-08-18T08:00:00.000Z"), "UTC").toISOString()).toBe(
      "2026-08-18T09:00:00.000Z",
    );
    expect(nextRunAt(parsed, new Date("2026-08-18T09:00:00.000Z"), "UTC").toISOString()).toBe(
      "2026-08-19T09:00:00.000Z",
    );
  });

  it("evaluates cron fields in an IANA timezone", () => {
    const parsed = parseSchedule("0 9 * * *");
    expect(
      nextRunAt(parsed, new Date("2026-08-18T12:00:00.000Z"), "America/New_York").toISOString(),
    ).toBe("2026-08-18T13:00:00.000Z");
  });

  it("returns only enabled jobs whose nextRunAt is due", () => {
    const now = new Date("2026-08-18T12:00:00.000Z");
    const jobs = [
      job({ id: "sch_due", enabled: true, nextRunAt: "2026-08-18T11:59:00.000Z" }),
      job({ id: "sch_future", enabled: true, nextRunAt: "2026-08-18T12:01:00.000Z" }),
      job({ id: "sch_paused", enabled: false, nextRunAt: "2026-08-18T11:00:00.000Z" }),
    ];
    expect(dueJobs(jobs, now).map((item) => item.id)).toEqual(["sch_due"]);
  });
});

function job(overrides: Partial<ScheduleJob> & Pick<ScheduleJob, "id">): ScheduleJob {
  return {
    name: overrides.id,
    enabled: true,
    schedule: "30m",
    timezone: "UTC",
    prompt: "do work",
    nextRunAt: "2026-08-18T00:00:00.000Z",
    createdAt: "2026-08-18T00:00:00.000Z",
    updatedAt: "2026-08-18T00:00:00.000Z",
    ...overrides,
  };
}
