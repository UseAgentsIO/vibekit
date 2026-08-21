import fs from "node:fs";
import path from "node:path";

import { assertRuntimeIdOf } from "../ids.js";
import type { EventDocument } from "../types.js";
import { parseAndValidateJson, validateDocument } from "../validate.js";

import { stateError } from "./errors.js";
import type { LockManager } from "./locks.js";
import type { EventFilter } from "./types.js";

const DAY_FILE = /^(\d{4}-\d{2}-\d{2})\.jsonl$/;

export interface EventLog {
  readonly directory: string;
  append(event: EventDocument): EventDocument;
  list(filter?: EventFilter): EventDocument[];
  fileFor(timestamp: string): string;
  readRaw(fileName: string): string;
}

export function createEventLog(options: {
  directory: string;
  locks: LockManager;
  owner: string;
}): EventLog {
  return new JsonlEventLog(options);
}

class JsonlEventLog implements EventLog {
  readonly directory: string;
  private readonly locks: LockManager;
  private readonly owner: string;

  constructor(options: { directory: string; locks: LockManager; owner: string }) {
    this.directory = options.directory;
    this.locks = options.locks;
    this.owner = options.owner;
  }

  fileFor(timestamp: string): string {
    return path.join(this.directory, `${dayKey(timestamp)}.jsonl`);
  }

  readRaw(fileName: string): string {
    const filePath = path.join(this.directory, fileName);
    if (!fs.existsSync(filePath)) {
      return "";
    }
    return fs.readFileSync(filePath, "utf8");
  }

  append(event: EventDocument): EventDocument {
    const validated = this.validate(event);
    assertRuntimeIdOf("event", validated.id);
    const day = dayKey(validated.timestamp);
    const filePath = this.fileFor(validated.timestamp);
    const lockName = `events:${day}`;
    this.locks.acquire(lockName, this.owner);
    try {
      fs.mkdirSync(this.directory, { recursive: true });
      fs.appendFileSync(filePath, `${JSON.stringify(validated)}\n`, "utf8");
      return validated;
    } finally {
      this.locks.release(lockName, this.owner);
    }
  }

  list(filter: EventFilter = {}): EventDocument[] {
    if (!fs.existsSync(this.directory)) {
      return [];
    }
    const files = fs
      .readdirSync(this.directory)
      .filter((name) => DAY_FILE.test(name))
      .sort((left, right) => left.localeCompare(right));
    const events: EventDocument[] = [];
    for (const fileName of files) {
      const match = DAY_FILE.exec(fileName);
      const day = match?.[1];
      if (day && !dayOverlaps(day, filter.from, filter.to)) {
        continue;
      }
      events.push(...this.readFile(path.join(this.directory, fileName)));
    }
    return events.filter((event) => matchesFilter(event, filter));
  }

  private validate(event: EventDocument): EventDocument {
    const result = validateDocument("event", event);
    if (!result.valid || result.data === undefined) {
      stateError(
        "invalid_input",
        "state_invalid_document",
        result.errors[0]?.message ?? "event document is invalid",
        { kind: "event", errors: result.errors },
      );
    }
    return result.data;
  }

  private readFile(filePath: string): EventDocument[] {
    const raw = fs.readFileSync(filePath, "utf8");
    const lines = raw.split("\n");
    const events: EventDocument[] = [];
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (line === undefined || line.trim() === "") {
        continue;
      }
      const parsed = parseAndValidateJson("event", line);
      if (!parsed.valid || parsed.data === undefined) {
        const isLast =
          index === lines.length - 1 ||
          (index === lines.length - 2 && lines[lines.length - 1] === "");
        if (isLast) {
          // A crash during append can leave a truncated final line.
          continue;
        }
        stateError(
          "invalid_input",
          "state_event_corrupt",
          parsed.errors[0]?.message ?? "event line is invalid",
          { path: filePath, line: index + 1, errors: parsed.errors },
        );
      }
      events.push(parsed.data);
    }
    return events;
  }
}

function dayKey(timestamp: string): string {
  const day = timestamp.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    stateError(
      "invalid_input",
      "state_event_timestamp_invalid",
      "Event timestamp must be an ISO date-time",
      { timestamp },
    );
  }
  return day;
}

function dayOverlaps(day: string, from?: string, to?: string): boolean {
  if (from && day < from.slice(0, 10)) {
    return false;
  }
  if (to && day > to.slice(0, 10)) {
    return false;
  }
  return true;
}

function matchesFilter(event: EventDocument, filter: EventFilter): boolean {
  if (filter.type && event.type !== filter.type) {
    return false;
  }
  if (filter.taskId && event.taskId !== filter.taskId) {
    return false;
  }
  if (filter.runId && event.runId !== filter.runId) {
    return false;
  }
  if (filter.from && event.timestamp < filter.from) {
    return false;
  }
  if (filter.to && event.timestamp > filter.to) {
    return false;
  }
  return true;
}
