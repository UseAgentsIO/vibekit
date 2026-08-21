import type { CronFields, ParsedSchedule, ScheduleJob } from "./types.js";

const UNIT_MS: Readonly<Record<string, number>> = {
  ms: 1,
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

const DURATION = /^(?:(every)\s+)?(\d+)\s*(ms|s|m|h|d)$/i;
const ISO_PREFIX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

const MONTH_ALIAS: Readonly<Record<string, number>> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

const DOW_ALIAS: Readonly<Record<string, number>> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};

const WEEKDAY_NAME: Readonly<Record<string, number>> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export class ScheduleParseError extends Error {
  readonly code = "schedule_invalid";

  constructor(message: string) {
    super(message);
    this.name = "ScheduleParseError";
  }
}

export function parseSchedule(input: string): ParsedSchedule {
  if (typeof input !== "string") {
    throw new ScheduleParseError("Schedule must be a string");
  }
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    throw new ScheduleParseError("Schedule must be a non-empty string");
  }

  const duration = DURATION.exec(trimmed);
  if (duration) {
    const every = duration[1] !== undefined;
    const amount = Number(duration[2]);
    const unit = duration[3].toLowerCase();
    if (!Number.isInteger(amount) || amount <= 0) {
      throw new ScheduleParseError(`Invalid duration amount in "${trimmed}"`);
    }
    const ms = amount * UNIT_MS[unit];
    if (!Number.isFinite(ms) || ms <= 0) {
      throw new ScheduleParseError(`Invalid duration in "${trimmed}"`);
    }
    return every ? { kind: "interval", ms } : { kind: "delay", ms };
  }

  if (ISO_PREFIX.test(trimmed)) {
    const at = new Date(trimmed);
    if (Number.isNaN(at.getTime())) {
      throw new ScheduleParseError(`Invalid ISO timestamp "${trimmed}"`);
    }
    return { kind: "once", at };
  }

  return parseCron(trimmed);
}

export function nextRunAt(parsed: ParsedSchedule, from: Date, timezone = "UTC"): Date {
  assertValidTimeZone(timezone);
  switch (parsed.kind) {
    case "delay":
    case "interval":
      return new Date(from.getTime() + parsed.ms);
    case "once":
      return new Date(parsed.at.getTime());
    case "cron":
      return nextCronOccurrence(parsed.fields, from, timezone);
  }
}

export function dueJobs(jobs: readonly ScheduleJob[], now: Date = new Date()): ScheduleJob[] {
  const t = now.getTime();
  return jobs.filter((job) => {
    if (job.pendingRun === true) {
      return true;
    }
    if (!job.enabled) {
      return false;
    }
    const next = Date.parse(job.nextRunAt);
    return Number.isFinite(next) && next <= t;
  });
}

export function assertValidTimeZone(timezone: string): void {
  if (typeof timezone !== "string" || timezone.length === 0) {
    throw new ScheduleParseError("Timezone must be a non-empty IANA name");
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
  } catch {
    throw new ScheduleParseError(`Invalid IANA timezone "${timezone}"`);
  }
}

function parseCron(expression: string): ParsedSchedule {
  const fields = expression.split(/\s+/);
  if (fields.length !== 5) {
    throw new ScheduleParseError(
      `Unsupported schedule "${expression}". Use 30m, every 2h, a 5-field cron, or an ISO timestamp`,
    );
  }
  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields;
  return {
    kind: "cron",
    expression,
    fields: {
      minute: parseCronField(minute, 0, 59, "minute"),
      hour: parseCronField(hour, 0, 23, "hour"),
      dayOfMonth: parseCronField(dayOfMonth, 1, 31, "day-of-month"),
      month: parseCronField(month, 1, 12, "month", MONTH_ALIAS),
      dayOfWeek: normalizeDow(parseCronField(dayOfWeek, 0, 7, "day-of-week", DOW_ALIAS)),
      dayOfMonthStar: isStarField(dayOfMonth),
      dayOfWeekStar: isStarField(dayOfWeek),
    },
  };
}

function isStarField(field: string): boolean {
  return field === "*" || field === "?" || field.startsWith("*/");
}

function parseCronField(
  field: string,
  min: number,
  max: number,
  label: string,
  aliases?: Readonly<Record<string, number>>,
): Set<number> {
  if (field === "*" || field === "?") {
    return fullRange(min, max === 7 ? 6 : max);
  }
  const values = new Set<number>();
  for (const part of field.split(",")) {
    if (part.length === 0) {
      throw new ScheduleParseError(`Empty ${label} field in cron`);
    }
    const [rangePart, stepPart] = splitStep(part);
    const step = stepPart === undefined ? 1 : Number(stepPart);
    if (!Number.isInteger(step) || step <= 0) {
      throw new ScheduleParseError(`Invalid ${label} step in "${field}"`);
    }
    if (rangePart === "*") {
      addRange(values, min, max === 7 ? 7 : max, step, min, max);
      continue;
    }
    const dash = rangePart.indexOf("-");
    if (dash === -1) {
      const value = parseCronNumber(rangePart, min, max, label, aliases);
      values.add(value);
      continue;
    }
    const start = parseCronNumber(rangePart.slice(0, dash), min, max, label, aliases);
    const end = parseCronNumber(rangePart.slice(dash + 1), min, max, label, aliases);
    if (start <= end) {
      addRange(values, start, end, step, min, max);
    } else {
      addRange(values, start, max, step, min, max);
      addRange(values, min, end, step, min, max);
    }
  }
  if (values.size === 0) {
    throw new ScheduleParseError(`Cron ${label} field "${field}" matched no values`);
  }
  return values;
}

function splitStep(part: string): [string, string | undefined] {
  const index = part.indexOf("/");
  if (index === -1) {
    return [part, undefined];
  }
  return [part.slice(0, index), part.slice(index + 1)];
}

function parseCronNumber(
  raw: string,
  min: number,
  max: number,
  label: string,
  aliases?: Readonly<Record<string, number>>,
): number {
  const alias = aliases?.[raw.toLowerCase()];
  if (alias !== undefined) {
    return alias;
  }
  if (!/^\d+$/.test(raw)) {
    throw new ScheduleParseError(`Invalid ${label} value "${raw}"`);
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new ScheduleParseError(`Cron ${label} value ${raw} is out of range ${min}-${max}`);
  }
  return value;
}

function addRange(
  values: Set<number>,
  start: number,
  end: number,
  step: number,
  min: number,
  max: number,
): void {
  const lo = Math.max(min, start);
  const hi = Math.min(max, end);
  for (let value = lo; value <= hi; value += step) {
    values.add(value);
  }
}

function fullRange(min: number, max: number): Set<number> {
  const values = new Set<number>();
  for (let value = min; value <= max; value += 1) {
    values.add(value);
  }
  return values;
}

function normalizeDow(values: Set<number>): Set<number> {
  if (values.has(7)) {
    values.add(0);
    values.delete(7);
  }
  return values;
}

interface ZonedParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly dow: number;
}

function nextCronOccurrence(fields: CronFields, from: Date, timezone: string): Date {
  const start = truncateToNextMinute(from);
  const limit = start + 4 * 366 * 24 * 60 * 60 * 1000;
  for (let cursor = start; cursor <= limit; cursor += 60_000) {
    const parts = zonedParts(new Date(cursor), timezone);
    if (cronMatches(fields, parts)) {
      return new Date(cursor);
    }
  }
  throw new ScheduleParseError("No cron occurrence found within 4 years");
}

function truncateToNextMinute(from: Date): number {
  const ms = from.getTime();
  return Math.floor(ms / 60_000) * 60_000 + 60_000;
}

function cronMatches(fields: CronFields, parts: ZonedParts): boolean {
  if (!fields.minute.has(parts.minute)) {
    return false;
  }
  if (!fields.hour.has(parts.hour)) {
    return false;
  }
  if (!fields.month.has(parts.month)) {
    return false;
  }
  const domOk = fields.dayOfMonth.has(parts.day);
  const dowOk = fields.dayOfWeek.has(parts.dow);
  if (fields.dayOfMonthStar && fields.dayOfWeekStar) {
    return true;
  }
  if (fields.dayOfMonthStar) {
    return dowOk;
  }
  if (fields.dayOfWeekStar) {
    return domOk;
  }
  return domOk && dowOk;
}

function zonedParts(date: Date, timeZone: string): ZonedParts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((part) => [part.type, part.value]));
  const dow = WEEKDAY_NAME[parts.weekday ?? ""];
  if (dow === undefined) {
    throw new ScheduleParseError(`Unable to resolve weekday in timezone ${timeZone}`);
  }
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    dow,
  };
}
